// 连读控制器的规格测试：假引擎（合成 = 记一笔，手动放行）+ 假喇叭（播完 = 手动放行）。created 2026-10-01 by Claude Fable 5.1
import { describe, it, eq, assert, tick } from "./runner.mjs";
import { createReadAloud } from "../src/read-aloud.ts";

function rig(opts = {}) {
  const log = [];
  const pendingSynth = [];   // { text, resolve, reject }
  const playbacks = [];      // { clip, finish(ok), paused }
  const engine = {
    synth(text, o) {
      log.push(`synth:${text}`);
      return new Promise((resolve, reject) => pendingSynth.push({ text, o, resolve: (n = 1) => resolve({ samples: new Float32Array(n), sampleRate: 1, text }), reject }));
    },
  };
  const sink = {
    play(clip) {
      let settle; const done = new Promise((r) => { settle = r; });
      const pb = { clip, paused: false, stopped: false, finished: false, finish: () => { pb.finished = true; settle(true); } };
      playbacks.push(pb); log.push(`play:${clip.text}`);
      return { done, stop() { pb.stopped = true; log.push(`stop:${clip.text}`); settle(false); }, pause() { pb.paused = true; }, resume() { pb.paused = false; } };
    },
  };
  const sleeps = [];
  const ra = createReadAloud({ engine, sink, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, ...opts });
  const events = [];
  ra.on("sentence", (span, i) => events.push(`sentence:${i}`));
  ra.on("state", (s) => events.push(`state:${s}`));
  ra.on("end", () => events.push("end"));
  ra.on("error", (e) => events.push(`error:${e.message}`));
  const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
  /** 放行所有排着的合成。 */
  const synthAll = async () => { while (pendingSynth.length) pendingSynth.shift().resolve(); await settle(); };
  const finishPlay = async () => { playbacks[playbacks.length - 1].finish(); await settle(); };
  return { ra, log, events, pendingSynth, playbacks, sleeps, settle, synthAll, finishPlay };
}
const TEXT = "甲。乙。\n丙。丁。";   // 四句；乙 → 丙 跨段

