// 主线程 ⇄ 朗读 worker 的消息协议（类型 SSoT）。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/protocol.ts）
import type { SpeechLang } from "./sentences.ts";
import type { EmbeddedPack } from "./packs.ts";

export interface PackStatus { slug: string; ready: boolean; bytesCached: number; bytesTotal: number }
export interface PackProgress { done: number; total: number }
export interface LoadResult { slug: string; alreadyLoaded: boolean; createMs: number; sampleRate: number; voices: number }
/** worker 开工前要知道的三件事（宿主经门面给）。 */
export interface WorkerInit {
  /** 引擎文件所在目录的绝对 URL（以 / 结尾）。 */
  engineBase: string;
  /** 语音包缓存的 Cache Storage 名（家族共享名 "pwa-models"）。 */
  cacheName: string;
  /** 宿主内嵌的清单：slug → { packId, manifest }。 */
  packs: Record<string, EmbeddedPack>;
}

export type Request =
  | { id: number; op: "init"; init: WorkerInit }
  | { id: number; op: "status"; slug: string }
  | { id: number; op: "download"; slug: string; base: string }
  | { id: number; op: "import"; slug: string; files: File[] }
  | { id: number; op: "delete"; slug: string }
  | { id: number; op: "load"; slug: string }
  | { id: number; op: "synth"; text: string; lang: SpeechLang; voice: number; speed: number }
  | { id: number; op: "unload" };

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: PackProgress };
