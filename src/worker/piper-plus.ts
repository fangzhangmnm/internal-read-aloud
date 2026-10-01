// piper-plus 后端：つくよみちゃん（六语单音色 MB-iSTFT-VITS2）用的那套——onnxruntime-web 跑模型 + 每种语言一个文本前端。
// created 2026-10-01 by Claude Fable 5.1
//
// 真正的活在 `backend/piper-plus/`（纯 JS，逐字来自排查现场 `~/jupyter/third-party/piper-plus/backend/`，说明在它的 README.md）：
// 字节进、声音出，不联网、不碰任何存储；它 import 的两份第三方 JS 胶水（onnxruntime-web、OpenJTalk）vendored 在同一个目录。
// 引擎的 wasm 二进制和词典不在库里：随语音包来（运行时包 / 每种语言的前端包），到手的是哈希验过的字节。
// 这里只是把它的三个动词接到本库的 Backend 形状上。
import { createPiperPlusBackend } from "../../backend/piper-plus/index.js";
import type { Backend } from "./backend.ts";

export function createPiperPlusBackendAdapter(): Backend {
  const impl = createPiperPlusBackend();
  return {
    async load({ files }) {
      const r = await impl.load({ files });
      return { sampleRate: r.sampleRate, speakers: r.voices, langs: r.langs };
    },
    synth: (text, o) => impl.synth(text, { lang: o.lang, voice: o.speaker, speed: o.speed, steady: o.steady }),
    unload: () => impl.unload(),
  };
}
