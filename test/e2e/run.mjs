// @internal/read-aloud 整链测试：真引擎（家族 vendor 的 sherpa-onnx wasm）+ 真语音包（检疫桶里的测试包）+ 真 Cache Storage + 真 Web Audio，
// 在无头 Chromium 里把「下载 → 逐片校验 → 缓存 → 装进引擎 → 合成 → 连读」整条走一遍。用法：npm run e2e（先 build）。
// 不进 npm test：要下 160 MB 本地文件、合成几句，约一分钟。这台机子的显卡在跑别的：浏览器 --disable-gpu。
// created 2026-10-01 by Claude Fable 5.1
import { createRequire } from "node:module";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
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
for (const [what, p] of [["engine wasm", ENGINE_WASM], ["engine tts js", ENGINE_TTS_JS], ["test packs", join(PACKS, ZH)], ["esbuild", ESBUILD ?? ""]]) if (!p || !existsSync(p)) { console.error(`[e2e] missing ${what}: ${p}`); process.exit(2); }

await mkdir(join(HERE, ".out"), { recursive: true });
execFileSync(ESBUILD, [join(LIB, "dist/worker/index.js"), "--bundle", "--format=iife", "--target=es2020", `--outfile=${join(HERE, ".out/worker.js")}`, "--log-level=warning"]);
execFileSync(ESBUILD, [join(HERE, "page.js"), "--bundle", "--format=esm", "--target=es2020", `--outfile=${join(HERE, ".out/page.js")}`, "--log-level=warning"]);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
let chunkFetches = 0;
const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    let file, corrupt = false;
    if (p.startsWith("/engine/")) { const n = p.slice(8); file = n === "sherpa-onnx-tts.js" ? join(ENGINE_TTS_JS, n) : join(ENGINE_WASM, n); }
    else if (p.startsWith("/models/")) file = join(PACKS, p.slice("/models/packs/".length));
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

  const packs = await page.evaluate(([a, b]) => window.e2e.make([a, b], "read-aloud-e2e"), [ZH, JA]);
  check("清单内嵌：两个测试包", !!packs[ZH] && !!packs[JA], JSON.stringify(packs));

  // ── 包：状态 / 被篡改的源 / 下载 / 续传 / 导入 / 删除 ──
  check("起步：没有包", (await page.evaluate((s) => window.e2e.engine.status(s), ZH)).ready === false);
  const bad = await page.evaluate((s) => window.e2e.engine.download(s, "/tampered").then(() => "accepted", (e) => e.message), ZH);
  check("被篡改的源：sha256 对不上 → 拒收", /sha256 mismatch/.test(bad), bad);
  check("拒收之后仍然没有包（坏分片没进缓存）", await page.evaluate(async (s) => { const st = await window.e2e.engine.status(s); return st.ready === false && st.bytesCached === 0; }, ZH));
  const dl = await page.evaluate(async (s) => { const seen = []; const st = await window.e2e.engine.download(s, "/models", (p) => seen.push(p.done)); return { st, last: seen[seen.length - 1], n: seen.length }; }, ZH);
  check("下载 + 逐片校验 → 就绪，进度报到满", dl.st.ready && dl.st.bytesCached === packs[ZH].bytes && dl.last === packs[ZH].bytes, JSON.stringify(dl));
  const before = chunkFetches;
  await page.evaluate((s) => window.e2e.engine.download(s, "/models"), ZH);
  check("再下载一次：已有的分片不重取", chunkFetches === before, `${chunkFetches - before} refetched`);
  check("同步问「有没有包」", await page.evaluate((s) => window.e2e.engine.isKnownReady(s) === true, ZH));

  // ── 引擎：装包 / 合成 ──
  const ld = await page.evaluate((s) => window.e2e.engine.load(s), ZH);
  check("装进引擎", ld.alreadyLoaded === false && ld.sampleRate > 8000 && ld.voices >= 1, JSON.stringify(ld));
  const z = await page.evaluate(() => window.e2e.synth("今天天气很好，我们去公园散步吧。", "zh"));
  check("合成一句中文：有声音、时长合理", z.sec > 1 && z.sec < 8 && z.rms > 0.01, JSON.stringify(z));
  console.log(`  （中文一句 ${z.sec.toFixed(1)} s 音频，算了 ${z.ms} ms，建器 ${ld.createMs} ms）`);

  // ── 连读控制器 + 真喇叭 ──
  const TEXT = "你好。\n再见。";
  await page.evaluate((t) => { window.e2e.sink.unlock(); window.e2e.events.length = 0; window.e2e.ra.start(t, 0); }, TEXT);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.events.includes("end") || window.e2e.events.some((x) => x.startsWith("error"))));
  const ev = await page.evaluate(() => window.e2e.events.slice());
  check("连读两句：逐句报位置，读完发 end，回到 idle", ev.filter((x) => x.startsWith("sentence:")).join(",") === "sentence:0,sentence:1" && ev[ev.length - 1] === "end" && !ev.some((x) => x.startsWith("error")), ev.join(","));
  await page.evaluate((t) => { window.e2e.events.length = 0; window.e2e.ra.start(t, 4, { once: true }); }, TEXT);
  await page.evaluate(() => window.e2e.wait(() => window.e2e.ra.state() === "idle" && window.e2e.events.includes("sentence:1")));
  check("点一句只读一句（已合成过的不重算）", await page.evaluate(() => !window.e2e.events.includes("end") && !window.e2e.events.includes("state:loading")), (await page.evaluate(() => window.e2e.events.join(","))));

  // ── 删除 / 用户导入 ──
  await page.evaluate((s) => window.e2e.engine.delete(s), ZH);
  check("删除：包没了、引擎也卸了", await page.evaluate(async (s) => (await window.e2e.engine.status(s)).bytesCached === 0 && window.e2e.engine.loaded() === null, ZH));
  const noPack = await page.evaluate((s) => window.e2e.engine.load(s).then(() => "loaded", (e) => e.message), ZH);
  check("没包就装 → pack-missing", noPack === "pack-missing", noPack);
  const imp = await page.evaluate(async (s) => { const files = await window.e2e.chunkFiles(s, "/models"); return window.e2e.engine.importFiles(s, files); }, ZH);
  check("用户导入分片文件 → 就绪", imp.ready === true, JSON.stringify(imp));
  const impBad = await page.evaluate(async (s) => { const files = await window.e2e.chunkFiles(s, "/tampered"); await window.e2e.engine.delete(s); return window.e2e.engine.importFiles(s, files).then(() => "accepted", (e) => e.message); }, ZH);
  check("导入坏文件 → 拒收", /sha256 mismatch/.test(impBad), impBad);

  // ── 日语包（多语模型：语言码要传进去）──
  await page.evaluate((s) => window.e2e.engine.download(s, "/models"), JA);
  const lj = await page.evaluate((s) => window.e2e.engine.load(s), JA);
  check("日语包装进引擎（十个音色）", lj.voices === 10, JSON.stringify(lj));
  const j = await page.evaluate(() => window.e2e.synth("森の中で、小さな女の子が赤い花を見つけました。", "ja", 0));
  check("合成一句日语：有声音、时长合理", j.sec > 2 && j.sec < 10 && j.rms > 0.01, JSON.stringify(j));
  console.log(`  （日语一句 ${j.sec.toFixed(1)} s 音频，算了 ${j.ms} ms，建器 ${lj.createMs} ms）`);
  await page.evaluate(() => window.e2e.engine.dispose());
  const after = await page.evaluate((s) => window.e2e.engine.status(s).then((st) => st.ready), JA);
  check("dispose 之后再用：自动重新起 worker，缓存还在", after === true);
  await page.evaluate((s) => Promise.all([window.e2e.engine.delete(s), caches.delete("read-aloud-e2e")]), JA);
  check("零页面错误", errors.length === 0, errors.join(" | ").slice(0, 400));
} finally { await browser.close(); srv.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n  read-aloud e2e: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
