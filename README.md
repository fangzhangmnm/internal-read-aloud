# @internal/read-aloud

> created 2026-10-01 by Claude Fable 5.1 · as-of 0.1.9（2026-10-01；0.1.0 首发同日）

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
  packs: PACKS,                 // 宿主内嵌的语音包清单：{ [slug]: { packId, manifest } }（信任根）
});
const sink = createWebAudioSink();
const reader = createReadAloud({ engine, sink });

reader.on("sentence", (span) => highlight(span));   // span = 原文里的 [start, end)
reader.on("end", () => nextChapterOrStop());

button.onclick = async () => {
  sink.unlock();                               // 必须在用户手势里同步调（iOS）
  if (!(await engine.status(voice)).langs.includes(lang)) await engine.download(voice, modelBase, { langs: [lang], onProgress });
  await engine.load(voice, { langs: [lang] });   // 只装要念的语言（日语前端固定占 160 MB 内存）
  reader.start(chapterText, offsetOfTappedChar, { lang, once: true });   // 逐句：只读点到的那一句
  // reader.start(chapterText, offset, { lang })                         // 连读：一路读到这段文本结束
};
```

没开朗读 = 上面除了 import 的那几 KB 之外，什么都不会被下载或执行。

## 音色与语音包

- **包** = 家族模型仓的一个 pack（`manifest.json` + 分片，逐片 sha256）。包里以 `.gz` 结尾的文件是压缩存放的，worker 装进引擎前解开，后端看到的名字不带 `.gz`。
- **音色** = 一份 `VoiceDef`（`src/packs.ts`；模型仓 `voices/<id>.json`）：必装的包（权重、运行时）+ 每种语言另外要的包 + 署名与条款原文。拆成小包是为了共用（运行时、某种语言的词典可以被别的音色、同源的兄弟 app 直接用）和只下用得上的语言。门面只说音色；worker 只认包。
- **署名和条款归宿主显示**：`VoiceDef.credit` / `terms` 是上游要求必须让用户看到的原文，库不翻译、不画界面。
- 用户自己拿到的文件（任何来源）走 `importFiles`：按内容哈希认领，文件名不作数。

| 引擎 | 入口 | 引擎二进制在哪 | 一个音色 |
|---|---|---|---|
| `piper-plus` | `./worker-piper-plus`（module worker） | 随语音包来（运行时包、日语前端包），哈希验过 | 权重包 + 运行时包 + 每种语言一个前端包。JS 胶水 vendored 在 `backend/piper-plus/vendor/` |
| `sherpa-onnx` | `./worker-sherpa`（classic worker） | 宿主 vendor，`engineBase` 给目录 | 一个包；引擎配置写在它的清单里（`SherpaTtsEngineConfig`：`config` 原样交给 sherpa 的 `OfflineTts`，包内文件名由库补上挂载目录） |

现有音色：つくよみちゃん（piper-plus，日 / 英 / 中；日语是训练语言，英 / 中是带日语腔的迁移）。后端的说明、每个文件的出处和许可证：`backend/piper-plus/README.md`、`backend/piper-plus/LICENSES.md`。
