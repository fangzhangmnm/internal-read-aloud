// 整链测试页的脚本：把库的公开面挂到 window 上，测试从 node 那头驱动。created 2026-10-01 by Claude Fable 5.1
import { createSpeechEngine, createReadAloud, createWebAudioSink, splitSentences } from "../../dist/index.js";

async function embed(base, slug) {
  const bytes = new Uint8Array(await (await fetch(`${base}/packs/${slug}/manifest.json`, { cache: "no-store" })).arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { packId: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), manifest: JSON.parse(new TextDecoder().decode(bytes)) };
}
window.e2e = {
  splitSentences,
  /** 建引擎：清单从测试服务器取来当「内嵌清单」（产品里是 build 时内嵌）。 */
  async make(slugs, cacheName) {
    const packs = {};
    for (const s of slugs) packs[s] = await embed("/models", s);
    const engine = createSpeechEngine({ workers: { "sherpa-onnx": { url: "./.out/worker.js" } }, engineBase: "/engine/", packs, cacheName });
    const sink = createWebAudioSink();
    const ra = createReadAloud({ engine, sink, sentenceGapMs: 40, paragraphGapMs: 80 });
    const events = [];
    ra.on("sentence", (span, i) => events.push(`sentence:${i}`));
    ra.on("state", (s) => events.push(`state:${s}`));
    ra.on("end", () => events.push("end"));
    ra.on("error", (e) => events.push(`error:${e.message}`));
    Object.assign(window.e2e, { engine, sink, ra, events, packs });
    return Object.fromEntries(Object.entries(packs).map(([k, v]) => [k, { packId: v.packId, bytes: v.manifest.totalBytes, chunks: v.manifest.chunks.length }]));
  },
  /** 合成一句，回报时长 / 采样率 / 响度（不把 PCM 传回 node）。 */
  async synth(text, lang, voice = 0) {
    const t0 = performance.now();
    const c = await window.e2e.engine.synth(text, { lang, voice });
    let sum = 0; for (let i = 0; i < c.samples.length; i++) sum += c.samples[i] * c.samples[i];
    return { ms: Math.round(performance.now() - t0), sec: c.samples.length / c.sampleRate, sampleRate: c.sampleRate, rms: Math.sqrt(sum / Math.max(1, c.samples.length)) };
  },
  /** 把缓存里的分片取出来当「用户手里的文件」。 */
  async chunkFiles(slug, base) {
    const m = window.e2e.packs[slug].manifest; const files = [];
    for (const c of m.chunks) files.push(new File([await (await fetch(`${base}/packs/${slug}/${c.name}`)).arrayBuffer()], c.name));
    return files;
  },
  wait(pred, ms = 60000) { return new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { if (pred()) res(true); else if (Date.now() - t0 > ms) rej(new Error("wait timeout: " + window.e2e.events.join(","))); else setTimeout(tick, 30); }; tick(); }); },
};
window.e2eReady = true;
