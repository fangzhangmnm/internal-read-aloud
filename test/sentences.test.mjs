// 分句的规格测试。created 2026-10-01 by Claude Fable 5.1
import { describe, it, eq, assert } from "./runner.mjs";
import { splitSentences, sentenceAt, detectLang, MAX_SPAN } from "../src/sentences.ts";

const cut = (t) => splitSentences(t).map((s) => t.slice(s.start, s.end));
const same = (a, b, msg) => eq(JSON.stringify(a), JSON.stringify(b), msg);

describe("splitSentences", () => {
  it("日文：句号断句，引号里的句号不断、后面接着的话算同一句", () => {
    same(cut("ハンスのおかあさんが、「ハンスや、どこへいく。」とききました。むかしむかし、あるところに。"),
      ["ハンスのおかあさんが、「ハンスや、どこへいく。」とききました。", "むかしむかし、あるところに。"]);
  });
  it("引号合上后没有接着的话 → 在引号后面断", () => {
    same(cut("「お前はだれだ。」\nと、きつねがたずねました。"), ["「お前はだれだ。」", "と、きつねがたずねました。"]);
    same(cut("“你到底去不去？” “不去。”他说。"), ["“你到底去不去？”", "“不去。”他说。"]);
  });
  it("引号里多句对白是一句（整段对白一起念）", () => {
    same(cut("彼は言った。「行く。すぐ行く。」そして出ていった。"), ["彼は言った。", "「行く。すぐ行く。」そして出ていった。"]);
  });
  it("中文：。！？ 与连着的句末符号、收尾引号归前一句", () => {
    same(cut("今天天气很好！！我们去公园吧……好不好？”他问。"), ["今天天气很好！！", "我们去公园吧……", "好不好？”", "他问。"]);
  });
  it("换行一定断；空行、只有标点的行丢掉", () => {
    same(cut("第一段没有句号\n\n——\n第二段。\n   \n第三段"), ["第一段没有句号", "第二段。", "第三段"]);
  });
  it("英文句点：后面是空白才断；小数点不断", () => {
    same(cut("Pi is 3.14 today. Next one? Yes."), ["Pi is 3.14 today.", "Next one?", "Yes."]);
  });
  it("偏移对得上原文，句与句不重叠、按顺序；首尾空白不算进句子", () => {
    const t = "  甲。 乙！\n丙";
    const spans = splitSentences(t);
    same(spans.map((s) => t.slice(s.start, s.end)), ["甲。", "乙！", "丙"]);
    for (let i = 1; i < spans.length; i++) assert(spans[i].start >= spans[i - 1].end, "overlap");
    eq(spans[0].start, 2);
  });
  it("超长无句末：在逗号处断，每句不超过上限；没有逗号就硬断", () => {
    const long = ("很长的一句话没有句号，" ).repeat(40);
    const parts = cut(long);
    assert(parts.length > 1, "should split");
    for (const p of parts) assert(p.length <= MAX_SPAN, `too long: ${p.length}`);
    eq(parts.join(""), long, "nothing lost at soft breaks");
    const hard = "字".repeat(MAX_SPAN * 2 + 10);
    for (const p of cut(hard)) assert(p.length <= MAX_SPAN, "hard split bound");
  });
  it("引号没合上（脏文本）也不会把整章吞成一句：换行与长度兜底", () => {
    const t = "「没合上的引号。后面一句。\n下一段。";
    same(cut(t), ["「没合上的引号。后面一句。", "下一段。"]);
  });
  it("空串 / 纯空白 → 没有句子", () => { same(cut(""), []); same(cut(" \n　\n"), []); });
});

describe("splitSentences：公式 / 代码的护栏", () => {
  it("围栏代码块整块不算句子（不念、不切碎），前后的正文照常", () => {
    same(cut("先看代码。\n```js\nfor (let i = 0; i < n; i++) { a[i] = b[i] ? 1 : 0; }\nconsole.log(\"done!\");\n```\n看完了。"), ["先看代码。", "看完了。"]);
  });
  it("公式块：$$…$$（跨行）、\\[…\\]、\\begin…\\end 整块不算句子", () => {
    same(cut("由此可得\n$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n证毕。"), ["由此可得", "证毕。"]);
    same(cut("设\n\\[ a^2 + b^2 = c^2 \\]\n成立。"), ["设", "成立。"]);
    same(cut("如下：\n\\begin{align}\nx &= 1 \\\\\ny &= 2\n\\end{align}\n完。"), ["如下：", "完。"]);
    same(cut("一行写完的 $$E = mc^2$$ 也整行跳过\n下一行。"), ["下一行。"]);
  });
  it("符号密度很高的行（没有围栏的代码 / 公式）不算句子；带几个符号的正文照常念", () => {
    same(cut("for (let i = 0; i < n; i++) { a[i] = b[i] + c; }\n这是正文。"), ["这是正文。"]);
    same(cut("x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n解出来了。"), ["解出来了。"]);
    same(cut("质能方程 E = mc^2 很有名。"), ["质能方程 E = mc^2 很有名。"]);
    same(cut("【系统】HP+5，MP+3；获得[铁剑]*2。"), ["【系统】HP+5，MP+3；获得[铁剑]*2。"]);
    same(cut("He paid 50% up front; the rest (about $300) came later."), ["He paid 50% up front; the rest (about $300) came later."]);
  });
  it("行内公式 / 行内代码：里面的标点不断句，句子照常在它后面的句末断", () => {
    same(cut("已知 $f(x) = x^2 + 1$。那么 $f(2) = 5$！对吗？"), ["已知 $f(x) = x^2 + 1$。", "那么 $f(2) = 5$！", "对吗？"]);
    same(cut("调用 `a ? b : c` 即可。然后 `x!.y` 也行。"), ["调用 `a ? b : c` 即可。", "然后 `x!.y` 也行。"]);
    same(cut("Use `foo.bar()` now. Then \\(a! b?\\) holds. Done."), ["Use `foo.bar()` now.", "Then \\(a! b?\\) holds.", "Done."]);
    same(cut("It costs $5. Then $10 more."), ["It costs $5.", "Then $10 more."]);
  });
  it("超长兜底不会切在行内公式中间", () => {
    const f = "$" + "a+b,".repeat(60) + "c$";   // 242 个字符的行内公式，里面全是逗号
    const parts = cut("前面的话，" + f + "后面的话。");
    assert(parts.some((p) => p.includes(f)), "inline formula must stay in one piece: " + JSON.stringify(parts.map((p) => p.length)));
  });
});

describe("sentenceAt", () => {
  it("句内 → 那一句；两句之间 → 后一句；过了末尾 → 最后一句；空 → -1", () => {
    const t = "甲乙。 丙丁。\n戊。";
    const spans = splitSentences(t);
    eq(sentenceAt(spans, 0), 0); eq(sentenceAt(spans, 2), 0);
    eq(sentenceAt(spans, 3), 1, "gap → next");
    eq(sentenceAt(spans, 5), 1);
    eq(sentenceAt(spans, 999), spans.length - 1);
    eq(sentenceAt([], 3), -1);
  });
});

describe("detectLang", () => {
  it("有假名 = ja；有汉字没假名 = zh；都没有 = en", () => {
    eq(detectLang("森の中で、小さな女の子が"), "ja");
    eq(detectLang("ハンス"), "ja");
    eq(detectLang("今天天气很好"), "zh");
    eq(detectLang("Hello, world."), "en");
    eq(detectLang(""), "en");
  });
});
