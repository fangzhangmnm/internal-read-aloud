// zh-g2p.js — Mandarin G2P in plain JS: a line-by-line port of the piper-plus Rust G2P (upstream 82ee4e7,
// src/rust/piper-plus-g2p/src/chinese.rs + encode.rs + the language-hint path of multilingual.rs), so the 60 MB
// piper_plus_wasm_bg.wasm (mostly a Japanese dictionary this backend does not use) is no longer needed for Chinese.
// created 2026-10-01 by Claude Fable 5.1
//
// Input data: the two pinyin dictionaries in TONE-NUMBER style ("ni3"), see convert-pinyin-dicts.mjs.
// Output: exactly what the WASM path fed the model — Rust encoder output passed through toReferenceLayout() — verified id-for-id
// (ids + prosody) against the WASM on a 3124-sentence corpus (backend/test/zh-parity.mjs).
//
// Pipeline (same as chinese.rs): text -> per-character pinyin (longest phrase match up to 8 chars, else single-char dictionary)
//   -> tone sandhi (3+3, 一, 不) -> pinyin -> IPA tokens (initial, compound final, erhua, toneN) -> prosody (tone, position in
//   the run of hanzi, length of the run) -> encoder.
import { TOKEN2CHAR } from "./pua-map.js";
import { encodeTokens } from "./encode.js";
import LOANWORDS from "./zh-loanwords.js";

const INITIAL_TO_IPA = { b: "p", p: "pʰ", m: "m", f: "f", d: "t", t: "tʰ", n: "n", l: "l", g: "k", k: "kʰ", h: "x", j: "tɕ", q: "tɕʰ", x: "ɕ",
  zh: "tʂ", ch: "tʂʰ", sh: "ʂ", r: "ɻ", z: "ts", c: "tsʰ", s: "s" };
const FINAL_TO_IPA = { a: "a", o: "o", e: "ɤ", i: "i", u: "u", "ü": "y_vowel", v: "y_vowel", ai: "aɪ", ei: "eɪ", ao: "aʊ", ou: "oʊ", an: "an", en: "ən", ang: "aŋ",
  eng: "əŋ", ong: "uŋ", er: "ɚ", ia: "ia", ie: "iɛ", iao: "iaʊ", iu: "iou", iou: "iou", ian: "iɛn", in: "in", iang: "iaŋ", ing: "iŋ", iong: "iuŋ", ua: "ua", uo: "uo",
  uai: "uaɪ", ui: "ueɪ", uei: "ueɪ", uan: "uan", un: "uən", uen: "uən", uang: "uaŋ", ueng: "uəŋ", "üe": "yɛ", ve: "yɛ", "üan": "yɛn", van: "yɛn", "ün": "yn", vn: "yn",
  "-i_retroflex": "ɻ̩", "-i_alveolar": "ɨ" };
