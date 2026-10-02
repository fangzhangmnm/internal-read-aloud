// 语言路由（纯函数，零 DOM 零网络）：一段正文的主语言、一句话该交给哪种语言的前端念、一段正文要装哪几种语言。
// created 2026-10-01 by Claude Opus 5.5
// user 2026-10-01「每句话路由不同的前端可以吗…我们试试吧」「你不是有断句吗，就是每个断句，去判断」。
//
// 规则（只认中 / 日 / 英三种）：
//   · 主语言（contextLang）：数假名、汉字、拉丁字母。假名占汉字 + 假名的四分之一以上 = 日语（中文网文里偶尔一个「の」不算）；
//     有汉字 = 中文；都没有 = 英语。拉丁字母比汉字 + 假名多三倍以上 = 英语。
//   · 一句话（langRuns）：
//       没有假名也没有汉字 → 英语（全是数字 / 标点 → 主语言）。
//       没有假名、有汉字 → 中文；但主语言是日语、这句又没有「只有中文才有的字」→ 日语（日文里的纯汉字句：「東京都。」）。
//       有假名、没有「只有中文才有的字」→ 日语。
//       有假名、也有「只有中文才有的字」（学日语的书：`这个词读作「せんせい」，意思是老师。`）→ 拆开：假名段日语；汉字段里有
//       只有中文才有的字 → 中文，否则紧挨着假名 → 日语，否则 → 中文。拉丁字母跟着前一段（日语前端、中文前端里各自处理英文）。
//       开引号 / 开括号跟着后一段，别的标点和空白跟着前一段。
//   · 句子里的英文单词不在这里拆：日语前端自己把英文交给英语前端；中文后端把念不成中文腔的英文词切出来交给英语前端。
//     所以正文里只要有两个字母以上的英文词，langsIn 就把英语也算上。
// 「只有中文才有的字」= zh-only-chars.generated.ts（用日语前端自己的词典判出来的，883 个常用字）。
import { ZH_ONLY_CHARS } from "./zh-only-chars.generated.ts";
import { splitSentences, type SpeechLang } from "./sentences.ts";

const ZH_ONLY = new Set(Array.from(ZH_ONLY_CHARS));
type Cls = "kana" | "han" | "latin" | "neutral";
function cls(ch: string): Cls {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x3041 && c <= 0x3096) || (c >= 0x309b && c <= 0x309f) || (c >= 0x30a1 && c <= 0x30fa) || (c >= 0x30fc && c <= 0x30ff) || (c >= 0xff66 && c <= 0xff9f) || c === 0x3005 || c === 0x3006) return "kana";
  if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x20000 && c <= 0x2fa1f) || c === 0x3007) return "han";
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xff21 && c <= 0xff3a) || (c >= 0xff41 && c <= 0xff5a)) return "latin";
  return "neutral";
}
const OPENERS = new Set(["「", "『", "“", "‘", "（", "(", "【", "《", "〈", "〝", "[", "［", "\"", "'"]);

/** 一段正文的主语言（只看前 20000 个码元）。 */
export function contextLang(text: string): SpeechLang {
  let kana = 0, han = 0, latin = 0;
  for (const ch of text.length > 20000 ? text.slice(0, 20000) : text) {
    const k = cls(ch);
    if (k === "kana") kana++; else if (k === "han") han++; else if (k === "latin") latin++;
  }
  const cjk = kana + han;
  if (cjk === 0 || latin > cjk * 3) return "en";
  if (kana >= Math.max(3, cjk * 0.25) || han === 0) return "ja";
  return "zh";
}

/** 一句话里的一段：交给哪种语言的前端念。 */
export interface LangRun { lang: SpeechLang; text: string }

/** 一句话 → 按语言切成几段（多数句子只有一段）。各段文字拼起来 = 原句。ctx = 这段正文的主语言（contextLang）。 */
export function langRuns(sentence: string, ctx: SpeechLang): LangRun[] {
  const chars = Array.from(sentence), k = chars.map(cls);
  const hasKana = k.includes("kana"), hasHan = k.includes("han");
  const zhOnly = chars.some((ch) => ZH_ONLY.has(ch));
  if (!hasKana && !hasHan) return [{ lang: k.includes("latin") ? "en" : ctx, text: sentence }];
  if (!hasKana) return [{ lang: ctx === "ja" && !zhOnly ? "ja" : "zh", text: sentence }];
  if (!zhOnly) return [{ lang: "ja", text: sentence }];

  // 中日混排：先按文字种类切成段（标点暂时挂起），再给每段定语言
  type Seg = { kind: Cls; from: number; to: number };
  const segs: Seg[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (k[i] === "neutral") continue;
    const last = segs[segs.length - 1];
    if (last && last.kind === k[i] && last.to === i) last.to = i + 1;
    else segs.push({ kind: k[i]!, from: i, to: i + 1 });
  }
  const touchesKana = (s: Seg) => segs.some((o) => o.kind === "kana" && (o.to === s.from || o.from === s.to));
  const langOf: SpeechLang[] = segs.map((s) => {
    if (s.kind === "kana") return "ja";
    if (s.kind === "han") return chars.slice(s.from, s.to).some((ch) => ZH_ONLY.has(ch)) ? "zh" : touchesKana(s) ? "ja" : "zh";
    return "en";   // 拉丁字母：下面跟着前一段
  });
  for (let i = 0; i < segs.length; i++) if (segs[i]!.kind === "latin") langOf[i] = i > 0 ? langOf[i - 1]! : (segs.length > 1 ? langOf[1]! : ctx);
  // 每个字归到哪一段：段内的字归本段；段与段之间的标点——开引号 / 开括号起往后归后一段，前面的归前一段
  const owner = new Array<number>(chars.length);
  for (let s = 0; s < segs.length; s++) for (let i = segs[s]!.from; i < segs[s]!.to; i++) owner[i] = s;
  for (let s = 0; s <= segs.length; s++) {
    const from = s === 0 ? 0 : segs[s - 1]!.to, to = s === segs.length ? chars.length : segs[s]!.from;
    let cut = to;
    for (let i = from; i < to; i++) if (OPENERS.has(chars[i]!)) { cut = i; break; }
    for (let i = from; i < to; i++) owner[i] = s === 0 ? 0 : s === segs.length ? segs.length - 1 : i < cut ? s - 1 : s;
  }
  const runs: LangRun[] = [];
  for (let i = 0; i < chars.length; i++) {
    const lang = langOf[owner[i]!]!, last = runs[runs.length - 1];
    if (last && last.lang === lang) last.text += chars[i]; else runs.push({ lang, text: chars[i]! });
  }
  return runs;
}

/** 念这段正文要装哪几种语言（顺序 ja / zh / en）。 */
export function langsIn(text: string): SpeechLang[] {
  const ctx = contextLang(text), need = new Set<SpeechLang>();
  for (const s of splitSentences(text)) for (const r of langRuns(text.slice(s.start, s.end), ctx)) need.add(r.lang);
  if (/[A-Za-zＡ-Ｚａ-ｚ]{2,}/.test(text)) need.add("en");
  if (!need.size) need.add(ctx);
  return (["ja", "zh", "en"] as const).filter((l) => need.has(l));
}