describe("createReadAloud", () => {
  it("连读：一句接一句，读完发 end；句间停顿同段 600 / 跨段 900", async () => {
    const r = rig();
    r.ra.start(TEXT, 0);
    eq(r.ra.state(), "loading");
    for (let i = 0; i < 4; i++) { await r.synthAll(); eq(r.ra.state(), "playing", `sentence ${i}`); await r.finishPlay(); }
    eq(r.ra.state(), "idle");
    eq(r.log.filter((x) => x.startsWith("play:")).join(","), "play:甲。,play:乙。,play:丙。,play:丁。");
    eq(JSON.stringify(r.sleeps), JSON.stringify([600, 900, 600]));
    eq(r.events[r.events.length - 1], "end");
    eq(r.events.filter((e) => e.startsWith("sentence:")).join(","), "sentence:0,sentence:1,sentence:2,sentence:3");
  });
  it("提前合成 lookahead 句：读第 1 句时第 2、3 句已经在算，不多算", async () => {
    const r = rig({ lookahead: 2 });
    r.ra.start(TEXT, 0);
    await r.settle();
    eq(r.log.filter((x) => x.startsWith("synth:")).join(","), "synth:甲。,synth:乙。,synth:丙。");
  });
  it("once：只读点到的那一句，不提前合成别的，读完回 idle 且不发 end", async () => {
    const r = rig();
    r.ra.start(TEXT, 3, { once: true });   // 偏移 3 落在「乙。」
    await r.synthAll();
    eq(r.log.join(","), "synth:乙。,play:乙。");
    await r.finishPlay();
    eq(r.ra.state(), "idle");
    assert(!r.events.includes("end"), "once must not emit end");
    eq(r.ra.current().index, 1);
  });
  it("stop：正在播的立刻停；还没回来的合成回来也不播", async () => {
    const r = rig();
    r.ra.start(TEXT, 0);
    await r.synthAll();
    r.ra.stop();
    eq(r.ra.state(), "idle");
    assert(r.playbacks[0].stopped, "playback stopped");
    await r.settle();
    eq(r.log.filter((x) => x.startsWith("play:")).length, 1, "nothing else played");
  });
  it("重新 start（点了别的句子）：旧的一轮作废，从新句子读", async () => {
    const r = rig();
    r.ra.start(TEXT, 0);
    r.ra.start(TEXT, 6, { once: true });   // 「丙。」；第一轮的合成还没回来
    await r.synthAll();
    eq(r.log.filter((x) => x.startsWith("play:")).join(","), "play:丙。");
  });
  it("同一段文本再 start：已经合成过的句子不重算；换了语速就重算", async () => {
    const r = rig();
    r.ra.start(TEXT, 0, { once: true }); await r.synthAll(); await r.finishPlay();
    r.events.length = 0;
    r.ra.start(TEXT, 0, { once: true }); await r.settle();
    eq(r.log.filter((x) => x === "synth:甲。").length, 1, "cached");
    assert(!r.events.includes("state:loading"), "already-synthesized sentence must not flash loading: " + r.events.join(","));
    await r.finishPlay();
    r.ra.start(TEXT, 0, { once: true, speed: 0.8 }); await r.settle();
    eq(r.log.filter((x) => x === "synth:甲。").length, 2, "speed change invalidates");
  });
  it("pause / resume 只动喇叭，状态跟着变", async () => {
    const r = rig();
    r.ra.start(TEXT, 0); await r.synthAll();
    r.ra.pause(); eq(r.ra.state(), "paused"); assert(r.playbacks[0].paused);
    r.ra.resume(); eq(r.ra.state(), "playing"); assert(!r.playbacks[0].paused);
  });
  it("skip：连读中跳到下一句接着连读；停着的时候跳 = 只读那一句", async () => {
    const r = rig();
    r.ra.start(TEXT, 0); await r.synthAll();
    r.ra.skip(1); await r.synthAll();
    eq(r.ra.current().index, 1); eq(r.ra.state(), "playing");
    await r.finishPlay(); await r.synthAll();
    eq(r.ra.current().index, 2, "still continuous after skip");
    r.ra.stop();
    r.ra.skip(-1); await r.synthAll();
    eq(r.ra.current().index, 1);
    await r.finishPlay();
    eq(r.ra.state(), "idle", "skip while stopped reads one sentence only");
    r.ra.skip(-1); r.ra.skip(-1); r.ra.skip(-1); await r.settle();
    eq(r.ra.current().index, 0, "clamped at first sentence");
  });
  it("新点的优先：已经合成好的句子连点（同步起播的路径），任何时刻只有一段在响", async () => {
    // 2026-10-01 真机：user 听到「unison」——被打断的那一轮收尾时把「现在谁在响」清空了，下一次打断就停不到正在响的那一段，两段叠在一起。
    const live = (r) => r.playbacks.filter((p) => !p.stopped && !p.finished).length;
    const r = rig();
    r.ra.start(TEXT, 0, { once: true }); await r.synthAll();
    eq(live(r), 1);
    for (let k = 0; k < 4; k++) { r.ra.start(TEXT, 0, { once: true }); await r.settle(); eq(live(r), 1, `after tap ${k + 2}`); }
    eq(r.playbacks.length, 5); eq(r.log.filter((x) => x.startsWith("synth:")).length, 1, "same sentence is synthesised once");
    // 连续模式：念着第 1 句（后两句已提前合成好）时来回跳
    const r2 = rig();
    r2.ra.start(TEXT, 0); await r2.synthAll();
    for (const off of [3, 0, 3, 6, 0]) { r2.ra.start(TEXT, off); await r2.settle(); await r2.synthAll(); eq(live(r2), 1, `jump to ${off}`); }
    r2.ra.stop(); await r2.settle();
    eq(live(r2), 0, "stop silences everything");
  });
  it("念法（steadiness 0…1）传给引擎；换了念法，已合成的句子重算；steady: true = 1；越界夹住", async () => {
    const r = rig();
    r.ra.start(TEXT, 0, { once: true, steadiness: 0.5 }); eq(r.pendingSynth[0].o.steadiness, 0.5); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, steadiness: 0.5 }); eq(r.pendingSynth.length, 0, "same steadiness: cached clip reused");
    r.ra.start(TEXT, 0, { once: true, steadiness: 0.3 }); eq(r.pendingSynth.length, 1, "re-synthesised"); eq(r.pendingSynth[0].o.steadiness, 0.3); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, steady: true }); eq(r.pendingSynth[0].o.steadiness, 1); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, steadiness: 1 }); eq(r.pendingSynth.length, 0, "steady: true and steadiness 1 are the same setting");
    r.ra.start(TEXT, 0, { once: true, steadiness: 7 }); eq(r.pendingSynth.length, 0, "clamped to 1");
    r.ra.start(TEXT, 0, { once: true }); eq(r.pendingSynth[0].o.steadiness, 0);
  });
  it("预设（家族约定：用户敲的带符号整数）原样传给引擎；同一个预设复用合成好的句子，换了就重算；小数取整；不给 = undefined（模型自己的默认）", async () => {
    const r = rig();
    r.ra.start(TEXT, 0, { once: true, preset: 0xB }); eq(r.pendingSynth[0].o.preset, 11); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, preset: 11 }); eq(r.pendingSynth.length, 0, "same preset: cached clip reused");
    r.ra.start(TEXT, 0, { once: true, preset: -3 }); eq(r.pendingSynth.length, 1, "re-synthesised"); eq(r.pendingSynth[0].o.preset, -3); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, preset: -3.7 }); eq(r.pendingSynth.length, 0, "-3.7 truncates to -3");
    r.ra.start(TEXT, 0, { once: true }); eq(r.pendingSynth[0].o.preset, undefined); await r.synthAll();
    r.ra.start(TEXT, 0, { once: true, preset: Number.NaN }); eq(r.pendingSynth.length, 0, "NaN = not given");
    r.ra.start(TEXT, 0, { once: true, preset: 0 }); eq(r.pendingSynth.length, 1, "0 is a preset, not 'not given'"); eq(r.pendingSynth[0].o.preset, 0);
  });
  it("句间停顿跟着语速等比例缩：1.5 倍速 → 400 / 600 / 400", async () => {
    const r = rig();
    r.ra.start(TEXT, 0, { speed: 1.5 });
    for (let i = 0; i < 4; i++) { await r.synthAll(); await r.finishPlay(); }
    eq(JSON.stringify(r.sleeps), JSON.stringify([400, 600, 400]));
    const r2 = rig();
    r2.ra.start(TEXT, 0, { speed: 0.8 });
    for (let i = 0; i < 4; i++) { await r2.synthAll(); await r2.finishPlay(); }
    eq(JSON.stringify(r2.sleeps), JSON.stringify([750, 1125, 750]));
  });
  it("不给 lang：每句自己判语言；中日混排的句子分段合成再接起来；判出来的语言没装 = 报错，不凑合", async () => {
    const langs = [];
    // 中日混排的一句：三段按顺序送进引擎，各带各的语言
    const rr = rig({});
    rr.ra.start("这个词读作「せんせい」，意思是老师。", 0, { once: true });
    for (let k = 0; k < 3; k++) { await rr.settle(); const p = rr.pendingSynth.shift(); langs.push(`${p.o.lang}:${p.text}`); p.resolve(2); }
    await rr.settle();
    eq(langs.join(" | "), "zh:这个词读作 | ja:「せんせい」， | zh:意思是老师。");
    eq(rr.playbacks.length, 1, "one clip for the whole sentence");
    eq(rr.playbacks[0].clip.samples.length, 6, "the three runs (2 samples each) are joined into one clip (the fake sample rate 1 makes the gaps 0 samples)");
    // 只装了中文：日语那段不拿中文凑合念，这一句报错（user「主语言替代朗读…不要这样，这是静默退化」）
    const r3 = rig();
    r3.ra.start("这个词读作「せんせい」，意思是老师。", 0, { once: true, langs: ["zh"] });
    await r3.settle();
    eq(r3.pendingSynth.length, 0, "nothing synthesised"); eq(r3.playbacks.length, 0);
    eq(r3.events.some((e) => e.startsWith("error:language not loaded: ja")), true, r3.events.join(","));
    // 给了 lang：整句一种语言（老行为）
    const r4 = rig();
    r4.ra.start("这个词读作「せんせい」，意思是老师。", 0, { once: true, lang: "ja" });
    eq(r4.pendingSynth.length, 1); eq(r4.pendingSynth[0].o.lang, "ja");
  });
  it("合成出错：发 error、回 idle、不再往下读", async () => {
    const r = rig();
    r.ra.start(TEXT, 0);
    r.pendingSynth.shift().reject(new Error("boom")); await r.settle();
    eq(r.ra.state(), "idle");
    assert(r.events.includes("error:boom"), r.events.join(","));
    eq(r.log.filter((x) => x.startsWith("play:")).length, 0);
  });
  it("合成回来是空的一段（这句没有可念的）：连读悄悄跳过、不报位置、不留停顿；点名只读它 → 回 idle", async () => {
    const r = rig();
    r.ra.start("甲。乙。丙。", 0);
    r.pendingSynth.shift().resolve(); await r.settle(); await r.finishPlay();   // 甲 播完
    r.pendingSynth.shift().resolve(0); await r.settle();                          // 乙 是空的
    await r.synthAll(); await r.finishPlay();
    eq(r.log.filter((x) => x.startsWith("play:")).join(","), "play:甲。,play:丙。");
    eq(r.events.filter((e) => e.startsWith("sentence:")).join(","), "sentence:0,sentence:2");
    eq(r.events[r.events.length - 1], "end");
    const r2 = rig();
    r2.ra.start("甲。", 0, { once: true });
    r2.pendingSynth.shift().resolve(0); await r2.settle();
    eq(r2.ra.state(), "idle"); eq(r2.playbacks.length, 0);
  });
  it("没有能读的句子：连读直接发 end；语言没给就按文本猜", async () => {
    const r = rig();
    r.ra.start(" \n——\n", 0); await r.settle();
    eq(r.events.join(","), "end");
    const r2 = rig();
    r2.ra.start("森の中で。", 0, { once: true }); await r2.settle();
    eq(r2.pendingSynth[0].o.lang, "ja");
  });
});
