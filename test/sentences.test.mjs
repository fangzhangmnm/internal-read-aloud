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
