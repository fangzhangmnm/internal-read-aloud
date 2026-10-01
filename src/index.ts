// @internal/read-aloud —— 家族共享的逐句朗读（TTS）。created 2026-10-01 by Claude Fable 5.1
//
// 三层，各自可单独用：
//   ① 分句（纯函数）            splitSentences / sentenceAt / detectLang
//   ② 连读控制器（零 DOM）       createReadAloud —— 要一个 synth 和一个喇叭，报「读到哪一句」；不画任何界面
//   ③ 引擎门面 + 喇叭（浏览器）  createSpeechEngine（worker、引擎 WASM、语音包全懒）/ createWebAudioSink
// worker 入口是另一个导出：`@internal/read-aloud/worker`（宿主单独打成一个文件，把 URL 给 createSpeechEngine）。
export { splitSentences, sentenceAt, detectLang, MAX_SPAN, type SentenceSpan, type SpeechLang } from "./sentences.ts";
export { createReadAloud, type ReadAloud, type ReadAloudDeps, type ReadAloudOptions, type ReadAloudState, type ReadAloudEvents, type Clip, type Synthesizer, type AudioSink, type Playback } from "./read-aloud.ts";
export { createSpeechEngine, type SpeechEngine, type SpeechEngineDeps } from "./engine.ts";
export { createWebAudioSink, type WebAudioSink } from "./sink.ts";
export { assembleFiles, resolvePackPaths, type PackManifest, type PackFile, type PackChunk, type EmbeddedPack, type SherpaTtsEngineConfig } from "./packs.ts";
export type { PackStatus, PackProgress, LoadResult } from "./protocol.ts";
