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
// Not reference behaviour, on purpose: for en and zh a sentence is cut at punctuation clusters (table of cluster kinds and pause
// lengths: text.js). Default: each piece is synthesized alone and the pieces are joined with silence. With `whole: true` the pieces
// of one language run go to the model in ONE pass with its pause token at each junction and the pause is padded to length
// (whole.js); only a language switch still cuts.
// Chinese digits are written out in hanzi first (the reference drops them silently). Inside Chinese, brand names / acronyms / letters
// are read the Mandarin way (upstream loanword table) and any other English word is cut out and read by the English frontend with the
// English language id (when English is loaded), see splitChineseEnglish.

import * as ort from "./vendor/onnxruntime-web/ort.wasm.bundle.min.mjs";
import createOjtModule from "./vendor/ojt/ojt.mjs";
import { createJaFrontend, mountDictionaryBytes } from "./ja-frontend.js";
import { createEnglishG2p } from "./en-g2p.js";
import { createChineseG2p, readsAsChinese } from "./zh-g2p.js";
import { encodeTokens, segmentText } from "./encode.js";
import { createVits } from "./vits.js";
import { splitClausesDetailed, normalizeZhNumbers, stripMarkup } from "./text.js";
import { joinPieces, padSilence } from "./whole.js";

/** Names the backend looks up in `ctx.files`. A language is offered only when ALL of its files are present. */
const FILES = Object.freeze({
  core: ["model.onnx", "config.json", "ort-wasm-simd-threaded.wasm"],
  ja: ["ja/sys.dic", "ja/matrix.bin", "ja/char.bin", "ja/unk.dic", "ja/ojt.wasm", "ja/nani-model.json"],
  en: ["en/cmudict_data.json", "en/homographs.json"],
  zh: ["zh/pinyin_single.tone3.json", "zh/pinyin_phrases.tone3.json"],
});
const SCALES = Object.freeze({ noiseScale: 0.667, lengthScale: 1.5, noiseW: 0.5 });
// `steadiness` 0…1 (experiment, 2026-10-01 prosody-exp): 0 = SCALES, 1 = STEADY_SCALES, in between each scale is interpolated linearly.
// At 1 the recogniser error drops zh 14.3 -> 4.8 %, en 12.3 -> 4.8 %, ja 3.7 -> 1.3 % and every take is identical, but the owner hears it
// as flat (「平稳档是很容易听清楚，就是有点像机翻」), hence a slider. `steady: true` (0.1.9) = steadiness 1.
const STEADY_SCALES = Object.freeze({ noiseScale: 0.333, lengthScale: 1.7, noiseW: 0 });
/** t = 0 -> SCALES, 1 -> STEADY_SCALES, linear in each scale; clamped to 0…1. */
export function blendScales(t) {
  const k = Math.min(1, Math.max(0, Number(t) || 0)), mix = (a, b) => a + (b - a) * k;
  return { noiseScale: mix(SCALES.noiseScale, STEADY_SCALES.noiseScale), lengthScale: mix(SCALES.lengthScale, STEADY_SCALES.lengthScale), noiseW: mix(SCALES.noiseW, STEADY_SCALES.noiseW) };
}   // model README; config.json's 1.0 / 0.8 is the "rushed" setting
const MIN_CLAUSE_CHARS = { en: 20, zh: 2 };   // zh 2 = one hanzi + the comma: every Chinese comma pauses, 「突然，」 and 「嗯，」 too (user 2026-10-01「第一个逗号为什么没停」「嗯为什么不停顿」; was 5)
const RUN_GAP_MS = 60;   // between a Chinese run and an English word cut out of it (no punctuation there)
/**
 * Cut English words that a Mandarin speaker would NOT read the Chinese way out of a Chinese piece: `Harry对他说` -> [en "Harry",
 * zh "对他说"]. Consecutive such words separated by spaces form one English run. Everything else stays Chinese.
 * @param {string} piece
 * @returns {{lang: "zh" | "en", text: string}[]}
 */
