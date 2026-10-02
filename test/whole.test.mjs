// 整句合成（backend/piper-plus/whole.js）和本地模型的配置核对的规格测试。created 2026-10-02 by Claude Opus 5.5
// user 2026-10-02「合成，然后用不同的符号来fake不同的停顿。以后就只有切换语言的时候和句子级别要断句」「加一个整句合成的选项，默认开，可以开关」
// 「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」。
import { describe, it, eq as eqId, assert } from "./runner.mjs";
const eq = (a, b, m) => eqId(JSON.stringify(a), JSON.stringify(b), m);   // runner 的 eq 按引用比
import { joinPieces, padSilence } from "../backend/piper-plus/whole.js";
import { checkReplacedConfig } from "../src/worker/piper-plus.ts";
import { questionThenEos } from "../backend/piper-plus/index.js";

const R = (n) => Array.from({ length: n }, () => [0, 0, 0]);
const piece = (body, pauseMs) => { const ids = [1, 0, ...body.flatMap((x) => [x, 0]), 2]; return { ids, pros: R(ids.length), pauseMs }; };

describe("whole.js joinPieces：几个小句拼成一串，接缝多一个停顿记号", () => {
  it("两段：… x _ _ y …，标记指向多出来的那个 _，停顿取前一段的", () => {
    const j = joinPieces([piece([5, 6], 250), piece([7], 0)]);
    eq(j.ids, [1, 0, 5, 0, 6, 0, 0, 7, 0, 2]);
    eq(j.marks, [{ index: 6, pauseMs: 250 }]);
    eq(j.pros.length, j.ids.length);
  });
  it("三段：两个接缝各有自己的停顿长度", () => {
    const j = joinPieces([piece([5], 400), piece([6], 350), piece([7], 0)]);
    eq(j.ids, [1, 0, 5, 0, 0, 6, 0, 0, 7, 0, 2]);
    eq(j.marks.map((m) => [m.index, m.pauseMs]), [[4, 400], [7, 350]]);
  });
  it("布局不是 [BOS, 空白, …, 空白, EOS] → null（调用方逐段合成）", () => {
    eq(joinPieces([{ ids: [1, 5, 2], pros: R(3), pauseMs: 0 }, piece([6], 0)]), null);
    eq(joinPieces([]), null);
  });
});

describe("whole.js padSilence：在记号之后最安静的地方补静音，只补差额", () => {
  const sr = 1000;   // 1 个采样 = 1 ms，好算
  const tone = (n) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(i * 0.9));
  const join = (...xs) => { const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
  it("记号处有 100 ms 静音、要 250 ms → 在静音里补 150 ms，前后的声音一个采样不少", () => {
    const a = join(tone(300), new Float32Array(100), tone(300));
    const r = padSilence(a, sr, [{ start: 290, end: 320, pauseMs: 250 }], 1);
    eq(r.samples.length, a.length + r.padded[0].added);
    assert(r.padded[0].at >= 300 && r.padded[0].at <= 400, `插在静音里：${r.padded[0].at}`);
    assert(Math.abs(r.padded[0].added - 150) <= 15, `补了 ${r.padded[0].added} ms`);
    let energy = 0; for (const x of r.samples) energy += x * x; let e0 = 0; for (const x of a) e0 += x * x;
    assert(Math.abs(energy - e0) / e0 < 0.02, "只多了静音（切口两边 5 ms 的淡入淡出除外）");
  });
  it("真正的静音比记号晚（声音拖进了记号的帧）：仍然找到后面那段静音", () => {
    const a = join(tone(400), new Float32Array(200), tone(300));
    const r = padSilence(a, sr, [{ start: 320, end: 360, pauseMs: 250 }], 1);
    assert(r.padded[0].at >= 400 && r.padded[0].at <= 600, `插在 ${r.padded[0].at}`);
  });
  it("模型自己已经停够了 → 不补", () => {
    const a = join(tone(300), new Float32Array(400), tone(300));
    const r = padSilence(a, sr, [{ start: 300, end: 400, pauseMs: 250 }], 1);
    eq(r.padded[0].added, 0); assert(r.samples === a, "原样返回");
  });
  it("语速 2：停顿减半", () => {
    const a = join(tone(300), new Float32Array(40), tone(300));
    const r = padSilence(a, sr, [{ start: 290, end: 310, pauseMs: 400 }], 2);
    assert(Math.abs(r.padded[0].added - (200 - 40)) <= 15, `补了 ${r.padded[0].added} ms`);
  });
});

