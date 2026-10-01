# 20261001 internal-read-aloud — 本库规则（@internal/read-aloud）

家族总规则见 `../CLAUDE.md`。created 2026-10-01 by Claude Fable 5.1。

出生依据：user 2026-10-01「日语学习那边逼出来了per sentence tts的需求，作为可选插件。然后我建议一开始就做成共享库，因为wxhw的验证读一遍也很有用」「记得模块化不要bloatware」「设置分栏 公共字体 逐句朗读 亮屏连续 做」。
评估、实测数字、提案 .h = `../ai-docs/20261001-read-aloud-shared-lib-assessment.md`。
**库名 `read-aloud` 是 AI 先起的，等 user 定**（改名 = 改 package.json 的 name、四个脚本里的包名、宿主的 import）。

- **本库 = 逐句朗读**：把一段文字切成句子、一句一句合成成语音、播出来、报「现在读到哪一句」。
- **三层，各自可单独用**（`src/index.ts` 头注释）：① 分句（纯函数）② 连读控制器（零 DOM）③ 引擎门面 + 喇叭（浏览器）。worker 是「公共运行时 `src/worker/runtime.ts` + 每种引擎一个入口」（`./worker-sherpa` …），宿主把用得上的入口单独打成一个文件。
- **界面全归宿主**：按钮、高亮、滚动、设置页、图标、文案。库里没有一行 DOM 结构、没有一个用户可见的字。
- **不 bloat 的三条**：宿主 bundle 只进门面和分句；worker、引擎二进制、语音包第一次真用到才动；service worker 不许预缓存引擎和语音包（宿主的事，写在这提醒）。
- **引擎二进制由宿主 vendor、用 URL 注入**（`engineBase`），不进本库的包。语音包清单由宿主内嵌（信任根 = packId）、字节走家族模型仓协议（`../20260903 PWA Models/README.md`）。
- **联网只有一处**：`src/worker/runtime.ts` 下载语音包分片（只读 GET，逐片 sha256，对不上整包拒收）。Cache Storage 也只在这一个文件（缓存名宿主给，默认家族共享的 `pwa-models`）。**永不碰 localStorage / IndexedDB；永不用系统或云端的语音服务**（`speechSynthesis` 也不许：桌面浏览器会把文字发到服务器）。`test/redline-guard.test.mjs` 机械执法，别绕。
- **后端可换**：`src/worker/backend.ts` 是一种引擎一个后端的形状。现有 `sherpa.ts`（家族已 vendor 的 sherpa-onnx WASM，TTS 已编入）。**user 2026-10-01 定：先用つくよみちゃん（piper-plus 引擎）兜底所有语言，别的音色以后慢慢加**——piper-plus 后端还没写，等浏览器路径和电脑参考实现对齐（排查现场 `~/jupyter/third-party/piper-plus/`）。
- **句间停顿归控制器**（同段 600 ms、跨段 900 ms，可配；600 = piper-plus 参考实现的句间静音。句内逗号处的停顿归后端）：合成出来的一句首尾几乎没有静音，不留气口听着就是「不喘气」。
- **两处逐字拷贝，记账**：`src/sha256.ts` 和 worker 里「下载 / 校验 / 缓存」那一半来自 WebXiaoHeiWu `src/asr/`。WXHW 的识别这轮不动；等本库稳定后让它改吃本库，两份才合一。改算法 = 两边一起改。
- **版本纪律同其他内部库**：开发期 `0.0.0`；版本号只在 user 过目真实导出面（`api/read-aloud.api.md`）之后才写；收货脚本只认打过 tag 的已发版；**发 0.1.0 之前必须 user 批**。
- **开发期往宿主里装包只许用 `scripts/dev-install.sh`**（逐字节验货，拒绝往宿主的 main 上装）。
- **只出货不送货**：本库的活到 commit 交付物为止；宿主收货、跑宿主测试、宿主发版是宿主 session 的活。
- 测试两档：`npm test`（node：分句 / 控制器 / 包的纯函数 / 红线守卫）+ `npm run e2e`（构建后在无头 Chromium 里走整链：真引擎 + 真语音包 + 真 Cache + 真 Web Audio；测试包在检疫桶 `~/jupyter/third-party/sherpa-onnx-wasm/tts-probe/packs-test/`，没发布过）。构建 + 户口 `npm run build`（`api/` 是生成物，勿手改）。
- **这台开发机的显卡可能在跑别的长任务**：测试里的无头浏览器一律 `--disable-gpu`。
- `journal/`、`journals/` 是人类区，AI 永不写。
