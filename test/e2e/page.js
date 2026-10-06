// 整链测试页的脚本：把库的公开面挂到 window 上，测试从 node 那头驱动。created 2026-10-01 by Claude Fable 5.1
// 0.1.20 起库不下载 / 不缓存：这里的 `chunksFor` 就是「宿主」——从测试服务器取分片当字节喂给 engine.load（只在内存里记着，不验哈希、不进 Cache；
// 下载 / 校验 / 缓存 / 导入 / 删除的测试在宿主 JustReadBooks test/model-packs.mjs）。edited by Claude Fable 5.1 2026-10-06
import { createSpeechEngine, createReadAloud, createWebAudioSink, splitSentences, voicePacks } from "../../dist/index.js";

const hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function embed(base, slug) {
  const bytes = new Uint8Array(await (await fetch(`${base}/packs/${slug}/manifest.json`, { cache: "no-store" })).arrayBuffer());
  return { packId: await hex(bytes), manifest: JSON.parse(new TextDecoder().decode(bytes)) };
}
// 喇叭探针：数「同时在响的声源」有几个（任何时刻不许超过 1）
const live = { now: 0, max: 0 };
{
  const S = AudioBufferSourceNode.prototype, start0 = S.start, stop0 = S.stop;
  const off = (n) => { if (n.__live) { n.__live = false; live.now--; } };
  S.start = function (...a) { if (!this.__live) { this.__live = true; live.now++; live.max = Math.max(live.max, live.now); this.addEventListener("ended", () => { live.ended = (live.ended ?? 0) + 1; off(this); }); } return start0.apply(this, a); };
  S.stop = function (...a) { off(this); return stop0.apply(this, a); };
}
const fetched = new Map();   // slug → Blob[]（测试页的「缓存」：只在内存）
window.e2e = {
  live,
  splitSentences,
  /** 建引擎：音色定义和清单从测试服务器取来当「内嵌」（产品里是 build 时内嵌）。list = [{ def 或 defUrl, base }]。 */
  async make(list) {
    const voices = {}, packs = {}, bases = {};
    for (const item of list) {
      const def = item.def ?? await (await fetch(item.defUrl, { cache: "no-store" })).json();
      voices[def.id] = def;
      for (const s of voicePacks(def)) if (!packs[s]) { packs[s] = await embed(item.base, s); bases[s] = item.base; }
    }
    const engine = createSpeechEngine({
      workers: { "sherpa-onnx": { url: "./.out/worker.js" }, "piper-plus": { url: "./.out/worker-piper-plus.js", type: "module" } },
      engineBase: "/engine/", voices, packs,
    });
    const sink = createWebAudioSink();
    const ra = createReadAloud({ engine, sink, sentenceGapMs: 40, paragraphGapMs: 80 });
    const events = [];
    ra.on("sentence", (span, i) => events.push(`sentence:${i}`));
    ra.on("state", (s) => events.push(`state:${s}`));
    ra.on("end", () => events.push("end"));
    ra.on("error", (e) => events.push(`error:${e.message}`));
    Object.assign(window.e2e, { engine, sink, ra, events, packs, voices, bases });
    return { voices, packs: Object.fromEntries(Object.entries(packs).map(([k, v]) => [k, { packId: v.packId, bytes: v.manifest.totalBytes, chunks: v.manifest.chunks.length }])) };
  },
  /** 「宿主」：一个包的分片 → Blob[]（第一次从测试服务器取，之后记在内存里）。 */
  async chunksOf(slug, baseOverride) {
    const key = `${baseOverride ?? ""}|${slug}`;
    if (!fetched.has(key)) {
      const base = baseOverride ?? window.e2e.bases[slug];
      const blobs = [];
      for (const c of window.e2e.packs[slug].manifest.chunks) blobs.push(await (await fetch(`${base}/packs/${slug}/${c.name}`, { cache: "no-store" })).blob());
      fetched.set(key, blobs);
    }
    return fetched.get(key);
  },
  /** 一个音色（点名几种语言）要的包的分片表；omit = 故意不给的包（模拟「没下载」）。 */
  async chunksFor(voice, langs, omit = []) {
    const out = {};
    for (const slug of voicePacks(window.e2e.voices[voice], langs)) if (!omit.includes(slug)) out[slug] = await window.e2e.chunksOf(slug);
    return out;
  },
  /** 先把一个音色的全部包取到内存（之后的 load 不发请求）。 */
  async prefetch(voice) { await window.e2e.chunksFor(voice); },
  /** 宿主式装载：取分片 → engine.load。opts.omit = 不给的包；opts.langs = 只装这几种。 */
  async load(voice, opts = {}) {
    const chunks = await window.e2e.chunksFor(voice, opts.langs, opts.omit ?? []);
    return window.e2e.engine.load(voice, { chunks, ...(opts.langs ? { langs: opts.langs } : {}) });
  },
  /** 合成一句，回报时长 / 采样率 / 响度（不把 PCM 传回 node，除非 keep：留在 window.e2e.kept 里等取）。 */
  async synth(text, lang, o = {}) {
    const t0 = performance.now();
    const c = await window.e2e.engine.synth(text, { lang, speaker: o.speaker ?? 0, speed: o.speed, steadiness: o.steadiness, whole: o.whole, preset: o.preset });
    let sum = 0; for (let i = 0; i < c.samples.length; i++) sum += c.samples[i] * c.samples[i];
    if (o.keep) (window.e2e.kept ??= {})[o.keep] = c;
    // 这一段里最长的一截「完全静音」（后端在小句之间垫的静音是精确的 0）
    let run = 0, longest = 0; for (let i = 0; i < c.samples.length; i++) { if (c.samples[i] === 0) { if (++run > longest) longest = run; } else run = 0; }
    // 最长的一截「安静」（10 ms 一格、均方根低于 −50 dBFS）：整句合成时停顿 = 模型自己的安静 + 补的静音，查补够了没有（只查代码，不当听感）
    const f = Math.round(c.sampleRate * 0.01); let qr = 0, ql = 0;
    for (let i = 0; i + f <= c.samples.length; i += f) { let s = 0; for (let k = i; k < i + f; k++) s += c.samples[k] * c.samples[k]; if (Math.sqrt(s / f) < 0.00316) { if (++qr > ql) ql = qr; } else qr = 0; }
    let sig = 0; for (let i = 0; i < c.samples.length; i++) sig += Math.abs(c.samples[i]) * ((i % 7) + 1);   // 两段输出是否相同
    return { ms: Math.round(performance.now() - t0), sec: c.samples.length / c.sampleRate, sampleRate: c.sampleRate, rms: Math.sqrt(sum / Math.max(1, c.samples.length)), silenceMs: Math.round((longest / c.sampleRate) * 1000), quietMs: ql * 10, sig: Math.round(sig * 1000) / 1000 };
  },
  /** 留着的一段 → 16 位 PCM 的 base64（node 那头写成 wav）。 */
  pcm16(name) {
    const c = window.e2e.kept[name]; const out = new Int16Array(c.samples.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(c.samples[i] * 32767)));
    let s = ""; const u = new Uint8Array(out.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
    return { sampleRate: c.sampleRate, b64: btoa(s) };
  },
  /**
   * 本地模型：url 表（文件名 → 测试服务器上的地址）→ Blob → engine.load(voice, { chunks, override })；失败回错误信息。
   * 手头有的包照递（和宿主一致：下载了的照装，好拿原配置核对）；omit = 故意不给的包（模拟「没下官方权重」：被本地文件整个顶替的包可以不递）。
   */
  async loadOverride(voice, urls, langs, omit = []) {
    const override = {};
    for (const [name, url] of Object.entries(urls)) override[name] = new File([await (await fetch(url)).arrayBuffer()], url.split("/").pop());
    const chunks = await window.e2e.chunksFor(voice, langs, omit);
    try { return await window.e2e.engine.load(voice, { langs, chunks, override }); } catch (e) { return { error: e.message }; }
  },
  /** 音素表改掉一个编号的 config.json，当本地文件换进去。 */
  async loadBadConfig(voice, url, langs) {
    const cfg = await (await fetch(url)).json(); const k = Object.keys(cfg.phoneme_id_map)[5]; cfg.phoneme_id_map[k] = [9999];
    const chunks = await window.e2e.chunksFor(voice, langs);
    try { return await window.e2e.engine.load(voice, { langs, chunks, override: { "config.json": new Blob([JSON.stringify(cfg)]) } }); } catch (e) { return { error: e.message }; }
  },
  wait(pred, ms = 120000) { return new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { if (pred()) res(true); else if (Date.now() - t0 > ms) rej(new Error("wait timeout: " + window.e2e.events.join(","))); else setTimeout(tick, 30); }; tick(); }); },
};
window.e2eReady = true;