export function splitChineseEnglish(piece) {
  const runs = [], WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
  let last = 0, enStart = -1, enEnd = -1;
  const flushEn = () => { if (enStart >= 0) { runs.push({ lang: "en", text: piece.slice(enStart, enEnd) }); last = enEnd; enStart = -1; } };
  for (let m = WORD.exec(piece); m; m = WORD.exec(piece)) {
    const w = m[0], isEn = /[A-Za-z]/.test(w) && !readsAsChinese(w.replace(/['’-]/g, ""));
    if (!isEn) continue;
    const gap = piece.slice(enEnd, m.index);
    if (enStart >= 0 && /^[\s]*$/.test(gap)) { enEnd = m.index + w.length; continue; }   // join "Harry Potter"
    flushEn();
    if (m.index > last) runs.push({ lang: "zh", text: piece.slice(last, m.index) });
    enStart = m.index; enEnd = m.index + w.length;
  }
  flushEn();
  if (last < piece.length) runs.push({ lang: "zh", text: piece.slice(last) });
  return runs.filter((r) => r.text.trim());
}   // weak-break pieces shorter than this are glued; the pause lengths live in text.js (PAUSE_MS)

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
 * @property {boolean} preset     the model declares a `preset` input
 *
 * @typedef {Object} SynthOptions
 * @property {"ja"|"en"|"zh"} lang
 * @property {number} [voice]     0 (default)
 * @property {number} [speed]     1 = the reference pace (length_scale 1.5); length_scale = 1.5 / speed. Clamped to 0.25 … 4.
 * @property {number} [steadiness] experiment, 0 (default) … 1: interpolates SCALES -> STEADY_SCALES (less sampling noise, a little slower)
 * @property {boolean} [steady]  same as steadiness 1 (kept from 0.1.9)
 * @property {boolean} [whole]   zh / en: one model pass per language run, pause token + padded silence at the junctions (whole.js);
 *   default false = each clause piece alone (ja is always whole)
 * @property {number} [preset]   the user's preset, a signed int (default 0): fed to models that declare a `preset` input (family
 *   convention: the model decides what it means); ignored by models without one
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
          if (!part) {   // no silent skipping (owner 2026-10-01: a missing language must not degrade silently)
            if (lang === "en") throw new Error(`piper-plus backend: language "en" is not available (English words inside Japanese: ${JSON.stringify(seg.slice(0, 30))})`);
            continue;    // other scripts the Japanese frontend has nothing for (e.g. Cyrillic) are not a language this voice offers
          }
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
    return { sampleRate: vits.sampleRate, voices: 1, langs: langs.slice(), preset: vits.hasPreset };
  }

  function synth(text, o) {
    return serial(async () => {
      if (!state) throw new Error("piper-plus backend: not loaded");
      const lang = o && o.lang;
      if (!state.g2p[lang]) throw new Error(`piper-plus backend: language "${lang}" is not available (loaded: ${state.langs.join(", ") || "none"})`);
      if (o.voice !== undefined && o.voice !== 0) throw new RangeError(`piper-plus backend: voice ${o.voice} does not exist (this model has one voice, index 0)`);
      const speed = Math.min(4, Math.max(0.25, Number.isFinite(o.speed) && o.speed > 0 ? o.speed : 1));
      const base = blendScales(Number.isFinite(o.steadiness) ? o.steadiness : o.steady ? 1 : 0);
      const scales = { ...base, lengthScale: base.lengthScale / speed };
      const preset = Number.isFinite(o.preset) ? Math.max(-2147483648, Math.min(2147483647, Math.trunc(o.preset))) : 0;   // a signed 32-bit int
      const sr = state.vits.sampleRate, str = stripMarkup(String(text ?? ""));
      const pieces = lang === "ja" ? [{ text: str, pauseMs: 0 }] : splitClausesDetailed(str, MIN_CLAUSE_CHARS[lang] ?? 20);
      // segments = what is synthesized one by one: clause pieces, and inside a Chinese piece the English words cut out of it
      const segments = [];
      for (const { text: piece, pauseMs, quote } of pieces) {
        const runs = lang === "zh" ? splitChineseEnglish(piece) : [{ lang, text: piece }];
        const needEn = runs.find((r) => r.lang === "en");
        if (needEn && !state.g2p.en) throw new Error(`piper-plus backend: language "en" is not available (English words inside Chinese: ${JSON.stringify(needEn.text.slice(0, 30))})`);
        runs.forEach((r, k) => segments.push({ lang: r.lang, text: r.text, pauseMs: k === runs.length - 1 ? pauseMs : RUN_GAP_MS, quote: k === runs.length - 1 && !!quote }));
      }
      const clips = [], gaps = [], debug = [];   // gaps[i] = silence (samples) after clip i
      // encode; an unpronounceable piece (punctuation, unknown symbols: BOS, pad, EOS only) is dropped and its pause carried over
      const encoded = [];
      for (const { lang: segLang, text: piece, pauseMs, quote } of segments) {
        const enc = piece.trim() ? state.g2p[segLang](piece) : null;
        if (!enc || enc.ids.length <= 3) { const prev = encoded[encoded.length - 1]; if (prev) { prev.pauseMs = Math.max(prev.pauseMs, pauseMs); prev.quote = prev.quote || quote; } continue; }
        encoded.push({ lang: segLang, text: piece, pauseMs, quote, ids: enc.ids, pros: enc.pros });
      }
      // groups = what goes to the model in one pass: with `whole`, consecutive pieces of the same language joined at quote-free breaks
      // (a break whose punctuation holds a quote or bracket is really cut; owner 2026-10-02「引号系的应该用分句而不是pause符号」);
      // otherwise one piece each
      const groups = [];
      for (const e of encoded) {
        const g = groups[groups.length - 1], prev = g && g[g.length - 1];
        if (o.whole && g && g[0].lang === e.lang && !prev.quote) g.push(e); else groups.push([e]);
      }
      for (const g of groups) {
        const joined = g.length > 1 ? joinPieces(g) : null;
        const parts = joined ? [{ ...joined, lang: g[0].lang, text: g.map((e) => e.text).join("") }] : g;
        for (const part of parts) {
          const r = await state.vits.synthIds(part.ids, part.pros, part.lang, scales, part.marks ? part.marks.map((m) => m.index) : undefined, preset);
          let samples = r.samples, padded;
          if (part.marks) ({ samples, padded } = padSilence(samples, sr, part.marks.map((m, k) => ({ ...r.marks[k], pauseMs: m.pauseMs })), speed));
          clips.push(samples);
          const after = part === parts[parts.length - 1] ? g[g.length - 1].pauseMs : part.pauseMs;
          gaps.push(Math.round((after / speed / 1000) * sr));   // pauses scale with the speaking rate, like everything else
          if (o.__debug) debug.push({ text: part.text, lang: part.lang, ...r.inputs, ...(padded ? { padded } : {}) });
        }
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