const INITIALS_ORDER = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"];
const RETROFLEX = new Set(["zh", "ch", "sh", "r"]), ALVEOLAR = new Set(["z", "c", "s"]);
const ZH_PUNCT_MAP = { "。": ".", "，": ",", "！": "!", "？": "?", "、": ",", "；": ";", "：": ":", "…": ".", "—": ",", "“": '"', "”": '"', "‘": "'", "’": "'" };
const ZH_PUNCT = new Set([",", ".", ";", ":", "!", "?", "。", "，", "！", "？", "、", "；", "：", "“", "”", "‘", "’", "…", "—"]);
// Rust char::is_whitespace = Unicode White_Space (built from code points so that no raw separator characters sit in this file)
const WS = new Set([9, 10, 11, 12, 13, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
const isWs = (ch) => WS.has(ch.codePointAt(0));
const RE_ALPHA = /\p{Alphabetic}/u;                                                       // Rust char::is_alphabetic
const isCjk = (ch) => { const c = ch.codePointAt(0); return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf); };

function normalizePinyin(py) {   // y/w spelling conventions and v -> ü
  const s = py.replace(/v/g, "ü");
  if (s.startsWith("yu")) return "ü" + s.slice(2);
  if (s.startsWith("y")) { const rest = s.slice(1); return rest.startsWith("i") ? rest : "i" + rest; }
  if (s.startsWith("w")) { const rest = s.slice(1); return rest.startsWith("u") ? rest : "u" + rest; }
  return s;
}
function splitPinyin(pinyin) {
  for (const init of INITIALS_ORDER) {
    if (!pinyin.startsWith(init)) continue;
    let fin = pinyin.slice(init.length);
    if (fin === "i") { if (RETROFLEX.has(init)) return [init, "-i_retroflex"]; if (ALVEOLAR.has(init)) return [init, "-i_alveolar"]; }
    if ((init === "j" || init === "q" || init === "x") && fin.startsWith("u")) fin = "ü" + fin.slice(1);
    return [init, fin];
  }
  return ["", pinyin];
}
function pinyinToIpa(syllable, tone) {
  const [initial, fin] = splitPinyin(syllable), tokens = [];
  if (initial && INITIAL_TO_IPA[initial]) tokens.push(INITIAL_TO_IPA[initial]);
  if (fin) {
    if (Object.hasOwn(FINAL_TO_IPA, fin)) tokens.push(FINAL_TO_IPA[fin]);
    else for (const ch of fin) if (ch >= "a" && ch <= "z") tokens.push(Object.hasOwn(FINAL_TO_IPA, ch) ? FINAL_TO_IPA[ch] : ch);   // unknown final: letter by letter
  }
  if (tone >= 1 && tone <= 5) tokens.push("tone" + tone);
  return tokens;
}
function extractTone(syl) { const c = syl.charCodeAt(syl.length - 1); return c >= 49 && c <= 53 ? [syl.slice(0, -1), c - 48] : [syl, 5]; }
function applyToneSandhi(st) {   // st: [[normalizedSyllable, tone], …] of one run of consecutive hanzi; in place
  for (let i = 0; i + 1 < st.length; i++) {
    const t = st[i][1], next = st[i + 1][1];
    if (t === 3 && next === 3) { st[i][1] = 2; continue; }                                             // 3 + 3 -> 2 + 3
    if (st[i][0] === "i" && t === 1) { if (next === 4) st[i][1] = 2; else if (next >= 1 && next <= 3) st[i][1] = 4; continue; }   // 一
    if (st[i][0] === "bu" && t === 4 && next === 4) st[i][1] = 2;                                      // 不
  }
}

/**
 * @param {{single: Record<string,string>, phrases: Record<string,string|string[]>}} dicts  parsed pinyin_single.tone3.json
 *   (codepoint as decimal string -> "ni3") and pinyin_phrases.tone3.json (phrase -> "yi2 ge4")
 */
/**
 * Latin tokens a Mandarin speaker reads in Chinese (and so stay in the Chinese piece): a brand name in the loanword table, an
 * acronym in the table, any all-capitals token of up to 6 characters, digits allowed (spelled: `3D`, `MP5`), a single letter. Everything else is
 * an ordinary English word: the backend hands it to the English frontend when that is loaded (see index.js), else it is spelled.
 * @param {string} token  /[A-Za-z0-9]+/ with at least one letter
 */
export function readsAsChinese(token) {
  return Object.hasOwn(LOANWORDS.loanwords, token) || Object.hasOwn(LOANWORDS.acronyms, token.toUpperCase()) || /^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,6}$/.test(token) || /^[A-Za-z]$/.test(token);
}
const DIGIT_PINYIN = ["ling2", "yi1", "er4", "san1", "si4", "wu3", "liu4", "qi1", "ba1", "jiu3"];
/** Latin token -> pinyin syllables (upstream phonemize_embedded_english): loanword -> acronym -> letter by letter. Deviation: digits in
 *  a spelled token are read as Chinese numerals (upstream drops them: `3D` would lose the 3). */
function latinToPinyin(token) {
  if (Object.hasOwn(LOANWORDS.loanwords, token)) return LOANWORDS.loanwords[token];
  const up = token.toUpperCase();
  if (Object.hasOwn(LOANWORDS.acronyms, up)) return LOANWORDS.acronyms[up];
  const out = [];
  for (const ch of up) { if (Object.hasOwn(LOANWORDS.letter_fallback, ch)) out.push(...LOANWORDS.letter_fallback[ch]); else if (ch >= "0" && ch <= "9") out.push(DIGIT_PINYIN[+ch]); }
  return out;
}

