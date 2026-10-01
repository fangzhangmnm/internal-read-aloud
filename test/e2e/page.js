// 整链测试页的脚本：把库的公开面挂到 window 上，测试从 node 那头驱动。created 2026-10-01 by Claude Fable 5.1
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
window.e2e = {
  live,
  splitSentences,
  /** 建引擎：音色定义和清单从测试服务器取来当「内嵌」（产品里是 build 时内嵌）。list = [{ def 或 defUrl, base }]。 */
  async make(list, cacheName) {
    const voices = {}, packs = {}, bases = {};
    for (const item of list) {
      const def = item.def ?? await (await fetch(item.defUrl, { cache: "no-store" })).json();
      voices[def.id] = def;
      for (const s of voicePacks(def)) if (!packs[s]) { packs[s] = await embed(item.base, s); bases[s] = item.base; }
    }
    const engine = createSpeechEngine({
      workers: { "sherpa-onnx": { url: "./.out/worker.js" }, "piper-plus": { url: "./.out/worker-piper-plus.js", type: "module" } },
      engineBase: "/engine/", voices, packs, cacheName,
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
  /** 合成一句，回报时长 / 采样率 / 响度（不把 PCM 传回 node，除非 keep：留在 window.e2e.kept 里等取）。 */
  async synth(text, lang, o = {}) {
    const t0 = performance.now();
    const c = await window.e2e.engine.synth(text, { lang, speaker: o.speaker ?? 0, speed: o.speed, steady: o.steady });
    let sum = 0; for (let i = 0; i < c.samples.length; i++) sum += c.samples[i] * c.samples[i];
    if (o.keep) (window.e2e.kept ??= {})[o.keep] = c;
    // 这一段里最长的一截「完全静音」（后端在小句之间垫的静音是精确的 0）
    let run = 0, longest = 0; for (let i = 0; i < c.samples.length; i++) { if (c.samples[i] === 0) { if (++run > longest) longest = run; } else run = 0; }
    return { ms: Math.round(performance.now() - t0), sec: c.samples.length / c.sampleRate, sampleRate: c.sampleRate, rms: Math.sqrt(sum / Math.max(1, c.samples.length)), silenceMs: Math.round((longest / c.sampleRate) * 1000) };
  },
  /** 留着的一段 → 16 位 PCM 的 base64（node 那头写成 wav）。 */
  pcm16(name) {
    const c = window.e2e.kept[name]; const out = new Int16Array(c.samples.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(c.samples[i] * 32767)));
    let s = ""; const u = new Uint8Array(out.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
    return { sampleRate: c.sampleRate, b64: btoa(s) };
  },
  /** 把一个音色所有包的分片取来当「用户手里的文件」：几个包的分片同名（都叫 chunk-000），顺手混进清单和许可证文件。 */
  async voiceFiles(voice, baseOverride) {
    const files = [];
    for (const slug of voicePacks(window.e2e.voices[voice])) {
      const base = baseOverride ?? window.e2e.bases[slug];
      for (const c of window.e2e.packs[slug].manifest.chunks) files.push(new File([await (await fetch(`${base}/packs/${slug}/${c.name}`)).arrayBuffer()], c.name));
      files.push(new File([await (await fetch(`${window.e2e.bases[slug]}/packs/${slug}/manifest.json`)).arrayBuffer()], "manifest.json"));
    }
    return files;
  },
  wait(pred, ms = 120000) { return new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { if (pred()) res(true); else if (Date.now() - t0 > ms) rej(new Error("wait timeout: " + window.e2e.events.join(","))); else setTimeout(tick, 30); }; tick(); }); },
};
window.e2eReady = true;
