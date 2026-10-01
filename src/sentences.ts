// 分句（纯函数，零 DOM 零网络）：文本 → 每一句在原文里的字符偏移。created 2026-10-01 by Claude Fable 5.1
//
// 输入：任意一段正文（章节的字符串，含换行）。输出：一组互不重叠、按顺序的 [start, end)。
//   · 句末 = 。！？!?…‥．和它后面紧跟的收尾符号（」』）】”’》 等）；英文句点只在后面是空白 / 行尾 / 收尾符号时才算。
//   · 换行一定断句（段落）。
//   · 引号 / 括号里的句末不断（「…。…。」是一句话里的一段对白）；但引号一合上、后面又没有接着的话（空白 / 换行 / 另一个开引号 / 文末），就在那里断。
//     例：`「ハンスや、どこへいく。」とききました。` 是一句；`「你到底去不去？」\n他问。` 是两句。
//   · 太长（> MAX_SPAN）还没遇到句末：在最后一个逗号类符号处断；连逗号都没有就硬断。引号里憋得太长同理。
//   · 只有标点和空白的片段不算一句（丢掉）。每句的 start 落在第一个非空白字符上，end 不含尾随空白。
// 偏移按 UTF-16 码元算（和 String.prototype.slice / DOM Range 的偏移是同一种）。

/** 原文里的一句：[start, end)。 */
export interface SentenceSpan { start: number; end: number }
/** 朗读用的语言。 */
export type SpeechLang = "ja" | "zh" | "en";

/** 一句最多这么多码元；超过就找逗号断（合成引擎对超长输入又慢又容易念崩）。 */
export const MAX_SPAN = 160;

const TERMINATORS = new Set(["。", "！", "？", "!", "?", "…", "‥", "．"]);
const OPENERS = new Set(["「", "『", "（", "(", "【", "《", "〈", "“", "‘", "〝"]);
const CLOSERS = new Set(["」", "』", "）", ")", "】", "》", "〉", "”", "’", "〟"]);
const SOFT_BREAKS = new Set(["、", "，", ",", "；", ";", "：", ":", "—", "─"]);
const isSpace = (c: string) => c === " " || c === "\t" || c === "　" || c === "\r" || c === " ";
/** 有没有能念出声的字（字母 / 数字 / 假名 / 汉字…）。只有标点和空白 = 没有。 */
function speakable(s: string): boolean { return /[\p{L}\p{N}]/u.test(s); }

export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const n = text.length;
  let start = 0, depth = 0, lastSoft = -1;
  const push = (a: number, b: number) => {
    while (a < b && (isSpace(text[a]!) || text[a] === "\n")) a++;
    while (b > a && (isSpace(text[b - 1]!) || text[b - 1] === "\n")) b--;
    if (b > a && speakable(text.slice(a, b))) out.push({ start: a, end: b });
  };
  const cut = (at: number) => { push(start, at); start = at; depth = 0; lastSoft = -1; };

  for (let i = 0; i < n; i++) {
    const c = text[i]!;
    if (c === "\n") { cut(i + 1); continue; }
    if (OPENERS.has(c)) { depth++; continue; }
    if (CLOSERS.has(c)) {
      if (depth > 0) depth--;
      // 引号合上，且合上前是句末：后面没有接着的话就断
      if (depth === 0 && i > start && TERMINATORS.has(text[i - 1]!)) {
        let j = i + 1;
        while (j < n && CLOSERS.has(text[j]!)) j++;
        let k = j; while (k < n && isSpace(text[k]!)) k++;
        if (k >= n || text[k] === "\n" || OPENERS.has(text[k]!) || k > j) { i = j - 1; cut(j); }
      }
      continue;
    }
    if (SOFT_BREAKS.has(c)) lastSoft = i + 1;
    const isAsciiDot = c === ".";
    if (TERMINATORS.has(c) || isAsciiDot) {
      // 吃掉连着的句末符号（？！、……）
      let j = i + 1;
      while (j < n && (TERMINATORS.has(text[j]!) || text[j] === ".")) j++;
      if (isAsciiDot && !TERMINATORS.has(text[j - 1]!)) {
        // 英文句点：后面得是空白 / 行尾 / 收尾符号才算句末（3.14、e.g.x 不断）
        const nx = text[j];
        if (!(nx === undefined || nx === "\n" || isSpace(nx) || CLOSERS.has(nx))) { i = j - 1; continue; }
      }
      if (depth > 0) { i = j - 1; }   // 引号里：不断（除非太长，下面兜底）
      else {
        while (j < n && CLOSERS.has(text[j]!)) j++;
        i = j - 1; cut(j); continue;
      }
    }
    if (i + 1 - start >= MAX_SPAN) {
      if (lastSoft > start) { const at = lastSoft; i = at - 1; cut(at); }
      else cut(i + 1);
    }
  }
  push(start, n);
  return out;
}

/** offset 落在哪一句：在句内 → 那一句；在两句之间 → 后面那一句；过了最后一句 → 最后一句；没有句子 → -1。 */
export function sentenceAt(spans: readonly SentenceSpan[], offset: number): number {
  if (!spans.length) return -1;
  let lo = 0, hi = spans.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (spans[mid]!.end <= offset) lo = mid + 1; else hi = mid; }
  return lo;
}

/** 这段文字用哪种语言念：有假名 = 日语；有汉字没假名 = 中文；都没有 = 英语。只看前 4000 个码元（整本书不用全扫）。 */
export function detectLang(text: string): SpeechLang {
  const s = text.length > 4000 ? text.slice(0, 4000) : text;
  if (/[぀-ヿｦ-ﾟ]/.test(s)) return "ja";
  if (/[㐀-鿿豈-﫿]/.test(s)) return "zh";
  return "en";
}
