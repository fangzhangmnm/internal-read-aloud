// 语言路由的规格测试。created 2026-10-01 by Claude Opus 5.5
import { describe, it, eq } from "./runner.mjs";
import { contextLang, langRuns, langsIn } from "../src/lang-route.ts";
import { ZH_ONLY_CHARS } from "../src/zh-only-chars.generated.ts";

const show = (s, ctx) => langRuns(s, ctx).map((r) => `${r.lang}:${r.text}`).join(" | ");
describe("lang-route", () => {
  it("只有中文才有的字表：常见简体字在，日文也用的字不在", () => {
    for (const ch of "这说读词师们么东车门问时间图谢个对语") eq(ZH_ONLY_CHARS.includes(ch), true, ch);
    for (const ch of "以如吐里国学会先生東京図猫意思") eq(ZH_ONLY_CHARS.includes(ch), false, ch);
  });
  it("主语言：假名占四分之一以上才算日语；中文里偶尔一个假名不算；英文为主算英语", () => {
    eq(contextLang("森の中で、小さな女の子が赤い花を見つけました。"), "ja");
    eq(contextLang("中文网文里偶尔一个の字不算日语，这一段还是中文。"), "zh");
    eq(contextLang("Hello world, this is mostly English with 一个 word."), "en");
    eq(contextLang("1234 —— !"), "en");
  });
  it("一句一种语言的情况", () => {
    eq(show("森の中で、小さな女の子が赤い花を見つけました。", "ja"), "ja:森の中で、小さな女の子が赤い花を見つけました。");
    eq(show("今天天气很好。", "zh"), "zh:今天天气很好。");
    eq(show("The quick brown fox.", "zh"), "en:The quick brown fox.");
    eq(show("族里的祭司（Tohunga）走过来，神情严肃。", "zh"), "zh:族里的祭司（Tohunga）走过来，神情严肃。");   // 英文词留给中文后端切
    eq(show("2026。", "zh"), "zh:2026。");
  });
  it("没有假名的纯汉字句：主语言是日语、又没有只有中文才有的字 → 日语；否则中文", () => {
    eq(show("東京都。", "ja"), "ja:東京都。");
    eq(show("東京都。", "zh"), "zh:東京都。");
    eq(show("这是东京。", "ja"), "zh:这是东京。");
  });
  it("学日语的书：中日混排的句子拆开，开引号跟着后一段，别的标点跟着前一段", () => {
    eq(show("这个词读作「せんせい」，意思是老师。", "zh"), "zh:这个词读作 | ja:「せんせい」， | zh:意思是老师。");
    eq(show("「ありがとう」是谢谢的意思。", "zh"), "ja:「ありがとう」 | zh:是谢谢的意思。");
    eq(show("他说：「ありがとう」。", "zh"), "zh:他说： | ja:「ありがとう」。");
    eq(show("日语里「猫」读作ねこ。", "zh"), "zh:日语里「猫」读作 | ja:ねこ。");
  });
  it("拼回去 = 原句", () => {
    for (const s of ["这个词读作「せんせい」，意思是老师。", "  「ありがとう」是谢谢的意思。", "日语里「猫」读作ねこ。ABC"]) eq(langRuns(s, "zh").map((r) => r.text).join(""), s);
  });
  it("一段正文要装哪几种语言：句子里的语言 + 有英文词就加英语", () => {
    eq(langsIn("森の中で。").join(), "ja");
    eq(langsIn("今天天气很好。").join(), "zh");
    eq(langsIn("族里的祭司（Tohunga）走过来。").join(), "zh,en");
    eq(langsIn("族里的祭司走过来。\n这个词读作「せんせい」。").join(), "ja,zh");
  });
});
