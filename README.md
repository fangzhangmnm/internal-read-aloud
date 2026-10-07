# @internal/read-aloud

> created 2026-10-01 by Claude Fable 5.1 · as-of 0.1.20（2026-10-06；0.1.0 首发 2026-10-01）

PWA 家族共享的逐句朗读：文字 → 句子 → 本机合成 → 播放，并告诉宿主「现在读到哪一句」。规则见 `CLAUDE.md`，公开面见 `api/read-aloud.api.md`。

## 宿主怎么接

```ts
import { createSpeechEngine, createWebAudioSink, createReadAloud } from "@internal/read-aloud";

const engine = createSpeechEngine({
  // 音色定义里的 engine 名 → worker 脚本。宿主 build 把用得上的入口单独打成一个文件，带 hash 的路径传进来：
  //   "@internal/read-aloud/worker-piper-plus"  → esbuild --bundle --format=esm   （module worker）
  //   "@internal/read-aloud/worker-sherpa"      → esbuild --bundle --format=iife  （classic worker；还要 engineBase）
  workers: { "piper-plus": { url: workerUrl, type: "module" } },
  voices: VOICES,               // 宿主内嵌的音色定义：{ [id]: VoiceDef }（模型仓 voices/<id>.json）
  packs: PACKS,                 // 宿主内嵌的语音包清单：{ [slug]: { packId, manifest } }（库只拿它看文件表）
});
const sink = createWebAudioSink();
const reader = createReadAloud({ engine, sink });

reader.on("sentence", (span) => highlight(span));   // span = 原文里的 [start, end)
reader.on("end", () => nextChapterOrStop());

button.onclick = async () => {
  sink.unlock();                               // 必须在用户手势里同步调（iOS）
  // 0.1.20 起库不管持久化：下载 / 校验 / 缓存 / 导入 / 删除归宿主自己的字节层（JustReadBooks src/model-packs.ts 是样板：Cache Storage pwa-models + 逐片 sha256）。
  // 宿主把这个音色、这几种语言要的包的分片（Blob[]，顺序同清单）递进来；哪几个包 = voicePacks(def, [lang])，被本地模型顶替的 = coveredPacks(...)。
  const chunks = await myPackStore.chunksFor(voice, [lang]);
  await engine.load(voice, { langs: [lang], chunks });   // 只装要念的语言（日语前端固定占 160 MB 内存）；包不齐 → "pack-missing"
  reader.start(chapterText, offsetOfTappedChar, { lang, once: true });   // 逐句：只读点到的那一句
  // reader.start(chapterText, offset, { lang })                         // 连读：一路读到这段文本结束
};
```

没开朗读 = 上面除了 import 的那几 KB 之外，什么都不会被执行。库自己从不联网、从不碰任何存储（`test/redline-guard.test.mjs` 守）。

## 音色与语音包

- **包** = 家族模型仓的一个 pack（`manifest.json` + 分片，逐片 sha256）。包里以 `.gz` 结尾的文件是压缩存放的，worker 装进引擎前解开，后端看到的名字不带 `.gz`。
- **音色** = 一份 `VoiceDef`（`src/packs.ts`；模型仓 `voices/<id>.json`）：必装的包（权重、运行时）+ 每种语言另外要的包 + 署名与条款原文。拆成小包是为了共用（运行时、某种语言的词典可以被别的音色、同源的兄弟 app 直接用）和只下用得上的语言。门面只说音色；worker 只认包。
- **署名和条款归宿主显示**：`VoiceDef.credit` / `terms` 是上游要求必须让用户看到的原文，库不翻译、不画界面。
- 字节从哪来（模型源 / 镜像 / 用户导入）、怎么验、存哪、什么时候删，全是宿主字节层的事；库只在拼文件时核每片的字节数对不对清单。

| 引擎 | 入口 | 引擎二进制在哪 | 一个音色 |
|---|---|---|---|
| `piper-plus` | `./worker-piper-plus`（module worker） | 随语音包来（运行时包、日语前端包），哈希验过 | 权重包 + 运行时包 + 每种语言一个前端包。JS 胶水 vendored 在 `backend/piper-plus/vendor/` |
| `sherpa-onnx` | `./worker-sherpa`（classic worker） | 宿主 vendor，`engineBase` 给目录 | 一个包；引擎配置写在它的清单里（`SherpaTtsEngineConfig`：`config` 原样交给 sherpa 的 `OfflineTts`，包内文件名由库补上挂载目录） |

**底层出口 `@internal/read-aloud/backend/piper-plus/*`**（0.1.22）：后端目录原样开放给不走库的合成流程、但要用同一份前端的宿主（例：唱歌——自己按乐谱拼音素、自己喂模型）。能拿到的 = 各语言前端（`ja-frontend.js` / `zh-g2p.js` / `en-g2p.js` / `encode.js` …）和 vendored 的两份胶水（`vendor/onnxruntime-web/ort.wasm.bundle.min.mjs`、`vendor/ojt/ojt.mjs`）。字节（模型、运行时 wasm、词典）照旧随语音包来，不在这里。这些文件不是库的稳定接口：库升级时宿主自己核对。

现有音色：つくよみちゃん（piper-plus，日 / 英 / 中；日语是训练语言，英 / 中是带日语腔的迁移）。后端的说明、每个文件的出处和许可证：`backend/piper-plus/README.md`、`backend/piper-plus/LICENSES.md`。
