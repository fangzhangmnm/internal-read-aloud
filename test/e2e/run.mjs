// @internal/read-aloud 整链测试：真引擎（sherpa-onnx wasm + piper-plus 后端）+ 真语音包（检疫桶里的测试包 / 本机打的つくよみちゃん五个小包）+ 真 Cache Storage + 真 Web Audio，
// 在无头 Chromium 里把「下载 → 逐片校验 → 缓存 → 装进引擎 → 合成 → 连读」整条走一遍。用法：npm run e2e（先 build）。
// 不进 npm test：要下 160 MB 本地文件、合成几句，约一分钟。这台机子的显卡在跑别的：浏览器 --disable-gpu。
// created 2026-10-01 by Claude Fable 5.1
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "../..");
const FAMILY = join(LIB, "..");
const ENGINE_WASM = join(FAMILY, "20260516 WebXiaoHeiWu/vendor/sherpa-onnx-wasm");                       // 引擎二进制 + 胶水（家族已 vendor）
const ENGINE_TTS_JS = join(process.env.HOME, "jupyter/third-party/sherpa-onnx-wasm/sherpa-onnx/wasm/tts");   // 上游 TTS 的 JS 包装
const PACKS = process.env.READ_ALOUD_TEST_PACKS ?? join(process.env.HOME, "jupyter/third-party/sherpa-onnx-wasm/tts-probe/packs-test");
const ESBUILD = [join(FAMILY, "20260523 JustReadBooks/tools/esbuild/esbuild"), join(FAMILY, "20260516 WebXiaoHeiWu/tools/esbuild/esbuild")].find(existsSync);
const { chromium } = createRequire(join(FAMILY, "20260524 WeebPaint/package.json"))("playwright");
const ZH = "TEST-piper-zh-xiao-ya-int8", JA = "TEST-supertonic-3-int8";
// つくよみちゃん（piper-plus 引擎）的五个小包 + 音色定义：检疫桶里本机打的，还没发布（~/jupyter/third-party/piper-plus/backend/build-packs.mjs）。
const TSU = process.env.READ_ALOUD_TSU_PACKS ?? join(process.env.HOME, "jupyter/third-party/piper-plus/packs-local");
const SAMPLES = process.env.READ_ALOUD_E2E_SAMPLES ?? "";
// 本地模型测试用的权重（检疫桶）：原版月读 + 「换回中文语言向量」的实验权重（~/jupyter/third-party/piper-plus/langemb-exp/NOTES.md）
const LOCAL = process.env.READ_ALOUD_LOCAL_MODELS ?? join(process.env.HOME, "jupyter/third-party/piper-plus");   // 给了目录 = 把つくよみちゃん合成的几句存成 wav（给人听 / 给识别回环用）
for (const [what, p] of [["engine wasm", ENGINE_WASM], ["engine tts js", ENGINE_TTS_JS], ["test packs", join(PACKS, ZH)], ["tsukuyomi packs", join(TSU, "voices/tsukuyomi-chan.json")], ["esbuild", ESBUILD ?? ""]]) if (!p || !existsSync(p)) { console.error(`[e2e] missing ${what}: ${p}`); process.exit(2); }

