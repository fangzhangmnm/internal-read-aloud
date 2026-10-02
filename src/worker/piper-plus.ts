// piper-plus 后端：つくよみちゃん（六语单音色 MB-iSTFT-VITS2）用的那套——onnxruntime-web 跑模型 + 每种语言一个文本前端。
// created 2026-10-01 by Claude Fable 5.1
//
// 真正的活在 `backend/piper-plus/`（纯 JS，逐字来自排查现场 `~/jupyter/third-party/piper-plus/backend/`，说明在它的 README.md）：
// 字节进、声音出，不联网、不碰任何存储；它 import 的两份第三方 JS 胶水（onnxruntime-web、OpenJTalk）vendored 在同一个目录。
// 引擎的 wasm 二进制和词典不在库里：随语音包来（运行时包 / 每种语言的前端包），到手的是哈希验过的字节。
// 这里只是把它的三个动词接到本库的 Backend 形状上。
import { createPiperPlusBackend } from "../../backend/piper-plus/index.js";
import type { Backend } from "./backend.ts";

/**
 * 本地模型（宿主换掉了 config.json）：音素表 / 语言表必须和音色原来的一模一样——前端是按原来那张表编号的，表不一样念出来就是乱码，
 * 不许静默凑合（家规：不静默退化）。只换 model.onnx 不核对：同一套记号训出来的权重才能换，这一点由用户负责。
 */
export function checkReplacedConfig(original: Uint8Array, replacement: Uint8Array): void {
  const parse = (b: Uint8Array) => { try { return JSON.parse(new TextDecoder().decode(b)); } catch { return null; } };
  const a = parse(original), b = parse(replacement);
  if (!b || typeof b !== "object") throw new Error("override-mismatch: config.json is not valid JSON");
  const same = (k: string) => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null);
  const differ = ["phoneme_id_map", "language_id_map"].filter((k) => !same(k));
  if (differ.length) throw new Error(`override-mismatch: config.json has a different ${differ.join(" and ")} than this voice`);
}

export function createPiperPlusBackendAdapter(): Backend {
  const impl = createPiperPlusBackend();
  return {
    async load({ files, replaced }) {
      const was = replaced?.get("config.json"), now = files.get("config.json");
      if (was && now) checkReplacedConfig(was, now);
      const r = await impl.load({ files });
      return { sampleRate: r.sampleRate, speakers: r.voices, langs: r.langs };
    },
    synth: (text, o) => impl.synth(text, { lang: o.lang, voice: o.speaker, speed: o.speed, steadiness: o.steadiness, whole: o.whole }),
    unload: () => impl.unload(),
  };
}
