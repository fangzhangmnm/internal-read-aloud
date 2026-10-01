# @internal/read-aloud

> created 2026-10-01 by Claude Fable 5.1 · as-of 0.0.0（开发期，未发版）

PWA 家族共享的逐句朗读：文字 → 句子 → 本机合成 → 播放，并告诉宿主「现在读到哪一句」。规则见 `CLAUDE.md`，公开面见 `api/read-aloud.api.md`。

## 宿主怎么接

```ts
import { createSpeechEngine, createWebAudioSink, createReadAloud } from "@internal/read-aloud";

const engine = createSpeechEngine({
  workers: { "sherpa-onnx": { url: workerUrl } },   // 清单里的 engine 名 → worker 脚本。宿主 build 把 "@internal/read-aloud/worker-sherpa" 单独打成一个文件（esbuild --format=iife），带 hash 的路径传进来
  engineBase: "./vendor/…/",    // 只有二进制由宿主 vendor 的引擎才用（sherpa-onnx）
  packs: PACKS,                 // 宿主内嵌的语音包清单：{ [slug]: { packId, manifest } }（信任根）
});
const sink = createWebAudioSink();
const reader = createReadAloud({ engine, sink });

reader.on("sentence", (span) => highlight(span));   // span = 原文里的 [start, end)
reader.on("end", () => nextChapterOrStop());

button.onclick = async () => {
  sink.unlock();                               // 必须在用户手势里同步调（iOS）
  if (!(await engine.status(slug)).ready) await engine.download(slug, modelBase, onProgress);
  await engine.load(slug);
  reader.start(chapterText, offsetOfTappedChar, { once: true });   // 逐句：只读点到的那一句
  // reader.start(chapterText, offset)                             // 连读：一路读到这段文本结束
};
```

没开朗读 = 上面除了 import 的那几 KB 之外，什么都不会被下载或执行。

## 语音包（engineConfig 约定）

模型仓 pack 的 `task` = `"tts"`，`engine` = `"sherpa-onnx"`，`engineConfig` 形状见 `src/packs.ts` 的 `SherpaTtsEngineConfig`：`config` 原样交给 sherpa 的 `OfflineTts`，里面出现的包内文件名由库补上挂载目录；`voices` / `langs` 给宿主画设置页。包里以 `.gz` 结尾的文件是压缩存放的，worker 装进引擎前解开，后端看到的名字不带 `.gz`。
