// 句内断句（piper-plus 后端里我们自己加的那一层）的规格测试。created 2026-10-01 by Claude Fable 5.1
// 中文 / 英语的模型在标点处没有停顿记号，后端把一句切成小句分别合成、中间插静音。
// 规则是一张表（backend/piper-plus/text.js 头注释）：两段能念的字之间的那一串标点算一簇，按簇里有哪几类符号定停顿。
// user 2026-10-01 真机三条：「“可是船上有奶牛呀！”苏一边跑一边说，这里没有好好断句」「these--first, --没断句」「逗号上引号的断句呢，有没有系统的解决枚举办法」
import { describe, it, eq } from "./runner.mjs";
import { splitClauses, splitClausesDetailed, PAUSE_MS, stripMarkup } from "../backend/piper-plus/text.js";
import { blendScales } from "../backend/piper-plus/index.js";

/** 画成一行好对：`小句⟨停顿类型⟩ | 小句⟨…⟩` */
const show = (t, n) => splitClausesDetailed(t, n).map((p) => `${p.text}⟨${p.kind}⟩`).join(" | ");

describe("backend/piper-plus 句内断句（标点簇查表）", () => {
  it("簇里有句末符号 = 强断点（400 ms）：引号里的话和后面的「某某说」分开念；断点落在开引号之前", () => {
    eq(show("“可是船上有奶牛呀！”苏一边跑一边说，", 5), "“可是船上有奶牛呀！”⟨strong⟩ | 苏一边跑一边说，⟨end⟩");
    eq(show("“走吧！”“好的。”他说。", 5), "“走吧！”⟨strong⟩ | “好的。”⟨strong⟩ | 他说。⟨end⟩");
    eq(show("他想……算了，不说了。", 5), "他想……⟨strong⟩ | 算了，不说了。⟨end⟩");
    eq(show('"Wait!" she cried, running after the boat.', 20), '"Wait!"⟨strong⟩ | she cried, running after the boat.⟨end⟩');
  });
  it("簇里有破折号 = 350 ms：成串的 —— 或两个以上的 ASCII 连字符；单个连字符是字的一部分", () => {
    eq(show("that the reasons of the confederacy were these--first, because the colonies were weak; second, because they were poor.", 20),
      "that the reasons of the confederacy were these--⟨dash⟩ | first, because the colonies were weak;⟨weak⟩ | second, because they were poor.⟨end⟩");
    eq(show("他停了一下——然后笑了，转身走开。", 5), "他停了一下——⟨dash⟩ | 然后笑了，⟨weak⟩ | 转身走开。⟨end⟩");
    eq(show("a well-known, long-term plan of the state-owned company", 20), "a well-known, long-term plan of the state-owned company⟨end⟩");
  });
  it("逗号类 + 开引号 = 引出一段话（350 ms），开引号归后面那一段", () => {
    eq(show("苏一边跑一边说，“它们会晕船的。”", 5), "苏一边跑一边说，⟨intro⟩ | “它们会晕船的。”⟨end⟩");
    eq(show("她问：“你去哪儿？”然后笑了，转身走开。", 5), "她问：⟨intro⟩ | “你去哪儿？”⟨strong⟩ | 然后笑了，⟨weak⟩ | 转身走开。⟨end⟩");
    eq(show("他（小王）说：“走吧。”", 5), "他（小王）说：⟨intro⟩ | “走吧。”⟨end⟩");
    eq(show('She said, "Wait for me." Then she ran.', 20), 'She said,⟨intro⟩ | "Wait for me." Then she ran.⟨end⟩');
  });
  it("只有逗号类 = 弱断点（250 ms）；逗号后面跟着收引号也是", () => {
    eq(show("今天天气很好，我们去公园散步吧。", 5), "今天天气很好，⟨weak⟩ | 我们去公园散步吧。⟨end⟩");
    eq(show("“我们先回去吧，”他小声说。", 5), "“我们先回去吧，”⟨weak⟩ | 他小声说。⟨end⟩");
  });
  it("只有引号 / 括号的簇不停；句首句尾的簇不算断点", () => {
    eq(show("所谓“自由”的意思其实很简单", 5), "所谓“自由”的意思其实很简单⟨end⟩");
    eq(show("“好的。”", 5), "“好的。”⟨end⟩");
  });
  it("是字不是标点：数字里的逗号 / 冒号、小数点、撇号、单个连字符", () => {
    eq(show("价格是1,980元，下午3:45见。", 5), "价格是1,980元，⟨weak⟩ | 下午3:45见。⟨end⟩");
    eq(show("It was the boys' idea, and I don't mind; it's fine.", 20), "It was the boys' idea,⟨weak⟩ | and I don't mind; it's fine.⟨end⟩");
    eq(show("It was 3.14, not 3.15, as far as anyone could tell.", 20), "It was 3.14, not 3.15,⟨weak⟩ | as far as anyone could tell.⟨end⟩");
  });
  it("并小句：弱断点的短句并到后面（它在引出后面的话），结尾的短尾巴并到前面；别的断点只在一边不到两个字时才并", () => {
    eq(show("first, because the colonies were weak; second, because they were poor.", 20), "first, because the colonies were weak;⟨weak⟩ | second, because they were poor.⟨end⟩");
    eq(show("我们去公园散步吧，好。", 5), "我们去公园散步吧，好。⟨end⟩");
    eq(show("啊！啊！啊！快跑。", 5), "啊！啊！啊！⟨strong⟩ | 快跑。⟨end⟩");
    eq(show("他说，“好。”", 5), "他说，“好。”⟨end⟩");
  });
  it("行内公式 / 行内代码里面不断", () => {
    eq(show("已知 $f(x, y) = x; y$ 成立，于是 `a ? b : c` 也成立。", 5), "已知 $f(x, y) = x; y$ 成立，⟨weak⟩ | 于是 `a ? b : c` 也成立。⟨end⟩");
  });
  it("停顿长度：强 400 / 破折号 350 / 引出 350 / 弱 250，最后一段后面是 0；splitClauses 只给文字", () => {
    eq(JSON.stringify(PAUSE_MS), JSON.stringify({ strong: 400, dash: 350, intro: 350, weak: 250 }));
    eq(splitClausesDetailed("她问：“你去哪儿？”然后笑了，转身走开。", 5).map((p) => p.pauseMs).join(), "350,400,250,0");
    eq(JSON.stringify(splitClauses("今天天气很好，我们去公园散步吧。", 5)), JSON.stringify(["今天天气很好，", "我们去公园散步吧。"]));
  });
  it("user 2026-10-01 的长例子：引出语、三连感叹、引号后接着说，各就各位；开头的机器记号不念", () => {
    const line = "<s><|e1v3|>一个信使满头大汗，一边跑一边大喊：“好消息！坏消息！快来看啊！”他在人群中转圈乱跑，大声喊着：“拿撒勒人耶稣被抓了！拿撒勒人耶稣被抓了！”";
    eq(stripMarkup(line).startsWith("一个信使"), true);
    eq(show(stripMarkup(line), 5), "一个信使满头大汗，⟨weak⟩ | 一边跑一边大喊：⟨intro⟩ | “好消息！⟨strong⟩ | 坏消息！⟨strong⟩ | 快来看啊！”⟨strong⟩ | 他在人群中转圈乱跑，⟨weak⟩ | 大声喊着：⟨intro⟩ | “拿撒勒人耶稣被抓了！⟨strong⟩ | 拿撒勒人耶稣被抓了！”⟨end⟩");
    eq(stripMarkup("a</s> <br>b <|endoftext|> 3 < 5 > 2"), "a b  3 < 5 > 2");
  });
  it("念法插值：0 = 原样 0.667 / 1.5 / 0.5，1 = 平稳 0.333 / 1.7 / 0，0.5 在正中，越界夹住", () => {
    const r = (o) => [o.noiseScale, o.lengthScale, o.noiseW].map((x) => +x.toFixed(4)).join("/");
    eq(r(blendScales(0)), "0.667/1.5/0.5"); eq(r(blendScales(1)), "0.333/1.7/0"); eq(r(blendScales(0.5)), "0.5/1.6/0.25");
    eq(r(blendScales(-3)), r(blendScales(0))); eq(r(blendScales(9)), r(blendScales(1)));
  });
});
