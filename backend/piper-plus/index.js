// index.js — piper-plus つくよみちゃん (6-language MB-iSTFT VITS) as a read-aloud backend for a module Web Worker.
// created 2026-10-01 by Claude Fable 5.1 — background and evidence: ../work/NOTES.md, ./README.md
//
// Contract: bytes in, audio out. Everything binary or data arrives in `ctx.files`; this code never calls fetch,
// XMLHttpRequest, importScripts or import() and never touches DOM, localStorage, indexedDB or caches. The only executable
// third-party code is vendored under ./vendor and imported statically, so `esbuild --bundle --format=esm` yields one file.
//
// What it feeds the model is what the upstream Python reference runtime feeds it (scales 0.667 / 1.5 / 0.5, zero speaker
// embedding with mask 0, Python encoder layout, short-text strategies, EOS trim, peak normalisation):
//   ja  ja-frontend.js  OpenJTalk from pyopenjtalk-plus (WASM) + its dictionary + JS port of its rule passes
//   en  en-g2p.js       CMUdict + port of upstream english.py (the piper-plus WASM has no English phonemizer)
//   zh  zh-g2p.js       JS port of the piper-plus Rust G2P (no 60 MB WASM)
// Not reference behaviour, on purpose: for en and zh a sentence is cut at punctuation clusters and the pieces are joined with
// silence (table of cluster kinds and pause lengths: text.js); the model gets no pause token at punctuation in those languages.
// Chinese digits are written out in hanzi first (the reference drops them silently).

import * as ort from "./vendor/onnxruntime-web/ort.wasm.bundle.min.mjs";
import createOjtModule from "./vendor/ojt/ojt.mjs";
import { createJaFrontend, mountDictionaryBytes } from "./ja-frontend.js";
import { createEnglishG2p } from "./en-g2p.js";
import { createChineseG2p } from "./zh-g2p.js";
import { encodeTokens, segmentText } from "./encode.js";
import { createVits } from "./vits.js";
import { splitClausesDetailed, normalizeZhNumbers, stripMarkup } from "./text.js";

/** Names the backend looks up in `ctx.files`. A language is offered only when ALL of its files are present. */
const FILES = Object.freeze({
  core: ["model.onnx", "config.json", "ort-wasm-simd-threaded.wasm"],
  ja: ["ja/sys.dic", "ja/matrix.bin", "ja/char.bin", "ja/unk.dic", "ja/ojt.wasm", "ja/nani-model.json"],
  en: ["en/cmudict_data.json", "en/homographs.json"],
  zh: ["zh/pinyin_single.tone3.json", "zh/pinyin_phrases.tone3.json"],
});
const SCALES = Object.freeze({ noiseScale: 0.667, lengthScale: 1.5, noiseW: 0.5 });
// `steady` (experiment, 2026-10-01 prosody-exp): less sampling noise + a little slower. Recogniser error zh 14.3 -> 4.8 %, en 12.3 -> 4.8 %,
// ja 3.7 -> 1.3 %; every take identical. Possibly flatter — that is for ears to judge, hence a switch, not a default.
const STEADY_SCALES = Object.freeze({ noiseScale: 0.333, lengthScale: 1.7, noiseW: 0 });   // model README; config.json's 1.0 / 0.8 is the "rushed" setting
const MIN_CLAUSE_CHARS = { en: 20, zh: 5 };   // weak-break pieces shorter than this are glued; the pause lengths live in text.js (PAUSE_MS)

const bytesOf = (files, name) => { const v = files.get(name); if (v === undefined) throw new Error(`piper-plus backend: "${name}" is missing from ctx.files`); return v instanceof Uint8Array ? v : new Uint8Array(v); };
const jsonOf = (files, name) => JSON.parse(new TextDecoder().decode(bytesOf(files, name)));

