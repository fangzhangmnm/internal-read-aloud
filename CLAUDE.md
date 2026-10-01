# 20261001 internal-read-aloud — 本库规则（@internal/read-aloud）

家族总规则见 `../CLAUDE.md`。created 2026-10-01 by Claude Fable 5.1。

出生依据：user 2026-10-01「日语学习那边逼出来了per sentence tts的需求，作为可选插件。然后我建议一开始就做成共享库，因为wxhw的验证读一遍也很有用」「记得模块化不要bloatware」「设置分栏 公共字体 逐句朗读 亮屏连续 做」。
评估、实测数字、提案 .h = `../ai-docs/20261001-read-aloud-shared-lib-assessment.md`。
**库名 `read-aloud` 已定**（user 2026-10-01「就叫read-aloud吧，也符合这个产品的定位」）。

- **本库 = 逐句朗读**：把一段文字切成句子、一句一句合成成语音、播出来、报「现在读到哪一句」。
- **三层，各自可单独用**（`src/index.ts` 头注释）：① 分句（纯函数）② 连读控制器（零 DOM）③ 引擎门面 + 喇叭（浏览器）。worker 是「公共运行时 `src/worker/runtime.ts` + 每种引擎一个入口」（`./worker-sherpa` …），宿主把用得上的入口单独打成一个文件。
- **界面全归宿主**：按钮、高亮、滚动、设置页、图标、文案。库里没有一行 DOM 结构、没有一个用户可见的字。
- **不 bloat 的三条**：宿主 bundle 只进门面和分句；worker、引擎二进制、语音包第一次真用到才动；service worker 不许预缓存引擎和语音包（宿主的事，写在这提醒）。
- **门面只说「音色」，worker 只认「包」**：一个音色 = 一份 `VoiceDef`（模型仓 `voices/<id>.json`：必装的包 + 每种语言另外要的包 + 署名 / 条款原文）。宿主把音色定义和它点名的每个包的清单一起内嵌（信任根 = 清单的 packId）；字节走家族模型仓协议（`../20260903 PWA Models/README.md`），包名规矩见家族 `CLAUDE.md`「共享模型库」。**署名块和条款由宿主显示**（上游要求原文可见），库不画。
- **引擎的大二进制不进本库的包**：piper-plus 的 wasm 和词典随语音包来（user 2026-10-01「放语音包、app 里钉哈希」「运行时如果以后支持第三方源的话不安全吧，还是写好hash就可以了」）；sherpa-onnx 的由宿主 vendor、`engineBase` 注入。**JS 胶水是代码，vendored 在 `backend/<引擎>/vendor/`**（出处写在各自的 `SOURCE.md`）。
- **联网只有一处**：`src/worker/runtime.ts` 下载语音包分片（只读 GET，逐片 sha256，对不上整包拒收）。Cache Storage 也只在这一个文件（缓存名宿主给，默认家族共享的 `pwa-models`）。**永不碰 localStorage / IndexedDB；永不用系统或云端的语音服务**（`speechSynthesis` 也不许：桌面浏览器会把文字发到服务器）。`test/redline-guard.test.mjs` 机械执法（`src/` 和 `backend/` 里我们自己的 JS）；第三方胶水 grep 守不了，由整链测试守「装载 / 合成期间浏览器一个请求都不发」。别绕。
- **后端可换**：`src/worker/backend.ts` 是一种引擎一个后端的形状。现有两个：`piper-plus.ts`（接 `backend/piper-plus/`，つくよみちゃん用；user 2026-10-01「先用她来兜底，以后慢慢加」）和 `sherpa.ts`（家族已 vendor 的 sherpa-onnx WASM，留给以后加别的音色）。**`backend/piper-plus/` 的 JS 逐字来自排查现场 `~/jupyter/third-party/piper-plus/backend/`**（证明它和电脑参考实现喂给模型的东西逐符号相同的测试都在那边）：改算法先在那边改、跑那边的对照测试，再拷过来。
- **公式 / 代码的护栏在分句器里**（`src/sentences.ts`；user 2026-10-01「护栏一下碰到长公式code latex的时候不会被断的支离破碎的情况」）：整块的（围栏代码块、`$$…$$` / `\[…\]` / `\begin…\end`、符号密度很高的行）**不算句子**——不念、不切碎；句子里夹的行内公式 / 行内代码里面不断句，后端的句内断句也不在里面切。门槛故意定高（符号 ≥ 8 个且占三成），`E = mc^2`、`HP+5，MP+3` 这种照常念。
- **句内断句（中文 / 英语）在后端的 `backend/piper-plus/text.js`，规则是一张表，不是一条条特例**（user 2026-10-01「逗号上引号的断句呢，有没有系统的解决枚举办法」）：两段能念的字之间的那一串标点算一簇，按簇里有哪几类符号定停顿——有句末符号 400 ms / 有破折号 350 / 逗号类 + 开引号 350 / 只有逗号类 250 / 只有引号括号不停；断点落在开引号之前；弱断点的短句并到后面一段。表在该文件头注释，规格测试 `test/clauses.test.mjs`（三条真机反馈都在里面）。**加新情况 = 往表里加一类，不许在循环里加特判。** 日语整句交给模型（它自己认得标点）。改这两个文件照旧先改检疫桶那份再拷过来。
- **喇叭不许卡住**：播完靠浏览器的 ended 通知，但 2026-10-01 在无头 Chromium 里见过声卡时钟停住、ended 一直不来、朗读卡在一句上（真机上会不会发生不知道）。`sink.play` 里有一道保险：按墙上的钟累计「声卡处于 running 的时间」，过了这段的长度 + 0.4 秒还没等到通知就自己收场（暂停 / 没解锁不累计）。根因没查清。
- **新点的优先，任何时刻只有一段在响**（2026-10-01 真机：user 听到同一句叠成「unison」，问「能让月读不竞态吗。新点的优先？全局锁？」）。两层各自承重：控制器里被打断的那一轮收尾时只清自己那一段的记录（原来会把新一轮的清掉，下一次打断就停不到正在响的）；喇叭 `sink.play` 进来先掐掉上一段。`test/read-aloud.test.mjs` 和整链测试里的声源计数守着。宿主那层再加一道「只认最后一次点击」。
- **句间停顿归控制器**（同段 600 ms、跨段 900 ms，可配；600 = piper-plus 参考实现的句间静音。句内逗号处的停顿归后端）：合成出来的一句首尾几乎没有静音，不留气口听着就是「不喘气」。
- **两处逐字拷贝，记账**：`src/sha256.ts` 和 worker 里「下载 / 校验 / 缓存」那一半来自 WebXiaoHeiWu `src/asr/`。WXHW 的识别这轮不动；等本库稳定后让它改吃本库，两份才合一。改算法 = 两边一起改。
- **版本纪律同其他内部库**：现行 `0.1.2`（0.1.0 = 2026-10-01 首发，user「库发0.1.0」；0.1.1 = 同日补丁：`VoiceDef` 补上模型仓音色定义里实际有的 `createdAt` / `createdBy`；0.1.2 = 同日补丁：修叠音竞态，见下一条；0.1.3 = 同日补丁：中文 / 英语句内断句加强断点；0.1.4 = 同日补丁：破折号断点 + 公式 / 代码护栏；0.1.5 = 同日补丁：句内断句改成标点簇查表；0.1.6 = 同日补丁：喇叭收场保险 + 机器记号不念）；**之后每次 bump minor 都要先找 user 批**（patch AI 看着办）；收货脚本只认打过 tag 的已发版。发版 = 写版本号 → `bash scripts/release.sh` → commit → tag `v<版本>`。本库现在没有远端，宿主收货走本机的 release 产物。
- **开发期往宿主里装包只许用 `scripts/dev-install.sh`**（逐字节验货，拒绝往宿主的 main 上装）。
- **只出货不送货**：本库的活到 commit 交付物为止；宿主收货、跑宿主测试、宿主发版是宿主 session 的活。
- 测试两档：`npm test`（node：分句 / 控制器 / 包的纯函数 / 红线守卫）+ `npm run e2e`（构建后在无头 Chromium 里走整链：两种真引擎 + 真语音包 + 真 Cache + 真 Web Audio，约一分钟；包在检疫桶：sherpa 测试包 `~/jupyter/third-party/sherpa-onnx-wasm/tts-probe/packs-test/`，つくよみちゃん五个小包 `~/jupyter/third-party/piper-plus/packs-local/`，由 `…/piper-plus/backend/build-packs.mjs` 打）。构建 + 户口 `npm run build`（`api/` 是生成物，勿手改）。
- **这台开发机的显卡可能在跑别的长任务**：测试里的无头浏览器一律 `--disable-gpu`。
- `journal/`、`journals/` 是人类区，AI 永不写。
