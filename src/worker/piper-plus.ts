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
 * 本地模型（宿主换掉了 config.json）：前端按记号查编号，编号对不上念出来就是乱码，不许静默凑合（家规：不静默退化）。按编号核对：
 *   · 语言表一模一样；
 *   · 两边都有的记号编号必须相同（メラちゃん：86 个不同 → 拒）；
 *   · 音色有、换进来的没有的记号，只许是排在它整张表之后的新增记号（piper-plus 底模：月读末尾多 12 个瑞典语记号 173–184，中日英用不到 → 收）；
 *     缺了中间的就拒，免得前端发出的音被悄悄丢掉；
 *   · 换进来的多出来的记号没关系（前端不会发）。
 * user 2026-10-02「piper-plus + json也会有一样的问题」：原来要求整张表一模一样，把兼容的底模也拒了。
 * 只换 model.onnx 不核对：同一套记号训出来的权重才能换，这一点由用户负责。
 */
export function checkReplacedConfig(original: Uint8Array, replacement: Uint8Array): void {
  const parse = (b: Uint8Array) => { try { return JSON.parse(new TextDecoder().decode(b)); } catch { return null; } };
  const a = parse(original), b = parse(replacement);
  if (!b || typeof b !== "object") throw new Error("override-mismatch: config.json is not valid JSON");
  if (JSON.stringify(a?.language_id_map ?? null) !== JSON.stringify(b.language_id_map ?? null)) throw new Error("override-mismatch: config.json has a different language_id_map than this voice");
  const A: Record<string, number[]> = a?.phoneme_id_map ?? {}, B: Record<string, number[]> = b.phoneme_id_map ?? {};
  if (!Object.keys(B).length) throw new Error("override-mismatch: config.json has no phoneme_id_map");
  const conflict = Object.keys(B).filter((k) => k in A && JSON.stringify(A[k]) !== JSON.stringify(B[k]));
  if (conflict.length) throw new Error(`override-mismatch: config.json maps ${conflict.length} symbol(s) to other ids than this voice`);
  const top = Math.max(...Object.values(B).flat());
  const lost = Object.keys(A).filter((k) => !(k in B) && A[k]!.some((id) => id <= top));
  if (lost.length) throw new Error(`override-mismatch: config.json lacks ${lost.length} symbol(s) this voice uses`);
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
