// @internal/read-aloud —— 家族共享的逐句朗读（TTS）。created 2026-10-01 by Claude Fable 5.1
//
// 三层，各自可单独用：
//   ① 分句（纯函数）            splitSentences / sentenceAt / detectLang
//   ② 连读控制器（零 DOM）       createReadAloud —— 要一个 synth 和一个喇叭，报「读到哪一句」；不画任何界面
//   ③ 引擎门面 + 喇叭（浏览器）  createSpeechEngine（worker、引擎 WASM、语音包全懒）/ createWebAudioSink
// worker 入口是另外的导出，一种引擎一个：`@internal/read-aloud/worker-piper-plus`（module worker）、`@internal/read-aloud/worker-sherpa`（classic worker）
// ——宿主把用得上的单独打成文件，URL 给 createSpeechEngine。
// 「音色」= 一份 VoiceDef（由哪几个包组成）；包 = 家族模型仓的一个 pack。门面只说音色。
// 0.1.20 起库不管持久化：包的字节由宿主下载 / 校验 / 缓存，随 load 递进来（user 2026-10-02「string in, audio out. app喂」）。
export { splitSentences, sentenceAt, detectLang, MAX_SPAN, type SentenceSpan, type SpeechLang } from "./sentences.ts";
export { contextLang, langRuns, langsIn, type LangRun } from "./lang-route.ts";
export { createReadAloud, type ReadAloud, type ReadAloudDeps, type ReadAloudOptions, type ReadAloudState, type ReadAloudEvents, type Clip, type Synthesizer, type AudioSink, type Playback } from "./read-aloud.ts";
export { createSpeechEngine, type SpeechEngine, type SpeechEngineDeps, type WorkerSpec } from "./engine.ts";
export { createWebAudioSink, type WebAudioSink } from "./sink.ts";
export { assembleFiles, resolvePackPaths, logicalName, voiceLangs, voicePacks, coveredPacks, availableLangs, type VoiceDef, type PackManifest, type PackFile, type PackChunk, type EmbeddedPack, type SherpaTtsEngineConfig } from "./packs.ts";
export type { LoadResult, PackChunks } from "./protocol.ts";
