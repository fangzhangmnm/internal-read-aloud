// 分句（纯函数，零 DOM 零网络）：文本 → 每一句在原文里的字符偏移。created 2026-10-01 by Claude Fable 5.1
//
// 输入：任意一段正文（章节的字符串，含换行）。输出：一组互不重叠、按顺序的 [start, end)。
//   · 句末 = 。！？!?…‥．和它后面紧跟的收尾符号（」』）】”’》 等）；英文句点只在后面是空白 / 行尾 / 收尾符号时才算。
//   · 换行一定断句（段落）。
//   · 引号 / 括号里的句末不断（「…。…。」是一句话里的一段对白）；但引号一合上、后面又没有接着的话（空白 / 换行 / 另一个开引号 / 文末），就在那里断。
//     例：`「ハンスや、どこへいく。」とききました。` 是一句；`「你到底去不去？」\n他问。` 是两句。
//   · 太长（> MAX_SPAN）还没遇到句末：在最后一个逗号类符号处断；连逗号都没有就硬断。引号里憋得太长同理。
//   · 只有标点和空白的片段不算一句（丢掉）。每句的 start 落在第一个非空白字符上，end 不含尾随空白。
//   · **公式 / 代码的护栏**（user 2026-10-01「护栏一下碰到长公式code latex的时候不会被断的支离破碎的情况」）：
//       整块的（``` 围栏代码块、$$…$$ / \[…\] / \begin…\end 的公式块、符号密度很高的行）**不算句子**——不念，也就不会被标点切碎；
//       句子里夹的行内公式 `$…$` / `\(…\)` 和行内代码 `` `…` ``：里面的标点不断句，超长兜底也不会切在它中间。
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

/** 行内公式 / 行内代码：`…`、\(…\)、$…$（$ 紧贴内容：`$5 and $10` 这种钱数不算）。 */
const INLINE_VERBATIM = /`[^`\n]+`|\\\([^\n]*?\\\)|\$(?=[^\s$])[^$\n]*[^\s$]\$(?!\d)|\$[^\s$]\$(?!\d)/g;
/** 代码 / 公式里才成堆出现的符号（不含中文标点、%、#、@ 这些正文里也常见的）。 */
const CODE_SYMBOL = /[{}[\]<>\\^_=+*/|~$;`]/g;
/** 这一行是不是「符号密度很高」：符号至少 8 个、且占非空白字符的三成以上。（`E = mc^2`、`HP+5，MP+3` 这种不算。） */
function symbolDense(line: string): boolean {
  const body = line.replace(/\s+/g, "");
  const sym = (body.match(CODE_SYMBOL) ?? []).length;
  return sym >= 8 && sym / body.length >= 0.3;
}
/**
 * 护栏预扫：哪些范围整块不算句子（skip），哪些范围里不许断句（keep）。都是 [start, end) 的原文偏移，按顺序、互不重叠。
 */
function verbatimRanges(text: string): { skip: [number, number][]; keep: [number, number][] } {
  const skip: [number, number][] = [], keep: [number, number][] = [];
  let fence: string | null = null, block: RegExp | null = null;   // 围栏代码块的围栏符 / 公式块的结束标记
  let pos = 0;
  for (const line of text.split("\n")) {
    const a = pos, b = pos + line.length; pos = b + 1;
    const t = line.trim();
    if (fence) { skip.push([a, b]); if (t.startsWith(fence)) fence = null; continue; }
    if (block) { skip.push([a, b]); if (block.test(t)) block = null; continue; }
    const f = /^(```+|~~~+)/.exec(t);
    if (f) { skip.push([a, b]); fence = f[1]!; continue; }
    const dollars = (t.match(/\$\$/g) ?? []).length;
    if (dollars > 0) { skip.push([a, b]); if (dollars % 2 === 1) block = /\$\$/; continue; }
    if (/^\\\[/.test(t)) { skip.push([a, b]); if (!/\\\]/.test(t)) block = /\\\]/; continue; }
    const env = /^\\begin\{([^}]+)\}/.exec(t);
    if (env) { skip.push([a, b]); const end = `\\end{${env[1]}}`; if (!t.includes(end)) block = new RegExp(end.replace(/[\\{}*]/g, "\\$&")); continue; }
    if (symbolDense(t)) { skip.push([a, b]); continue; }
    INLINE_VERBATIM.lastIndex = 0;
    for (let m = INLINE_VERBATIM.exec(line); m; m = INLINE_VERBATIM.exec(line)) keep.push([a + m.index, a + m.index + m[0].length]);
  }
  return { skip, keep };
}

export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  const n = text.length;
  let start = 0, depth = 0, lastSoft = -1;
  const { skip, keep } = verbatimRanges(text);
  let si = 0, ki = 0;
  const push = (a: number, b: number) => {
    while (a < b && (isSpace(text[a]!) || text[a] === "\n")) a++;
    while (b > a && (isSpace(text[b - 1]!) || text[b - 1] === "\n")) b--;
    if (b > a && speakable(text.slice(a, b))) out.push({ start: a, end: b });
  };
  const cut = (at: number) => { push(start, at); start = at; depth = 0; lastSoft = -1; };

  for (let i = 0; i < n; i++) {
    // 整块不算句子的范围：先把前面的收尾，再整块跳过
    while (si < skip.length && skip[si]![1] <= i) si++;
    if (si < skip.length && skip[si]![0] === i && skip[si]![1] > i) { cut(i); i = skip[si]![1] - 1; start = i + 1; continue; }
    // 行内公式 / 代码：里面不断句，直接跳到它的末尾（超长兜底在下面照常查，但只会切在它之后）
    while (ki < keep.length && keep[ki]![1] <= i) ki++;
    if (ki < keep.length && keep[ki]![0] === i) {
      i = keep[ki]![1] - 1;
      if (i + 1 - start >= MAX_SPAN) { if (lastSoft > start) { const at = lastSoft; i = at - 1; cut(at); } else cut(i + 1); }
      continue;
    }
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
