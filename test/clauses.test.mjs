// 句内断句（piper-plus 后端里我们自己加的那一层）的规格测试。created 2026-10-01 by Claude Fable 5.1
// 中文 / 英语的模型在标点处没有停顿记号，后端把一句切成小句分别合成、中间插静音。
import { describe, it, eq } from "./runner.mjs";
import { splitClauses, endsStrong, endsDash } from "../backend/piper-plus/text.js";

const cut = (t, n) => JSON.stringify(splitClauses(t, n));
describe("backend/piper-plus splitClauses", () => {
  it("句子中间的句末符号（连同后面的收尾引号）是强断点：引号里的话和后面的「某某说」分开念", () => {
    // 2026-10-01 user 真机：「“可是船上有奶牛呀！”苏一边跑一边说，这里没有好好断句」
    eq(cut("“可是船上有奶牛呀！”苏一边跑一边说，", 5), JSON.stringify(["“可是船上有奶牛呀！”", "苏一边跑一边说，"]));
    eq(cut("“快走！”他说。", 5), JSON.stringify(["“快走！”", "他说。"]));
    eq(cut("她问：“你去哪儿？”然后笑了，转身走开。", 5), JSON.stringify(["她问：“你去哪儿？”", "然后笑了，", "转身走开。"]));
    eq(cut("他想……算了，不说了。", 5), JSON.stringify(["他想……", "算了，不说了。"]));
    eq(cut('"Wait!" she cried, running after the boat.', 20), JSON.stringify(['"Wait!"', "she cried, running after the boat."]));
  });
  it("强断点两边有一边不到两个字就并回去；连着的句末符号只在最后一个后面断", () => {
    eq(cut("啊！啊！啊！快跑。", 5), JSON.stringify(["啊！啊！啊！", "快跑。"]));
    eq(cut("什么？！真的吗……好吧。", 5), JSON.stringify(["什么？！", "真的吗……", "好吧。"]));
  });
  it("逗号类是弱断点：太短的并到邻居；数字里的逗号 / 冒号、小数点不断", () => {
    eq(cut("今天天气很好，我们去公园散步吧。", 5), JSON.stringify(["今天天气很好，", "我们去公园散步吧。"]));
    eq(cut("价格是1,980元，下午3:45见。", 5), JSON.stringify(["价格是1,980元，", "下午3:45见。"]));
    eq(cut("The quick brown fox jumps over the lazy dog.", 20), JSON.stringify(["The quick brown fox jumps over the lazy dog."]));
    eq(cut("It was 3.14, not 3.15, as far as anyone could tell.", 20), JSON.stringify(["It was 3.14, not 3.15,", "as far as anyone could tell."]));
  });
  it("破折号是断点：成串的 —— 或两个以上的 ASCII 连字符；单个连字符不是", () => {
    // 2026-10-01 user 真机：「that the reasons of the confederacy were these--first, --没断句」
    eq(cut("that the reasons of the confederacy were these--first, because the colonies were weak; second, because they were poor.", 20),
      JSON.stringify(["that the reasons of the confederacy were these--", "first, because the colonies were weak;", "second, because they were poor."]));
    eq(cut("他停了一下——然后笑了，转身走开。", 5), JSON.stringify(["他停了一下——", "然后笑了，", "转身走开。"]));
    eq(cut("a well-known, long-term plan of the state-owned company", 20), JSON.stringify(["a well-known, long-term plan of the state-owned company"]));
    eq([endsDash("were these--"), endsDash("他停了一下——"), endsDash("well-known")].join(), "true,true,false");
  });
  it("太短的小句并到后面（它是在引出后面的话）；只有结尾的短尾巴才并到前面", () => {
    eq(cut("first, because the colonies were weak; second, because they were poor.", 20), JSON.stringify(["first, because the colonies were weak;", "second, because they were poor."]));
    eq(cut('"Wait!" she cried, running after the boat.', 20), JSON.stringify(['"Wait!"', "she cried, running after the boat."]));
    eq(cut("我们去公园散步吧，好。", 5), JSON.stringify(["我们去公园散步吧，好。"]));
  });
  it("行内公式 / 行内代码里面不断", () => {
    eq(cut("已知 $f(x, y) = x; y$ 成立，于是 `a ? b : c` 也成立。", 5), JSON.stringify(["已知 $f(x, y) = x; y$ 成立，", "于是 `a ? b : c` 也成立。"]));
  });
  it("endsStrong：这一段是不是停在句末符号上（后面的停顿更长）", () => {
    eq([endsStrong("“可是船上有奶牛呀！”"), endsStrong("苏一边跑一边说，"), endsStrong("他想……"), endsStrong('"Wait!"'), endsStrong("she cried,")].join(), "true,false,true,true,false");
  });
});