await mkdir(join(HERE, ".out"), { recursive: true });
execFileSync(ESBUILD, [join(LIB, "dist/worker/sherpa-entry.js"), "--bundle", "--format=iife", "--target=es2020", `--outfile=${join(HERE, ".out/worker.js")}`, "--log-level=warning"]);
execFileSync(ESBUILD, [join(LIB, "dist/worker/piper-plus-entry.js"), "--bundle", "--format=esm", "--target=es2022", `--outfile=${join(HERE, ".out/worker-piper-plus.js")}`, "--log-level=warning"]);
execFileSync(ESBUILD, [join(HERE, "page.js"), "--bundle", "--format=esm", "--target=es2020", `--outfile=${join(HERE, ".out/page.js")}`, "--log-level=warning"]);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
let chunkFetches = 0;
const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    let file, corrupt = false;
    if (p.startsWith("/engine/")) { const n = p.slice(8); file = n === "sherpa-onnx-tts.js" ? join(ENGINE_TTS_JS, n) : join(ENGINE_WASM, n); }
    else if (p.startsWith("/models/")) file = join(PACKS, p.slice("/models/packs/".length));
    else if (p.startsWith("/tsu/")) file = join(TSU, p.slice("/tsu/".length));
    else if (p.startsWith("/local/")) file = join(LOCAL, p.slice("/local/".length));
    else if (p.startsWith("/tsu-tampered/")) { file = join(TSU, p.slice("/tsu-tampered/".length)); corrupt = /chunk-\d+$/.test(p); }
    else if (p.startsWith("/tampered/")) { file = join(PACKS, p.slice("/tampered/packs/".length)); corrupt = /chunk-\d+$/.test(p); }
    else file = join(HERE, p === "/" ? "page.html" : p);
    if (/chunk-\d+$/.test(p)) chunkFetches++;
    const b = await readFile(file);
    if (corrupt) b[b.length >> 1] ^= 0xff;   // 「被黑的镜像站」：中间翻一个字节
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : "  " + detail}`); };
const browser = await chromium.launch({ args: ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(0);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(ORIGIN + "/"); await page.waitForFunction("window.e2eReady === true", null, { timeout: 30000 });

  let requests = 0;   // 浏览器发的每一个请求（页面 + worker）
  page.context().on("request", (r) => { if (!new URL(r.url()).pathname.startsWith("/local/")) requests++; });   // /local/ = 测试页自己取「用户手里的本地模型文件」，不算引擎的请求

  const ZV = "zh-test", JV = "ja-test", TV = "tsukuyomi-chan", OV = "other-voice";
  const made = await page.evaluate(async ([ZH, JA]) => {
    const tsu = await (await fetch("/tsu/voices/tsukuyomi-chan.json")).json();
    return window.e2e.make([
      { def: { v: 1, id: "zh-test", name: "zh", engine: "sherpa-onnx", packs: [ZH], langPacks: { zh: [] } }, base: "/models" },
      { def: { v: 1, id: "ja-test", name: "ja", engine: "sherpa-onnx", packs: [JA], langPacks: { ja: [], en: [] } }, base: "/models" },
      { def: tsu, base: "/tsu" },
      // 假想的另一个音色：自己的权重（拿 sherpa 的中文测试包顶替，只测包的账，不装进引擎），和つくよみちゃん共用运行时与英语词典
      { def: { v: 1, id: "other-voice", name: "other", engine: "piper-plus", packs: [ZH, tsu.packs[1]], langPacks: { en: tsu.langPacks.en } }, base: "/tsu" },
    ], "read-aloud-e2e");
  }, [ZH, JA]);
  const packs = made.packs, tsuDef = made.voices[TV];
  check("内嵌：四个音色、七个包", Object.keys(made.voices).length === 4 && Object.keys(packs).length === 7, JSON.stringify(Object.keys(packs)));
  check("音色定义里写的 packId 和清单字节的哈希逐个相同", Object.entries(tsuDef.packIds).every(([slug, id]) => packs[slug]?.packId === id) && Object.keys(tsuDef.packIds).length === 5);
  const bytesOf = (slugs) => slugs.reduce((a, s) => a + packs[s].bytes, 0);

  // ══ 一、sherpa 引擎（一个音色 = 一个包）：包的全流程 ══
  check("起步：没有包", await page.evaluate(async (v) => { const st = await window.e2e.engine.status(v); return st.ready === false && st.langs.length === 0; }, ZV));
  const bad = await page.evaluate((v) => window.e2e.engine.download(v, "/tampered").then(() => "accepted", (e) => e.message), ZV);
  check("被篡改的源：sha256 对不上 → 拒收", /sha256 mismatch/.test(bad), bad);
  check("拒收之后仍然没有包（坏分片没进缓存）", await page.evaluate(async (v) => { const st = await window.e2e.engine.status(v); return st.ready === false && st.bytesCached === 0; }, ZV));
  const dl = await page.evaluate(async (v) => { const seen = []; const st = await window.e2e.engine.download(v, "/models", { onProgress: (p) => seen.push(p.done) }); return { st, last: seen[seen.length - 1], n: seen.length }; }, ZV);
  check("下载 + 逐片校验 → 就绪，进度报到满", dl.st.ready && dl.st.langs.join() === "zh" && dl.st.bytesCached === packs[ZH].bytes && dl.last === packs[ZH].bytes, JSON.stringify(dl));
  let before = chunkFetches;
  await page.evaluate((v) => window.e2e.engine.download(v, "/models"), ZV);
  check("再下载一次：已有的分片不重取", chunkFetches === before, `${chunkFetches - before} refetched`);
  check("同步问「能不能念」", await page.evaluate((v) => window.e2e.engine.isKnownReady(v) === true && window.e2e.engine.isKnownReady(v, "zh") === true && window.e2e.engine.isKnownReady(v, "ja") === false, ZV));

  const ld = await page.evaluate((v) => window.e2e.engine.load(v), ZV);
  check("装进引擎", ld.alreadyLoaded === false && ld.sampleRate > 8000 && ld.speakers >= 1 && ld.langs.join() === "zh", JSON.stringify(ld));
  const z = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh"));
  check("合成一句中文：有声音、时长合理", z.sec > 1 && z.sec < 8 && z.rms > 0.01, JSON.stringify(z));
  console.log(`  （sherpa 中文一句 ${z.sec.toFixed(1)} s 音频，算了 ${z.ms} ms，建器 ${ld.createMs} ms）`);

  const TEXT = "你好。\n再见。";
  await page.evaluate((t) => { window.e2e.sink.unlock(); window.e2e.events.length = 0; window.e2e.ra.start(t, 0); }, TEXT);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.events.includes("end") || window.e2e.events.some((x) => x.startsWith("error"))));
  const ev = await page.evaluate(() => window.e2e.events.slice());
  check("连读两句：逐句报位置，读完发 end，回到 idle", ev.filter((x) => x.startsWith("sentence:")).join(",") === "sentence:0,sentence:1" && ev[ev.length - 1] === "end" && !ev.some((x) => x.startsWith("error")), ev.join(","));
  await page.evaluate((t) => { window.e2e.events.length = 0; window.e2e.ra.start(t, 4, { once: true }); }, TEXT);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.ra.state() === "idle" && window.e2e.events.includes("sentence:1")));
  check("点一句只读一句（已合成过的不重算）", await page.evaluate(() => !window.e2e.events.includes("end") && !window.e2e.events.includes("state:loading")), (await page.evaluate(() => window.e2e.events.join(","))));

  // ── 新点的优先：同一句（已合成好）连点四次、间隔比一句短 → 任何时刻只有一段在响 ──
  const overlap = await page.evaluate(async (t) => {
    const L = window.e2e.live; L.max = 0;
    for (let k = 0; k < 4; k++) { window.e2e.ra.start(t, 0, { once: true }); await new Promise((r) => setTimeout(r, 150)); }
    await window.e2e.wait(() => window.e2e.ra.state() === "idle");
    await new Promise((r) => setTimeout(r, 200));
    return { max: L.max, now: L.now };
  }, TEXT);
  check("同一句连点四次：同时在响的声源最多一个，停下后归零", overlap.max === 1 && overlap.now === 0, JSON.stringify(overlap));
  const overlapSink = await page.evaluate(async () => {
    // 绕过控制器直接连着叫喇叭播三段：喇叭自己也得保证只有一段在响
    const L = window.e2e.live; L.max = 0;
    const clip = () => ({ samples: new Float32Array(22050).fill(0.01), sampleRate: 22050 });
    const a = window.e2e.sink.play(clip()), b = window.e2e.sink.play(clip()), c = window.e2e.sink.play(clip());
    const first = await Promise.all([a.done, b.done]);
    await new Promise((r) => setTimeout(r, 100));
    const mid = L.now; c.stop(); await c.done;
    return { max: L.max, mid, now: L.now, first };
  });
  check("喇叭这一层：连着播三段 → 前两段被掐掉（done = false），只有最后一段在响", overlapSink.max === 1 && overlapSink.mid === 1 && overlapSink.now === 0 && overlapSink.first.every((x) => x === false), JSON.stringify(overlapSink));

  const stress = await page.evaluate(async () => {
    // 连着播 60 段 0.25 秒的声音，每段等它播完：没有一段卡住（浏览器不发 ended 时由喇叭自己的时钟判定收场）
    const L = window.e2e.live; const before = L.ended ?? 0; const t0 = performance.now(); let ok = 0, slowest = 0;
    for (let k = 0; k < 60; k++) {
      const t = performance.now();
      const done = await Promise.race([window.e2e.sink.play({ samples: new Float32Array(5512).fill(0.01), sampleRate: 22050 }).done, new Promise((r) => setTimeout(() => r("hung"), 3000))]);
      if (done === true) ok++; slowest = Math.max(slowest, performance.now() - t);
    }
    return { ok, slowest: Math.round(slowest), totalMs: Math.round(performance.now() - t0), endedEvents: (L.ended ?? 0) - before };
  });
  check("喇叭连播 60 段：每段都收场，没有一段卡住", stress.ok === 60 && stress.slowest < 1500, JSON.stringify(stress));
  console.log(`  （60 段里浏览器发了 ${stress.endedEvents} 次 ended；最慢的一段 ${stress.slowest} ms）`);

  await page.evaluate((v) => window.e2e.engine.delete(v), ZV);
  check("删除：包没了、引擎也卸了", await page.evaluate(async (v) => (await window.e2e.engine.status(v)).bytesCached === 0 && window.e2e.engine.loaded() === null, ZV));
  const noPack = await page.evaluate((v) => window.e2e.engine.load(v).then(() => "loaded", (e) => e.message), ZV);
  check("没包就装 → pack-missing", noPack === "pack-missing", noPack);
  const imp = await page.evaluate(async (v) => window.e2e.engine.importFiles(v, await window.e2e.voiceFiles(v)), ZV);
  check("用户导入分片文件 → 就绪", imp.ready === true, JSON.stringify(imp));
  const impBad = await page.evaluate(async (v) => { const files = await window.e2e.voiceFiles(v, "/tampered"); await window.e2e.engine.delete(v); return window.e2e.engine.importFiles(v, files).then(() => "accepted", (e) => e.message); }, ZV);
  check("导入坏文件 → 拒收，缓存里什么都没进", /sha256 mismatch/.test(impBad) && await page.evaluate(async (v) => (await window.e2e.engine.status(v)).bytesCached === 0, ZV), impBad);
  const impNone = await page.evaluate((v) => window.e2e.engine.importFiles(v, [new File(["hello"], "notes.txt")]).then(() => "accepted", (e) => e.message), ZV);
  check("导入的文件一个都不认识 → no-matching-file", impNone === "no-matching-file", impNone);

  await page.evaluate((v) => window.e2e.engine.download(v, "/models"), JV);
  const lj = await page.evaluate((v) => window.e2e.engine.load(v), JV);
  check("sherpa 日语包装进引擎（十个说话人）", lj.speakers === 10, JSON.stringify(lj));
  const j = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja"));
  check("sherpa 合成一句日语：有声音、时长合理", j.sec > 2 && j.sec < 10 && j.rms > 0.01, JSON.stringify(j));

  // ══ 二、つくよみちゃん（piper-plus 引擎；一个音色 = 五个小包）══
  const [P_VOICE, P_RT] = tsuDef.packs, P_JA = tsuDef.langPacks.ja[0], P_EN = tsuDef.langPacks.en[0], P_ZH = tsuDef.langPacks.zh[0];
  const dEn = await page.evaluate((v) => window.e2e.engine.download(v, "/tsu", { langs: ["en"] }), TV);
  check("只下英语：权重 + 运行时 + 英语词典，别的不动", dEn.ready === false && dEn.langs.join() === "en" && dEn.bytesCached === bytesOf([P_VOICE, P_RT, P_EN]), JSON.stringify({ langs: dEn.langs, bytes: dEn.bytesCached }));
  before = chunkFetches;
  const dOther = await page.evaluate((v) => window.e2e.engine.download(v, "/models"), OV);
  check("另一个音色共用运行时和英语词典：只取它自己的权重包", dOther.ready === true && chunkFetches - before === packs[ZH].chunks, `${chunkFetches - before} chunk fetches`);
  const lEn = await page.evaluate((v) => window.e2e.engine.load(v), TV);
  check("换引擎装载：只装英语（sherpa 的 worker 关掉）", lEn.langs.join() === "en" && lEn.speakers === 1 && lEn.sampleRate === 22050, JSON.stringify(lEn));
  const e1 = await page.evaluate(() => window.e2e.synth("The quick brown fox jumps over the lazy dog.", "en", { keep: "en" }));
  check("英语一句：有声音、时长合理", e1.sec > 1.5 && e1.sec < 8 && e1.rms > 0.01, JSON.stringify(e1));
  const noJa = await page.evaluate(() => window.e2e.synth("こんにちは。", "ja").then(() => "ok", (e) => e.message));
  check("没装日语就念日语 → 报错说哪种语言没有", /language "ja" is not available/.test(noJa), noJa);

  before = chunkFetches;
  const dAll = await page.evaluate(async (v) => { const seen = []; const st = await window.e2e.engine.download(v, "/tsu", { onProgress: (p) => seen.push(p) }); return { st, first: seen[0], last: seen[seen.length - 1] }; }, TV);
  check("补齐全部语言：只取缺的两个包（日语 1 片 + 中文 1 片）", dAll.st.ready && dAll.st.langs.join() === "ja,en,zh" && chunkFetches - before === 2, `${chunkFetches - before} chunk fetches; ${JSON.stringify(dAll.st.langs)}`);
  check("进度按五个包的总字节报，已经有的算在起点里", dAll.first.total === bytesOf(Object.keys(tsuDef.packIds)) && dAll.first.done === bytesOf([P_VOICE, P_RT, P_EN]) && dAll.last.done === dAll.last.total, JSON.stringify([dAll.first, dAll.last]));

  const reqBefore = requests;
  const lAll = await page.evaluate((v) => window.e2e.engine.load(v), TV);
  check("装进引擎：三种语言", lAll.langs.join() === "ja,en,zh" && lAll.alreadyLoaded === false, JSON.stringify(lAll));
  const again = await page.evaluate((v) => window.e2e.engine.load(v), TV);
  check("同样的再装一次 = 已经装着", again.alreadyLoaded === true);
  // 连着改选项不积压（user 2026-10-02「ipad上调多了preset会不出声」）：每改一次都作废已合成的句子，排着没算的要一起扔掉，
  // 不然最新那一句排在一长串作废的请求后面。比「正常开始到出声」和「每 50 ms 改一次、改 8 次之后到出声」。
  const burst = await page.evaluate(async () => {
    const ra = window.e2e.ra, ev = window.e2e.events, T = "今天天气很好。我们去公园散步吧。晚上回家吃饭。";
    const until = (f) => new Promise((res) => { const tick = () => (f() ? res() : setTimeout(tick, 10)); tick(); });
    ra.stop(); ev.length = 0;
    let t0 = performance.now(); ra.start(T, 0, { langs: ["zh"], preset: 100 });
    await until(() => ev.includes("state:playing")); const single = performance.now() - t0; ra.stop(); ev.length = 0;
    for (let k = 1; k <= 8; k++) { ra.start(T, 0, { langs: ["zh"], preset: k }); await new Promise((r) => setTimeout(r, 50)); }
    t0 = performance.now(); await until(() => ev.includes("state:playing")); const after = performance.now() - t0; ra.stop();
    return { single: Math.round(single), after: Math.round(after), errors: ev.filter((x) => x.startsWith("error")) };
  });
  check("连着改 8 次选项（每 50 ms 一次）后到出声，和正常开始同一量级（不积压作废的合成；不扔时量到 160 → 3192 ms）；没有报错", burst.after < burst.single * 2.5 + 400 && !burst.errors.length, JSON.stringify(burst));
  console.log(`  （连改 8 次：正常开始 ${burst.single} ms，改完到出声 ${burst.after} ms）`);
  const ja = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", { keep: "ja" }));
  check("日语一句：有声音、时长合理", ja.sec > 3 && ja.sec < 9 && ja.rms > 0.01, JSON.stringify(ja));
  const zh = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { keep: "zh", whole: false }));
  check("中文一句：有声音、时长合理", zh.sec > 2 && zh.sec < 9 && zh.rms > 0.01, JSON.stringify(zh));
  const en2 = await page.evaluate(() => window.e2e.synth("The quick brown fox jumps over the lazy dog.", "en"));
  check("英语一句（全语言装载下）：时长和只装英语时同一量级（每一遍有随机差异，量到过 2.1–2.9 秒）", en2.sec > e1.sec * 0.55 && en2.sec < e1.sec * 1.8 && en2.rms > 0.01, `${en2.sec} vs ${e1.sec}`);
  // 念法 1 = 时长没有随机（noise_w 0）：比得出确定的结果（原来用随机时长比、门槛 0.97，2026-10-02 抖过一次：1.25 倍反而长了 3 %）
  const jaSteady = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", { steadiness: 1 }));
  const fast = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", { speed: 1.25, steadiness: 1 }));
  check("语速 1.25：这一句变短（时长确定时应是 0.8 倍左右，门槛 0.9）", fast.sec < jaSteady.sec * 0.9 && fast.sec > jaSteady.sec * 0.7, `${fast.sec} vs ${jaSteady.sec}`);
  const zhFast = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { speed: 1.5, whole: false }));
  check("整句合成关：小句之间垫的静音跟着语速缩：1 倍速 250 ms，1.5 倍速 167 ms", Math.abs(zh.silenceMs - 250) <= 8 && Math.abs(zhFast.silenceMs - 167) <= 8, `${zh.silenceMs} / ${zhFast.silenceMs}`);
  const st1 = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { steadiness: 1, whole: false }));
  const st2 = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { steadiness: 1, whole: false }));
  check("念法 steadiness 1（整句合成关）：两遍一模一样长（时长没有随机），有声音", st1.sec === st2.sec && st1.rms > 0.01, `${st1.sec} / ${st2.sec}`);
  const half = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { steadiness: 0.5 }));
  check("念法 steadiness 0.5：照常出声", half.sec > 1 && half.rms > 0.01, JSON.stringify(half));

  // ── 整句合成（默认开；user 2026-10-02「加一个整句合成的选项，默认开，可以开关」）──
  const S3 = "一个信使满头大汗，一边跑一边大喊：“好消息！坏消息！快来看啊！”";
  const wOn = await page.evaluate((s) => window.e2e.synth(s, "zh", { steadiness: 1 }), S3);
  const wOff = await page.evaluate((s) => window.e2e.synth(s, "zh", { steadiness: 1, whole: false }), S3);
  // 念法 1 = 时长没有随机（noise_w 0），声音还有一点（noise_scale 0.333）：比时长，不比采样
  check("整句合成（默认）：有声音，和逐段合成走的是两条路（念法 1 时长确定，两种做法的时长不一样）", wOn.sec > 2 && wOn.rms > 0.01 && wOn.sec !== wOff.sec, `${JSON.stringify(wOn)} / ${JSON.stringify(wOff)}`);
  const wOn2 = await page.evaluate((s) => window.e2e.synth(s, "zh", { steadiness: 1 }), S3);
  // 补多少静音看模型自己停得多安静，声音里还有一点随机（noise_scale 0.333）→ 每遍差几毫秒
  check("整句合成：同样的输入两遍长度只差一点（≤ 100 ms；补的静音看模型自己停得多安静，量到过 45 ms）", Math.abs(wOn2.sec - wOn.sec) <= 0.1, `${wOn2.sec} / ${wOn.sec}`);
  const wPause = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { steadiness: 1 }));
  check("整句合成：逗号处的安静（模型自己的 + 补的）至少有 250 ms 左右", wPause.quietMs >= 230, JSON.stringify(wPause));
  const wFast = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh", { steadiness: 1, speed: 2 }));
  check("整句合成：语速 2 时停顿跟着缩（安静段 ≥ 115 ms，且比 1 倍速短）", wFast.quietMs >= 110 && wFast.quietMs < wPause.quietMs, `${wFast.quietMs} / ${wPause.quietMs}`);
  const wQ = await page.evaluate(() => window.e2e.synth("维薇安皱起眉头，问：“你盯着我看干什么？”", "zh", { steadiness: 1 }));
  check("整句合成：引号处真切开（冒号 + 开引号那里垫的是整段 350 ms 的纯静音；user「引号系的应该用分句而不是pause符号」）", Math.abs(wQ.silenceMs - 350) <= 8 && wQ.rms > 0.01, JSON.stringify(wQ));
  const wEn = await page.evaluate(() => window.e2e.synth("When the rain stopped, the children ran outside, laughing and shouting.", "en", { steadiness: 1 }));
  check("整句合成：英语也走（有声音）", wEn.sec > 2 && wEn.rms > 0.01, JSON.stringify(wEn));

  // ── 本地模型（user 2026-10-02「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」）──
  const base1 = await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh", { steadiness: 1, whole: false }));
  const same = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model/tsukuyomi-chan-6lang-fp16.onnx" }), TV);
  check("本地模型：换进一模一样的权重 → 重新装载、报出换了 model.onnx", !same.error && same.alreadyLoaded === false && same.override.join() === "model.onnx" && await page.evaluate(() => window.e2e.engine.loaded().override.join() === "model.onnx"), JSON.stringify(same));
  const same1 = await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh", { steadiness: 1, whole: false }));
  check("本地模型：一模一样的权重 → 一样长（念法 1 时长确定）", same1.sec === base1.sec, `${same1.sec} / ${base1.sec}`);
  if (existsSync(join(LOCAL, "work/model-langemb/tsukuyomi-langemb-from-base.onnx"))) {
    const alt = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-langemb-from-base.onnx" }), TV);
    const alt1 = await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh", { steadiness: 1, whole: false }));
    check("本地模型：换进改过的权重（换回中文语言向量）→ 时长变了（中文向量下念得慢）", !alt.error && alt1.rms > 0.01 && alt1.sec > base1.sec * 1.15, `${JSON.stringify(alt)} ${alt1.sec} / ${base1.sec}`);
  } else console.log("  （检疫桶里没有换回中文向量的实验权重，跳过「输出变了」那一条）");
  const badCfg = await page.evaluate((v) => window.e2e.loadBadConfig(v, "/local/work/model/config.json"), TV);
  check("本地模型：换进的 config.json 音素表对不上 → 拒绝（override-mismatch），之后引擎是空的", /^override-mismatch/.test(badCfg.error ?? "") && await page.evaluate(() => window.e2e.engine.loaded() === null), JSON.stringify(badCfg));
  const unknown = await page.evaluate((v) => window.e2e.loadOverride(v, { "weights.bin": "/local/work/model/config.json" }), TV);
  check("本地模型：只能换音色已有的文件 → 别的名字拒绝", /has no file "weights\.bin"/.test(unknown.error ?? ""), JSON.stringify(unknown));
  if (existsSync(join(LOCAL, "base/base-nounify.onnx"))) {
    const bse = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/base/base-nounify.onnx", "config.json": "/local/base/config.json" }), TV);
    const bse1 = bse.error ? null : await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh"));
    check("本地模型：piper-plus 底模 + 它自己的 config.json（少的只是末尾的瑞典语记号）→ 收下、念得出中文", !bse.error && bse.override.join() === "config.json,model.onnx" && bse1 && bse1.sec > 0.5 && bse1.rms > 0.01, JSON.stringify(bse) + JSON.stringify(bse1));
    const mera = existsSync(join(LOCAL, "mera/config.json")) ? await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/base/base-nounify.onnx", "config.json": "/local/mera/config.json" }), TV) : null;
    if (mera) check("本地模型：メラちゃん的 config.json（旧一代，86 个记号编号不同）→ 拒绝", /^override-mismatch: config\.json maps \d+ symbol/.test(mera.error ?? ""), JSON.stringify(mera));
  } else console.log("  （检疫桶里没有导出的底模，跳过底模那两条）");
  check("现役月读的模型没有 preset 输入 → 装载结果报 preset: false", same.preset === false, JSON.stringify(same));
  if (existsSync(join(LOCAL, "work/model-langemb/tsukuyomi-preset16.onnx"))) {
    // 预设约定（user 2026-10-02「onnx可以实现可以不实现，输入就是一个用户键盘输入的signed int，然后模型随便解释」）。
    // tsukuyomi-preset16：夹到 0..15，bit0 dp / bit1 enc_p / bit2 flow / bit3 dec 读中文向量。念法 1 + 整句关 → 时长确定，比时长。
    const pr = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-preset16.onnx" }), TV);
    check("预设：带 preset 输入的模型 → 装载结果报 preset: true", !pr.error && pr.preset === true && await page.evaluate(() => window.e2e.engine.loaded().preset === true), JSON.stringify(pr));
    const S = "两个人也不是很会野外生存。", P = (p) => page.evaluate(([s, p]) => window.e2e.synth(s, "zh", { steadiness: 1, whole: false, preset: p }), [S, p]);
    const p0 = await P(0), p1 = await P(1), p8 = await P(8), pNeg = await P(-5), pBig = await P(99), p15 = await P(15);
    check("预设 0 = 原版：和不带预设的现役月读一样长", p0.sec === base1.sec, `${p0.sec} / ${base1.sec}`);
    check("预设 1（只有时长读中文向量）：明显变长；预设 8（只有解码器）：时长不变", p1.sec > p0.sec * 1.5 && p8.sec === p0.sec && p8.rms > 0.01, `${p0.sec} / ${p1.sec} / ${p8.sec}`);
    check("预设越界由模型夹住：−5 = 0，99 = 15", pNeg.sec === p0.sec && pBig.sec === p15.sec, `${pNeg.sec} ${p0.sec} / ${pBig.sec} ${p15.sec}`);
    // 英文同样走这几个开关（预设模型里中英西法葡五行都换成了底模的行；user 2026-10-02「对了，英文也接，一起测」）
    const E = "The children ran outside to play in the garden.", PE = (p) => page.evaluate(([s, p]) => window.e2e.synth(s, "en", { steadiness: 1, whole: false, preset: p }), [E, p]);
    const e0 = await PE(0), e1 = await PE(1), e8 = await PE(8), e15 = await PE(15), eBig = await PE(99);
    await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model/tsukuyomi-chan-6lang-fp16.onnx" }), TV);
    const eOrig = await page.evaluate((s) => window.e2e.synth(s, "en", { steadiness: 1, whole: false }), E);
    await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-preset16.onnx" }), TV);
    check("预设 · 英文：0 = 原版（一样长）；1（时长读底模的英文向量）时长变了；8（只有解码器）时长不变；99 = 15；都有声音", e0.sec === eOrig.sec && e1.sec !== e0.sec && e8.sec === e0.sec && eBig.sec === e15.sec && [e0, e1, e8, e15].every((x) => x.rms > 0.01), `orig ${eOrig.sec} / 0 ${e0.sec} / 1 ${e1.sec} / 8 ${e8.sec} / 15 ${e15.sec} / 99 ${eBig.sec}`);
    const j0 = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", { steadiness: 1, preset: 0 }));
    const j15 = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", { steadiness: 1, preset: 15 }));
    check("预设 · 日语：0 和 15 一样长（日语那一行每档都没动）", j0.sec === j15.sec && j0.rms > 0.01, `${j0.sec} / ${j15.sec}`);
  }
  if (existsSync(join(LOCAL, "work/model-langemb/tsukuyomi-chan-zhen.onnx")) && existsSync(join(LOCAL, "work/model-langemb/tsukuyomi-chan-zhen.config.json"))) {
    // 月读（中英增强）：config.json "preset_default": { "zh": 3, "en": 9 }——没给预设时按每一段的语言取（user 2026-10-02「然后字段是"preset_default": { "zh": 3, "en": 9 }同意」）
    const zl = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-chan-zhen.onnx", "config.json": "/local/work/model-langemb/tsukuyomi-chan-zhen.config.json" }), TV);
    const Z = (s, l, p) => page.evaluate(([s, l, p]) => window.e2e.synth(s, l, { steadiness: 1, whole: false, ...(p === undefined ? {} : { preset: p }) }), [s, l, p]);
    const zs = "两个人也不是很会野外生存。", es = "The children ran outside to play in the garden.", js = "森の中で、小さな女の子が赤い花を見つけました。";
    const [zD, z3, z0, eD, e9, jD, j0z] = [await Z(zs, "zh"), await Z(zs, "zh", 3), await Z(zs, "zh", 0), await Z(es, "en"), await Z(es, "en", 9), await Z(js, "ja"), await Z(js, "ja", 0)];
    check("月读（中英增强）：不给预设 = config 的默认（中文 = 3、英文 = 9、日文 = 0）；给 0 = 原版（和默认不一样长）", !zl.error && zl.preset === true && zD.sec === z3.sec && eD.sec === e9.sec && jD.sec === j0z.sec && z0.sec !== zD.sec, `zh ${zD.sec}/${z3.sec}/${z0.sec} en ${eD.sec}/${e9.sec} ja ${jD.sec}/${j0z.sec} ${JSON.stringify(zl)}`);
  } else console.log("  （检疫桶里没有 preset16 模型，跳过预设那几条）");
  const back = await page.evaluate((v) => window.e2e.engine.load(v), TV);
  const back1 = await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh", { steadiness: 1, whole: false }));
  check("本地模型：不带 override 再装 → 换回包里的权重（和最开始一样长）", back.alreadyLoaded === false && back.override.length === 0 && back1.sec === base1.sec, `${back1.sec} / ${base1.sec}`);
  const dots = await page.evaluate(() => window.e2e.synth("……", "ja"));
  check("只有标点的一句 → 长度 0 的一段（不报错）", dots.sec === 0, JSON.stringify(dots));
  console.log(`  （つくよみちゃん 建器 ${lAll.createMs} ms；日 ${ja.sec.toFixed(1)} s 音频 / ${ja.ms} ms，英 ${en2.sec.toFixed(1)} s / ${en2.ms} ms，中 ${zh.sec.toFixed(1)} s / ${zh.ms} ms）`);

  const hangul = await page.evaluate(() => window.e2e.synth("안녕하세요。", "ja"));
  check("后端念不了的文字（日语模式下的谚文）→ 长度 0 的一段", hangul.sec === 0, JSON.stringify(hangul));
  // ── 每句自己判语言（不给 lang）：中文夹英文词、中日混排的一句、纯英文一句 ──
  const MIXED = "族里的祭司（Tohunga）走过来，神情严肃。\n这个词读作「せんせい」，意思是老师。\nThe end of the story.";
  await page.evaluate((t) => { window.e2e.sink.unlock(); window.e2e.events.length = 0; window.e2e.live.max = 0; window.e2e.ra.start(t, 0, { langs: ["ja", "zh", "en"] }); }, MIXED);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.events.includes("end") || window.e2e.events.some((x) => x.startsWith("error"))));
  const mev = await page.evaluate(() => ({ ev: window.e2e.events.slice(), max: window.e2e.live.max }));
  check("每句自己判语言：中文夹英文 / 中日混排 / 英文三句都念完、没有出错、没有叠音", mev.ev.filter((x) => x.startsWith("sentence:")).join(",") === "sentence:0,sentence:1,sentence:2" && mev.ev[mev.ev.length - 1] === "end" && !mev.ev.some((x) => x.startsWith("error")) && mev.max === 1, JSON.stringify(mev));
  const zhEn = await page.evaluate(() => window.e2e.synth("族里的祭司（Tohunga）走过来。", "zh"));
  check("中文里夹的英文词（英语前端念）：有声音", zhEn.sec > 1 && zhEn.rms > 0.01, JSON.stringify(zhEn));
  const JTEXT = "こんにちは。\n안녕하세요。\nさようなら。";
  await page.evaluate((t) => { window.e2e.sink.unlock(); window.e2e.events.length = 0; window.e2e.ra.start(t, 0, { lang: "ja" }); }, JTEXT);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.events.includes("end") || window.e2e.events.some((x) => x.startsWith("error"))));
  const jev = await page.evaluate(() => window.e2e.events.slice());
  check("连读三句、中间一句念不了：读两句、跳过一句、发 end", jev.filter((x) => x.startsWith("sentence:")).join(",") === "sentence:0,sentence:2" && jev[jev.length - 1] === "end" && !jev.some((x) => x.startsWith("error")), jev.join(","));
  check("装载 + 合成 + 连读期间，浏览器一个请求都没发（引擎胶水没有自己去取任何东西）", requests === reqBefore, `${requests - reqBefore} request(s)`);

  if (SAMPLES) {
    await mkdir(SAMPLES, { recursive: true });
    for (const name of ["ja", "en", "zh"]) {
      const { sampleRate, b64 } = await page.evaluate((n) => window.e2e.pcm16(n), name);
      const pcm = Buffer.from(b64, "base64"), h = Buffer.alloc(44);
      h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
      h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
      await writeFile(join(SAMPLES, `${name}.wav`), Buffer.concat([h, pcm]));
    }
    console.log(`  （三句 wav 已存到 ${SAMPLES}）`);
  }

  // ── 删除：别的「装着的」音色还在用的包留着 ──
  await page.evaluate((v) => window.e2e.engine.delete(v), TV);
  const afterDel = await page.evaluate(async ([a, b]) => ({ full: await window.e2e.engine.status(a), other: await window.e2e.engine.status(b), loaded: window.e2e.engine.loaded() }), [TV, OV]);
  check("删掉这个音色：它独有的包（权重、日语、中文）没了；另一个装着的音色共用的运行时和英语词典留着，照样就绪；引擎卸了", afterDel.full.langs.length === 0 && afterDel.full.bytesCached === bytesOf([P_RT, P_EN]) && afterDel.other.ready === true && afterDel.loaded === null, JSON.stringify({ langs: afterDel.full.langs, bytes: afterDel.full.bytesCached, other: afterDel.other.ready, loaded: afterDel.loaded }));
  await page.evaluate((v) => window.e2e.engine.delete(v), OV);
  const afterDel2 = await page.evaluate(async ([a, b]) => [(await window.e2e.engine.status(a)).bytesCached, (await window.e2e.engine.status(b)).bytesCached], [TV, OV]);
  check("另一个音色也删：没装的音色不占着共用包，运行时和英语词典这下没了（它的权重包 zh-test 还装着在用，留着）", afterDel2[0] === 0 && afterDel2[1] === packs[ZH].bytes, JSON.stringify(afterDel2));
  await page.evaluate((v) => window.e2e.engine.delete(v), ZV);
  check("zh-test 也删：全没了", await page.evaluate(async (v) => (await window.e2e.engine.status(v)).bytesCached === 0, OV));
  // 没下官方权重也能用本地模型（user 2026-10-02「没有下载官方模型的时候，本地模型加载了还是没法启用语音」）：.onnx + .json 把权重包整个顶替 →
  // 只要运行时和那种语言的词典
  if (existsSync(join(LOCAL, "work/model-langemb/tsukuyomi-chan-zhen.config.json"))) {
    const OVN = ["model.onnx", "config.json"], before0 = chunkFetches;
    const dOnly = await page.evaluate(([v, o]) => window.e2e.engine.download(v, "/tsu", { langs: ["zh"], override: o }), [TV, OVN]);
    const plain = await page.evaluate((v) => window.e2e.engine.status(v), TV);
    check("本地模型顶替了整个权重包：只下运行时 + 中文词典（不取权重）；带 override 问 = 中文能念，不带问 = 还不能", chunkFetches - before0 === packs[tsuDef.packs[1]].chunks + packs[tsuDef.langPacks.zh[0]].chunks && dOnly.langs.join() === "zh" && plain.langs.length === 0, `${chunkFetches - before0} chunks; with ${JSON.stringify(dOnly.langs)} plain ${JSON.stringify(plain.langs)}`);
    const lOnly = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-chan-zhen.onnx", "config.json": "/local/work/model-langemb/tsukuyomi-chan-zhen.config.json" }, ["zh"]), TV);
    const zOnly = lOnly.error ? null : await page.evaluate(() => window.e2e.synth("两个人也不是很会野外生存。", "zh"));
    check("没有官方权重：本地 .onnx + .json 装得上、念得出中文", !lOnly.error && lOnly.langs.join() === "zh" && zOnly && zOnly.rms > 0.01, JSON.stringify(lOnly) + JSON.stringify(zOnly));
    const lHalf = await page.evaluate((v) => window.e2e.loadOverride(v, { "model.onnx": "/local/work/model-langemb/tsukuyomi-chan-zhen.onnx" }, ["zh"]), TV);
    check("没有官方权重、只给 .onnx（配置还得从权重包拿）→ pack-missing", lHalf.error === "pack-missing", JSON.stringify(lHalf));
    await page.evaluate((v) => window.e2e.engine.delete(v), TV);
  } else console.log("  （检疫桶里没有增强版的配置，跳过「没下官方权重」那几条）");

  // ── 按哈希导入：五个包的分片文件名撞名（四个都叫 chunk-000），外加清单文件 ──
  const impT = await page.evaluate(async (v) => { const files = await window.e2e.voiceFiles(v); const st = await window.e2e.engine.importFiles(v, files); return { n: files.length, names: [...new Set(files.map((f) => f.name))].join(","), ready: st.ready, langs: st.langs }; }, TV);
  check("一把文件按内容认领 → 五个包全就绪", impT.ready && impT.langs.join() === "ja,en,zh", JSON.stringify(impT));
  const lImp = await page.evaluate((v) => window.e2e.engine.load(v, { langs: ["zh"] }), TV);
  check("导入来的包装得进引擎（只装中文）", lImp.langs.join() === "zh", JSON.stringify(lImp));
  const impTBad = await page.evaluate(async (v) => { const files = await window.e2e.voiceFiles(v, "/tsu-tampered"); await window.e2e.engine.delete(v); return window.e2e.engine.importFiles(v, files).then(() => "accepted", (e) => e.message); }, TV);
  check("导入一把坏文件 → 拒收，一片都没进", /sha256 mismatch/.test(impTBad) && await page.evaluate(async (v) => (await window.e2e.engine.status(v)).bytesCached === 0, TV), impTBad);

  await page.evaluate(() => window.e2e.engine.dispose());
  const after = await page.evaluate((v) => window.e2e.engine.status(v).then((st) => st.ready), JV);
  check("dispose 之后再用：自动重新起 worker，缓存还在", after === true);
  await page.evaluate((v) => Promise.all([window.e2e.engine.delete(v), caches.delete("read-aloud-e2e")]), JV);
  check("零页面错误", errors.length === 0, errors.join(" | ").slice(0, 400));
} finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  read-aloud e2e: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
