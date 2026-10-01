// text.js — small text helpers of the backend that are NOT part of the reference runtime's behaviour.
// created 2026-10-01 by Claude Fable 5.1

// ---- pauses inside one sentence (English / Chinese) -------------------------------------------------------------------
// The model gets no pause token at punctuation in these languages, so the reference runtime reads a whole span in one breath.
// The backend cuts the span into pieces, synthesizes them separately and joins them with silence.
//
// Systematic rule (instead of one special case per character sequence): everything between two runs of speakable text is ONE
// punctuation cluster (`，“`  `！”`  `？”“`  `——`  `，”`  `, "`). The classes present in the cluster decide the pause:
//
//   cluster contains            kind     pause    example                                   glued when
//   sentence-final mark         strong   400 ms   呀！”|苏…   走。”|“好   他想……|算了        a side has < 2 letters / digits / hanzi
//   dash run (—— / --)          dash     350 ms   these--|first   一下——|然后               same
//   clause mark + opening quote intro    350 ms   他说，|“好。”   She said,|"Wait."          same
//   clause mark (, ; : ， ； ： 、) weak     250 ms   很好，|我们   “好吧，”|他说             piece shorter than minChars -> glued to the NEXT
//   quotes / brackets only      none     —        所谓“自由”的意思                          —
//
// The cut is always placed before the first opening quote of the cluster (the quote belongs to what follows), otherwise at the
// end of the cluster. ASCII "." is not a mark here (inside a span it is a decimal point or an abbreviation); a comma or colon
// between two digits (1,980 / 3:45) and a single hyphen are part of the text. Nothing is cut inside inline maths / inline code.
export const PAUSE_MS = Object.freeze({ strong: 400, dash: 350, intro: 350, weak: 250 });
const TERM = new Set(["。", "！", "？", "!", "?", "…", "‥"]);
const CLAUSE = new Set([",", ";", ":", "，", "；", "：", "、"]);
const DASH = new Set(["—", "–", "―", "─"]);
const OPEN = new Set(["“", "‘", "「", "『", "（", "(", "【", "《", "〈", "〝", "[", "［"]);
const CLOSE = new Set(["”", "’", "」", "』", "）", ")", "】", "》", "〉", "〟", "]", "］"]);
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const isSpeak = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c) => c === " " || c === "\t" || c === "　" || c === " ";
const speakable = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
// Inline maths / inline code (`…`, \(…\), $…$ with the dollars touching the content): never cut inside.
const INLINE_VERBATIM = /`[^`\n]+`|\\\([^\n]*?\\\)|\$(?=[^\s$])[^$\n]*[^\s$]\$(?!\d)|\$[^\s$]\$(?!\d)/g;

/** Class of the character at i: "term" | "clause" | "dash" | "open" | "close" | "space" | "text". */
function classAt(chars, i) {
  const ch = chars[i];
  if (TERM.has(ch)) return "term";
  if (CLAUSE.has(ch)) return (ch === "," || ch === ":") && isDigit(chars[i - 1]) && isDigit(chars[i + 1]) ? "text" : "clause";
  if (DASH.has(ch)) return "dash";
  if (ch === "-") return chars[i + 1] === "-" || chars[i - 1] === "-" ? "dash" : "text";
  if (OPEN.has(ch)) return "open";
  if (CLOSE.has(ch)) return ch === "’" && isSpeak(chars[i - 1]) && isSpeak(chars[i + 1]) ? "text" : "close";   // don’t
  if (ch === '"' || ch === "'") {   // ASCII quotes: an apostrophe inside a word is text; otherwise open before a word, close after one
    const before = isSpeak(chars[i - 1]), after = isSpeak(chars[i + 1]);
    if (ch === "'" && before && after) return "text";
    return after && !before ? "open" : "close";
  }
  if (isSpace(ch)) return "space";
  return "text";
}

/**
 * Cut one sentence into pieces with the pause that follows each (the last piece has pauseMs 0).
 * @param {string} sentence
 * @param {number} [minChars] weak-break pieces shorter than this are glued (en: 20, zh: 5)
 * @returns {{ text: string, kind: "strong" | "dash" | "intro" | "weak" | "end", pauseMs: number }[]}
 */
export function splitClausesDetailed(sentence, minChars = 20) {
  // code-unit ranges that must stay whole -> the same ranges in code points (the loop below walks code points)
  const keep = []; INLINE_VERBATIM.lastIndex = 0;
  for (let m = INLINE_VERBATIM.exec(sentence); m; m = INLINE_VERBATIM.exec(sentence)) { const a = Array.from(sentence.slice(0, m.index)).length; keep.push([a, a + Array.from(m[0]).length]); }
  const chars = Array.from(sentence), cls = new Array(chars.length);
  for (let i = 0, k = 0; i < chars.length; i++) {
    while (k < keep.length && keep[k][1] <= i) k++;
    cls[i] = k < keep.length && keep[k][0] <= i ? "text" : classAt(chars, i);
  }
  // walk the clusters: a maximal run of non-text characters that holds at least one mark
  const raw = []; let from = 0, i = 0, seenText = false;
  while (i < chars.length) {
    if (cls[i] === "text") { seenText = true; i++; continue; }
    let j = i; const has = { term: false, clause: false, dash: false, open: false, close: false };
    let firstOpen = -1, markBeforeOpen = false;
    while (j < chars.length && cls[j] !== "text") {
      const c = cls[j];
      if (c !== "space") { has[c] = true; if (c === "open") { if (firstOpen < 0) firstOpen = j; } else if (firstOpen < 0) markBeforeOpen = true; }
      j++;
    }
    const kind = has.term ? "strong" : has.dash ? "dash" : has.clause && has.open ? "intro" : has.clause ? "weak" : null;
    if (kind && seenText && j < chars.length) {   // a cluster at the very start or the very end is not a break
      const cutAt = firstOpen >= 0 && markBeforeOpen ? firstOpen : j;
      raw.push({ text: chars.slice(from, cutAt).join(""), kind }); from = cutAt;
    }
    i = j;
  }
  if (from < chars.length) raw.push({ text: chars.slice(from).join(""), kind: "end" });
  // Gluing. A short piece that ends at a weak break introduces what follows (`second, because …`), so it is carried FORWARD;
  // only a short tail (nothing after it) is glued backward. The other kinds are glued only around a piece with < 2 speakable chars.
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
  return out.map((p, idx) => ({ text: p.text, kind: idx === out.length - 1 ? "end" : p.kind, pauseMs: idx === out.length - 1 ? 0 : PAUSE_MS[p.kind] ?? PAUSE_MS.weak }));
}
/** The pieces only. @param {string} sentence @param {number} [minChars] @returns {string[]} */
export function splitClauses(sentence, minChars = 20) { return splitClausesDetailed(sentence, minChars).map((p) => p.text); }

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