/**
 * @typedef {Object} LoadContext
 * @property {Map<string, Uint8Array>} files  pack contents by name, see FILES. Not modified and not retained: after `load`
 *   resolves the caller may `files.clear()` so the big buffers can be collected.
 *
 * @typedef {Object} LoadResult
 * @property {number} sampleRate  22050 for this model
 * @property {1} voices           single voice; `voice` must be 0
 * @property {string[]} langs     subset of ["ja", "en", "zh"] whose files were present
 *
 * @typedef {Object} SynthOptions
 * @property {"ja"|"en"|"zh"} lang
 * @property {number} [voice]     0 (default)
 * @property {number} [speed]     1 = the reference pace (length_scale 1.5); length_scale = 1.5 / speed. Clamped to 0.25 … 4.
 * @property {boolean} [steady]  experiment: noise 0.333 / 0, length_scale 1.7 (see STEADY_SCALES)
 *
 * @typedef {Object} SynthResult
 * @property {Float32Array} samples   mono, −1 … 1, peak-normalised; length 0 when the text has nothing pronounceable
 * @property {number} sampleRate
 *
 * @typedef {Object} PiperPlusBackend
 * @property {(ctx: LoadContext) => Promise<LoadResult>} load
 * @property {(text: string, o: SynthOptions) => Promise<SynthResult>} synth   ONE sentence in, one clip out
 * @property {() => Promise<void>} unload
 */