export function createChineseG2p({ single, phrases }) {
  const singleDict = new Map(), phraseDict = new Map();
  for (const [k, v] of Object.entries(single)) { const cp = Number(k); if (!Number.isInteger(cp)) continue; const py = Array.isArray(v) ? v[0] : v; if (py) singleDict.set(String.fromCodePoint(cp), py); }
  for (const [k, v] of Object.entries(phrases)) { const list = typeof v === "string" ? v.split(/\s+/).filter(Boolean) : v.map((x) => (Array.isArray(x) ? x[0] : x)); if (list.length) phraseDict.set(k, list); }

  function textToPinyin(chars) {   // -> [{chinese, normalized, tone}] one per character
    const out = [], n = chars.length;
    for (let i = 0; i < n;) {
      const cp = chars[i];
      if (!isCjk(cp)) { out.push({ chinese: false, normalized: "", tone: 0 }); i++; continue; }
      let hit = null, hitLen = 0;
      for (let len = Math.min(n - i, 8); len >= 2; len--) { const p = phraseDict.get(chars.slice(i, i + len).join("")); if (p) { hit = p; hitLen = len; break; } }
      if (hit) {
        for (let j = 0; j < hitLen; j++) { const [base, tone] = j < hit.length ? extractTone(hit[j]) : ["", 5]; out.push({ chinese: true, normalized: normalizePinyin(base), tone }); }
        i += hitLen; continue;
      }
      const raw = singleDict.get(cp);
      if (raw !== undefined) { const [base, tone] = extractTone(raw.split(",")[0]); out.push({ chinese: true, normalized: normalizePinyin(base), tone }); }
      else out.push({ chinese: false, normalized: "", tone: 0 });   // hanzi the dictionary does not know
      i++;
    }
    return out;
  }

  /** == chinese.rs phonemize_chinese_internal: tokens (multi-char tokens not yet PUA-mapped) + prosody rows ([a1,a2,a3] | null) */
  function phonemize(text) {
    const chars = Array.from(text), n = chars.length;
    const wordInfo = new Array(n).fill(null);   // [positionInRun (1-based), runLength] for hanzi
    for (let i = 0; i < n;) { if (!isCjk(chars[i])) { i++; continue; } let j = i; while (j < n && isCjk(chars[j])) j++; for (let k = i; k < j; k++) wordInfo[k] = [k - i + 1, j - i]; i = j; }
    const cp = textToPinyin(chars);
    for (let i = 0; i < n;) {   // tone sandhi over each run of consecutive "chinese" entries
      if (!cp[i].chinese) { i++; continue; }
      let j = i; while (j < n && cp[j].chinese) j++;
      if (j - i >= 2) { const st = cp.slice(i, j).map((c) => [c.normalized, c.tone]); applyToneSandhi(st); st.forEach(([, tone], k) => { cp[i + k].tone = tone; }); }
      i = j;
    }
    const tokens = [], prosody = [];
    for (let idx = 0; idx < n; idx++) {
      const ch = chars[idx], c = cp[idx];
      // A Latin token (letters and digits, at least one letter) is read the way a Mandarin speaker reads it (2026-10-01; before,
      // its letters went to the model one by one as phoneme symbols — `iPhone` came out as noise). Tokens the English frontend
      // should read never get here when English is loaded: index.js cuts them out first.
      if (/[A-Za-z0-9]/.test(ch) && !c.chinese) {
        let j = idx; while (j < n && /[A-Za-z0-9]/.test(chars[j])) j++;
        const tok = chars.slice(idx, j).join("");
        if (/[A-Za-z]/.test(tok)) {
          const syl = latinToPinyin(tok);
          syl.forEach((py, k) => { const [base, tone] = extractTone(py); for (const t of pinyinToIpa(normalizePinyin(base), tone)) { tokens.push(t); prosody.push([tone, k + 1, syl.length]); } });
          idx = j - 1; continue;
        }
      }
      if (!c.chinese) {
        if (Object.hasOwn(ZH_PUNCT_MAP, ch)) { tokens.push(ZH_PUNCT_MAP[ch]); prosody.push(null); }
        else if (ZH_PUNCT.has(ch)) { tokens.push(ch); prosody.push(null); }
        else if (isWs(ch)) { tokens.push(" "); prosody.push([0, 0, 0]); }
        else if ((ch >= "0" && ch <= "9") || RE_ALPHA.test(ch)) { tokens.push(ch); prosody.push([0, 0, 1]); }
        continue;
      }
      let normalized = c.normalized; const tone = c.tone;
      const erhua = normalized.length > 1 && normalized !== "er" && normalized.endsWith("r");
      if (erhua) normalized = normalized.slice(0, -1);
      const ipa = pinyinToIpa(normalized, tone);
      if (erhua && ipa.length) { if (ipa[ipa.length - 1].startsWith("tone")) ipa.splice(ipa.length - 1, 0, "ɚ"); else ipa.push("ɚ"); }
      const [pos, len] = wordInfo[idx] || [1, 1];
      for (const t of ipa) { tokens.push(t); prosody.push([tone, pos, len]); }
    }
    return { tokens, prosody };
  }

  /**
   * == WasmPhonemizer.phonemize(text, "zh"): language-hint path (question marks are stripped and become the EOS id) + Rust
   * PiperEncoder (BOS, pad, then per token its ids followed by ONE pad — also after a token that had no id — then EOS).
   */
  function encodeRustLayout(text, phonemeIdMap) {
    const { tokens, prosody } = phonemize(text);
    const pad = phonemeIdMap["_"][0], ids = [phonemeIdMap["^"][0], pad], pros = [[0, 0, 0], [0, 0, 0]];
    let eos = "$";
    tokens.forEach((tok, i) => {
      const mapped = TOKEN2CHAR[tok] ?? tok;
      if (mapped === "^" || mapped === "$" || mapped === "?" || mapped === TOKEN2CHAR["?!"] || mapped === TOKEN2CHAR["?."] || mapped === TOKEN2CHAR["?~"]) { if (mapped !== "^") eos = mapped; return; }
      for (const ch of mapped) { const m = phonemeIdMap[ch]; if (m) for (const id of m) { ids.push(id); pros.push(prosody[i] || [0, 0, 0]); } }
      ids.push(pad); pros.push([0, 0, 0]);
    });
    ids.push((phonemeIdMap[eos] || phonemeIdMap["$"])[0]); pros.push([0, 0, 0]);
    return { ids, pros };
  }

  /**
   * text -> { ids, pros } (model input).
   *   layout "wasm" (default): exactly what the previous WASM-based path fed the model = Rust encoder + toReferenceLayout().
   *     A question mark is not an inline token; the last one seen becomes the EOS id (this mirrors training preprocessing).
   *   layout "python": exactly what the Python reference runtime (infer_onnx --language zh) feeds — "?" stays inline, EOS is "$",
   *     prosody rows shift past dropped digits/letters too. Identical to the reference on 3122 of 3124 test sentences.
   * The two differ only in sentences with "?" / "？" or with characters that have no phoneme id (digits, Latin capitals).
   */
  function encode(text, phonemeIdMap, layout = "wasm") {
    if (layout === "python") { const t = phonemize(text); return encodeTokens(t.tokens, t.prosody, phonemeIdMap); }
    const r = encodeRustLayout(text, phonemeIdMap); return toReferenceLayout(r.ids, r.pros);
  }

  return { phonemize, encodeRustLayout, encode };
}

/**
 * Rust encoder layout -> Python (reference) layout, for languages whose phonemizer emits no pause token (zh).
 * The Rust encoder pads after EVERY token, also after one that had no id (",", "." …), so a run of r zeros means r-1 dropped
 * symbols. The Python encoder (used by the reference runtime and by training preprocessing) emits a single pad there, and — a quirk —
 * drops such symbols from the ids but not from the prosody list, so every id after a dropped symbol carries the prosody row of the
 * token before it. Both are re-created here.
 */
export function toReferenceLayout(ids, pros) {
  const oi = [], op = [], unfiltered = [], keptAt = [];
  for (let i = 0; i < ids.length;) {
    if (ids[i] !== 0) { if (i > 0 && i < ids.length - 1) { keptAt.push(oi.length); unfiltered.push(pros[i]); } oi.push(ids[i]); op.push(pros[i]); i++; continue; }
    let j = i; while (j < ids.length && ids[j] === 0) j++;
    oi.push(0); op.push([0, 0, 0]);
    for (let k = 1; k < j - i; k++) unfiltered.push([0, 0, 0]);
    i = j;
  }
  keptAt.forEach((pos, k) => { op[pos] = unfiltered[k]; });
  return { ids: oi, pros: op };
}
