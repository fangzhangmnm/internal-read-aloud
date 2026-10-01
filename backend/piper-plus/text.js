// text.js — small text helpers of the backend that are NOT part of the reference runtime's behaviour.
// created 2026-10-01 by Claude Fable 5.1

const CLAUSE_BREAK = new Set([",", ";", ":", "，", "；", "：", "、", "—"]);
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";

/**
 * Cut one sentence after clause punctuation (, ; : ， ； ： 、 —). Pieces shorter than `minChars` are glued to a neighbour.
 * A comma or colon between two digits (1,980 / 3:45) is not a break.
 * Why: English and Chinese get no pause token at commas (the model's phoneme map has no symbol for them), so the reference
 * runtime reads a long sentence in one breath. The backend synthesizes the pieces separately and joins them with a short silence.
 * @param {string} sentence
 * @param {number} [minChars]
 * @returns {string[]}
 */
export function splitClauses(sentence, minChars = 20) {
  const chars = Array.from(sentence), raw = []; let cur = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]; cur += ch;
    if (!CLAUSE_BREAK.has(ch)) continue;
    if ((ch === "," || ch === ":") && isDigit(chars[i - 1]) && isDigit(chars[i + 1])) continue;
    raw.push(cur); cur = "";
  }
  if (cur) raw.push(cur);
  const out = [];
  for (const piece0 of raw) {
    const piece = piece0.trim(); if (!piece) continue;
    if (out.length && (Array.from(out[out.length - 1]).length < minChars || Array.from(piece).length < minChars)) out[out.length - 1] += (/[a-zA-Z,;:]$/.test(out[out.length - 1]) ? " " : "") + piece;
    else out.push(piece);
  }
  return out;
}

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