/** @returns {PiperPlusBackend} */
export function createPiperPlusBackend() {
  /** @type {null | {vits: any, session: any, config: any, g2p: Record<string, (text: string) => {ids: number[], pros: number[][]}>, langs: string[], ojt: any}} */
  let state = null;
  let queue = Promise.resolve();   // ORT runs one inference at a time; calls are serialised here
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

  async function load(ctx) {
    if (state) throw new Error("piper-plus backend: already loaded (call unload() first)");
    const files = ctx && ctx.files;
    if (!(files instanceof Map)) throw new TypeError("piper-plus backend: load({ files }) needs a Map<string, Uint8Array>");
    const has = (group) => FILES[group].every((n) => files.has(n));
    if (!has("core")) throw new Error("piper-plus backend: missing core file(s): " + FILES.core.filter((n) => !files.has(n)).join(", "));

    const config = jsonOf(files, "config.json");
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = bytesOf(files, "ort-wasm-simd-threaded.wasm");   // the embedded glue instantiates from these bytes: no fetch
    let session;
    try { session = await ort.InferenceSession.create(bytesOf(files, "model.onnx"), { executionProviders: ["wasm"], graphOptimizationLevel: "disabled" }); }
    finally { ort.env.wasm.wasmBinary = undefined; }
    const vits = createVits(ort, session, config), map = config.phoneme_id_map;
    const g2p = {}, parts = {}; let ojt = null;

    if (has("en")) {
      parts.en = createEnglishG2p({ cmudict: jsonOf(files, "en/cmudict_data.json"), homographs: jsonOf(files, "en/homographs.json") });
      g2p.en = (text) => { const r = parts.en.phonemize(text); return encodeTokens(r.tokens, r.prosody, map); };
    }
    if (has("ja")) {
      ojt = await createOjtModule({ wasmBinary: bytesOf(files, "ja/ojt.wasm"), locateFile: (p) => p, print: () => {}, printErr: () => {} });
      mountDictionaryBytes(ojt, { sys: bytesOf(files, "ja/sys.dic"), matrix: bytesOf(files, "ja/matrix.bin"), char: bytesOf(files, "ja/char.bin"), unk: bytesOf(files, "ja/unk.dic") });
      parts.ja = createJaFrontend(ojt, "/dic", { naniModel: jsonOf(files, "ja/nani-model.json") });
      // Like the reference, a "ja" request on this multilingual model goes through script segmentation: kana/kanji runs to the
      // Japanese frontend, Latin-letter runs to the English one (skipped when English is not loaded), then ONE encoder pass.
      // Deliberate deviation: kanji always count as Japanese here; the reference reads kana-less text as Chinese.
      const langSet = new Set(Object.keys(config.language_id_map || { ja: 0 }));
      g2p.ja = (text) => {
        const tokens = [], prosody = [];
        for (const [lang, seg] of segmentText(text, langSet, { kana: true })) {
          const part = lang === "ja" ? parts.ja : lang === "en" ? parts.en : null;
          if (!part) continue;
          const r = part.phonemize(seg); tokens.push(...r.tokens); prosody.push(...r.prosody);
        }
        return encodeTokens(tokens, prosody, map);
      };
    }
    if (has("zh")) {
      parts.zh = createChineseG2p({ single: jsonOf(files, "zh/pinyin_single.tone3.json"), phrases: jsonOf(files, "zh/pinyin_phrases.tone3.json") });
      g2p.zh = (text) => parts.zh.encode(normalizeZhNumbers(text), map);
    }
    const langs = ["ja", "en", "zh"].filter((l) => g2p[l]);
    state = { vits, session, config, g2p, langs, ojt };
    return { sampleRate: vits.sampleRate, voices: 1, langs: langs.slice() };
  }

  function synth(text, o) {
    return serial(async () => {
      if (!state) throw new Error("piper-plus backend: not loaded");
      const lang = o && o.lang;
      if (!state.g2p[lang]) throw new Error(`piper-plus backend: language "${lang}" is not available (loaded: ${state.langs.join(", ") || "none"})`);
      if (o.voice !== undefined && o.voice !== 0) throw new RangeError(`piper-plus backend: voice ${o.voice} does not exist (this model has one voice, index 0)`);
      const speed = Math.min(4, Math.max(0.25, Number.isFinite(o.speed) && o.speed > 0 ? o.speed : 1));
      const base = o.steady ? STEADY_SCALES : SCALES;
      const scales = { ...base, lengthScale: base.lengthScale / speed };
      const sr = state.vits.sampleRate, str = stripMarkup(String(text ?? ""));
      const pieces = lang === "ja" ? [{ text: str, pauseMs: 0 }] : splitClausesDetailed(str, MIN_CLAUSE_CHARS[lang] ?? 20);
      const clips = [], gaps = [], debug = [];   // gaps[i] = silence (samples) after clip i
      for (const { text: piece, pauseMs } of pieces) {
        if (!piece.trim()) continue;
        const { ids, pros } = state.g2p[lang](piece);
        if (ids.length <= 3) continue;   // BOS, pad, EOS only: nothing pronounceable (punctuation, unknown symbols)
        const r = await state.vits.synthIds(ids, pros, lang, scales);
        clips.push(r.samples);
        gaps.push(Math.round((pauseMs / speed / 1000) * sr));   // pauses scale with the speaking rate, like everything else
        if (o.__debug) debug.push({ text: piece, ...r.inputs });
      }
      const total = clips.reduce((a, c) => a + c.length, 0) + gaps.slice(0, -1).reduce((a, g) => a + g, 0);
      const samples = clips.length === 1 ? clips[0] : new Float32Array(total);
      if (clips.length > 1) { let off = 0; clips.forEach((c, i) => { samples.set(c, off); off += c.length + gaps[i]; }); }
      /** @type {SynthResult} */
      const out = { samples, sampleRate: sr };
      if (o.__debug) out.debug = debug;   // test hook only: the exact model inputs of each piece
      return out;
    });
  }

  function unload() {
    return serial(async () => {
      if (!state) return;
      const s = state; state = null;
      try { await s.session.release(); } catch { /* already released */ }
      // The OpenJTalk instance (160 MB heap) and the dictionaries become garbage once these references are gone.
      // onnxruntime-web keeps its WASM runtime as a module-level singleton; a later load() reuses it.
      s.g2p = {}; s.ojt = null; s.vits = null;
    });
  }

  return { load, synth, unload };
}