describe("本地模型：换进来的 config.json 要和音色的音素表一模一样", () => {
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  const base = { phoneme_id_map: { _: [0], a: [5] }, language_id_map: { ja: 0, zh: 2 }, inference: { noise_scale: 0.667 } };
  it("只有别的字段不同 → 可以", () => { checkReplacedConfig(enc(base), enc({ ...base, inference: { noise_scale: 0.3 } })); });
  it("音色末尾多出新增记号（编号排在换进来的整张表之后）→ 可以（piper-plus 底模对月读）", () => {
    checkReplacedConfig(enc({ ...base, phoneme_id_map: { _: [0], a: [5], "ɧ": [6], "ɵ": [7] } }), enc(base));
  });
  it("换进来的多出几个记号 → 可以", () => { checkReplacedConfig(enc(base), enc({ ...base, phoneme_id_map: { _: [0], a: [5], z: [9] } })); });
  it("缺了中间的记号（前端会发、会被悄悄丢掉）→ 拒绝", () => {
    let msg = ""; try { checkReplacedConfig(enc({ ...base, phoneme_id_map: { _: [0], b: [3], a: [5] } }), enc(base)); } catch (e) { msg = e.message; }
    assert(msg.startsWith("override-mismatch") && msg.includes("lacks"), msg);
  });
  it("语言表不同 → 拒绝", () => {
    let msg = ""; try { checkReplacedConfig(enc(base), enc({ ...base, language_id_map: { ja: 0, zh: 1 } })); } catch (e) { msg = e.message; }
    assert(msg.startsWith("override-mismatch") && msg.includes("language_id_map"), msg);
  });
  it("同一个记号编号不同 → 拒绝，错误以 override-mismatch 开头", () => {
    let msg = ""; try { checkReplacedConfig(enc(base), enc({ ...base, phoneme_id_map: { _: [0], a: [6] } })); } catch (e) { msg = e.message; }
    assert(msg.startsWith("override-mismatch") && msg.includes("other ids"), msg);
  });
  it("不是 JSON → 拒绝", () => {
    let msg = ""; try { checkReplacedConfig(enc(base), new TextEncoder().encode("not json")); } catch (e) { msg = e.message; }
    assert(msg.startsWith("override-mismatch"), msg);
  });
});

describe("中文问句结尾 = `? _ $`（和参考实现、日语、英语一样；user 2026-10-02「问号的语气还是没有学会…可能是前端的问题？」）", () => {
  const map = { _: [0], "^": [1], $: [2], "?": [3], "?!": [4], a: [57] };
  it("问号被当成结束记号（`… _ ?`）→ 后面补 `_ $`；韵律行跟着补", () => {
    const r = questionThenEos({ ids: [1, 0, 57, 0, 3], pros: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }, map);
    eq(r.ids, [1, 0, 57, 0, 3, 0, 2]); eq(r.pros.length, 7);
  });
  it("强调问句 ?! 也一样；本来就以 $ 结尾的不动", () => {
    eq(questionThenEos({ ids: [1, 0, 57, 0, 4], pros: [[], [], [], [], []] }, map).ids, [1, 0, 57, 0, 4, 0, 2]);
    eq(questionThenEos({ ids: [1, 0, 57, 0, 2], pros: [[], [], [], [], []] }, map).ids, [1, 0, 57, 0, 2]);
  });
});
