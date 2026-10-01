// text.js — small text helpers of the backend that are NOT part of the reference runtime's behaviour.
// created 2026-10-01 by Claude Fable 5.1

const CLAUSE_BREAK = new Set([",", ";", ":", "，", "；", "：", "、"]);
// Dashes: a run of dash characters, or two or more ASCII hyphens (`these--first`, Project Gutenberg style). One hyphen is a hyphen.
const DASH = new Set(["—", "–", "―", "─"]);
// Sentence-final marks that can sit INSIDE one sentence span (the sentence splitter keeps `“…！”他说，` together, and so it should).
// ASCII "." is left out on purpose: inside a span it is a decimal point or an abbreviation.
const STRONG_BREAK = new Set(["。", "！", "？", "!", "?", "…", "‥"]);
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "〉", "〟", '"', "'"]);
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const speakable = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
// Inline maths / inline code (`…`, \(…\), $…$ with the dollars touching the content): never cut inside.
const INLINE_VERBATIM = /`[^`\n]+`|\\\([^\n]*?\\\)|\$(?=[^\s$])[^$\n]*[^\s$]\$(?!\d)|\$[^\s$]\$(?!\d)/g;

/**
 * Cut one sentence into the pieces that are synthesized separately and joined with a short silence.
 *   weak break   after clause punctuation (, ; : ， ； ： 、). A piece shorter than `minChars` is glued to the NEXT piece
 *                (`second, because …`); a short last piece is glued to the one before it.
 *                A comma or colon between two digits (1,980 / 3:45) is not a break.
 *   dash break   after a run of dashes (— – ―) or of two or more ASCII hyphens: `…were these--` | `first, …`.
 *   strong break after sentence-final marks in the middle of the span (。！？!?… plus any closing quotes / brackets that follow),
 *                e.g. `“可是船上有奶牛呀！”苏一边跑一边说，` -> `“可是船上有奶牛呀！”` | `苏一边跑一边说，`.
 *   Dash and strong breaks are glued only when one side has fewer than 2 letters / digits / hanzi (`啊！啊！快跑。` stays
 *   `啊！啊！` | `快跑。`).
 *   Nothing is cut inside inline maths / inline code.
 * Why: English and Chinese get no pause token at punctuation (the model's phoneme map has no symbol for it), so the reference
 * runtime reads a whole span in one breath. Which kind of break a piece ended at: `endsStrong(piece)` / `endsDash(piece)`.
 * @param {string} sentence
 * @param {number} [minChars]
 * @returns {string[]}
 */
export function splitClauses(sentence, minChars = 20) {
  // code-unit ranges that must stay whole -> the same ranges in code points (the loop below walks code points)
  const keep = []; INLINE_VERBATIM.lastIndex = 0;
  for (let m = INLINE_VERBATIM.exec(sentence); m; m = INLINE_VERBATIM.exec(sentence)) { const a = Array.from(sentence.slice(0, m.index)).length; keep.push([a, a + Array.from(m[0]).length]); }
  const chars = Array.from(sentence), raw = []; let cur = "", k = 0;
  const isDash = (i) => DASH.has(chars[i]) || (chars[i] === "-" && (chars[i + 1] === "-" || chars[i - 1] === "-"));
  for (let i = 0; i < chars.length; i++) {
    while (k < keep.length && keep[k][1] <= i) k++;
    if (k < keep.length && keep[k][0] === i) { cur += chars.slice(i, keep[k][1]).join(""); i = keep[k][1] - 1; continue; }
    const ch = chars[i]; cur += ch;
    if (STRONG_BREAK.has(ch)) {
      if (STRONG_BREAK.has(chars[i + 1])) continue;                                   // ？！ / …… : break after the last one
      while (CLOSERS.has(chars[i + 1])) cur += chars[++i];                             // the closing quote belongs to this piece
      raw.push({ text: cur, kind: "strong" }); cur = ""; continue;
    }
    if (isDash(i)) {
      if (isDash(i + 1)) continue;                                                     // —— / --- : break after the run
      raw.push({ text: cur, kind: "dash" }); cur = ""; continue;
    }
    if (!CLAUSE_BREAK.has(ch)) continue;
    if ((ch === "," || ch === ":") && isDigit(chars[i - 1]) && isDigit(chars[i + 1])) continue;
    raw.push({ text: cur, kind: "weak" }); cur = "";
  }
  if (cur) raw.push({ text: cur, kind: "weak" });
  // Gluing. A short piece that ends at a weak break introduces what follows (`second, because …`), so it is carried FORWARD;
  // only a short tail (nothing after it) is glued backward.
  const len = (t) => Array.from(t).length;
  const join = (a, b, kindOfA) => a + (/[\x21-\x7e]$/.test(a) && /^[\x21-\x7e]/.test(b) && kindOfA !== "dash" ? " " : "") + b;
  const pieces = raw.map((p) => ({ text: p.text.trim(), kind: p.kind })).filter((p) => p.text);
  const out = [];   // { text, kind }: kind = the break AFTER this piece
  let carry = "";
  pieces.forEach((p, idx) => {
    const text = carry ? join(carry, p.text, "weak") : p.text; carry = "";
    if (p.kind === "weak" && idx < pieces.length - 1 && len(text) < minChars) { carry = text; return; }
    const prev = out[out.length - 1];
    const glueBack = prev && (prev.kind === "weak" ? len(text) < minChars : speakable(prev.text) < 2 || speakable(text) < 2);
    if (glueBack) { prev.text = join(prev.text, text, prev.kind); prev.kind = p.kind; }
    else out.push({ text, kind: p.kind });
  });
  return out.map((p) => p.text);
}
/** Did this piece end at a strong break (sentence-final mark, optionally followed by closing quotes)? The pause after it is the longest. */
export function endsStrong(piece) { return /[。！？!?…‥]["'”’」』）)】》〉〟]*$/u.test(piece); }
/** Did this piece end at a dash break? */
export function endsDash(piece) { return /(?:--+|[—–―─]+)$/u.test(piece); }

// ---- Chinese: Arabic numerals -> hanzi -------------------------------------------------------------------------------
// The reference Chinese G2P (and the Rust WASM) silently DROPS digits: "2026年10月1日" would be read as "年月日".
// This pre-pass writes them out so they are spoken. Deliberately simple: integers, decimals, percent, and digit-by-digit
// reading for years (3-4 digits before 年) and for runs too long to be a number.
const ZD = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const digitByDigit = (s) => Array.from(s, (c) => ZD[+c]).join("");
function below10000(n, leadingZeroOk) {   // 1..9999 -> hanzi (no 万/亿)
  const units = ["", "十", "百", "千"]; let out = "", zero = false;
  const d = String(n).padStart(4, "0");
  for (let i = 0; i < 4; i++) {
    const v = +d[i], u = units[3 - i];
    if (v === 0) { if (out) zero = true; continue; }
    if (zero || (leadingZeroOk && !out && i > 0)) { out += "零"; zero = false; }
    out += ZD[v] + u;
  }
  return out;
}
function integerToHanzi(s) {
  s = s.replace(/^0+(?=\d)/, "");
  if (s.length > 12) return digitByDigit(s);
  const n = Number(s);
  if (n === 0) return "零";
  const yi = Math.floor(n / 1e8), wan = Math.floor((n % 1e8) / 1e4), rest = n % 1e4;
  let out = "";
  if (yi) out += below10000(yi, false) + "亿";
  if (wan) out += below10000(wan, !!yi && wan < 1000) + "万"; else if (yi && rest) out += "零";
  if (rest) out += below10000(rest, !!(yi || wan) && rest < 1000 && !(out.endsWith("零")));
  return out.replace(/^一十/, "十");
}
/**
 * @param {string} text
 * @returns {string} text with ASCII / full-width digits written out in hanzi
 */
export function normalizeZhNumbers(text) {
  const t = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48)).replace(/(\d),(?=\d{3}(\D|$))/g, "$1");
  return t.replace(/(\d+)(?:\.(\d+))?(%|％)?(年)?/g, (m, int, frac, pct, year) => {
    if (year && !frac && !pct && int.length === 4) return digitByDigit(int) + "年";   // 2026年 -> 二零二六年
    let s = integerToHanzi(int) + (frac ? "点" + digitByDigit(frac) : "");
    if (pct) s = "百分之" + s;
    return s + (year || "");
  });
}
