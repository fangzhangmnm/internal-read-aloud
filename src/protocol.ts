// 主线程 ⇄ 朗读 worker 的消息协议（类型 SSoT）。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/protocol.ts）
// worker 只认「包」；「音色 = 哪几个包」是门面（src/engine.ts）的事。
import type { SpeechLang } from "./sentences.ts";
import type { EmbeddedPack } from "./packs.ts";

export interface PackStatus { slug: string; ready: boolean; bytesCached: number; bytesTotal: number }
export interface PackProgress { done: number; total: number }
/** 一个音色的状态（门面把它那几个包的状态合起来）。 */
export interface VoiceStatus {
  voice: string;
  /** 这个音色所有语言的包都齐了。 */
  ready: boolean;
  /** 现在就能念的语言（必装包齐 + 那种语言的包齐）。 */
  langs: SpeechLang[];
  bytesCached: number; bytesTotal: number;
  packs: PackStatus[];
}
export interface LoadResult {
  voice: string;
  /** 这次装进引擎的语言。 */
  langs: SpeechLang[];
  alreadyLoaded: boolean; createMs: number; sampleRate: number;
  /** 说话人个数。 */
  speakers: number;
}
/** worker 装好之后回的。 */
export interface WorkerLoadResult { alreadyLoaded: boolean; createMs: number; sampleRate: number; speakers: number; langs?: string[] }
/** worker 开工前要知道的三件事（宿主经门面给）。 */
export interface WorkerInit {
  /** 引擎文件所在目录的绝对 URL（以 / 结尾）；只有二进制由宿主 vendor 的引擎才用。 */
  engineBase: string;
  /** 语音包缓存的 Cache Storage 名（家族共享名 "pwa-models"）。 */
  cacheName: string;
  /** 宿主内嵌的清单：slug → { packId, manifest }。 */
  packs: Record<string, EmbeddedPack>;
}

export type Request =
  | { id: number; op: "init"; init: WorkerInit }
  | { id: number; op: "status"; slugs: string[] }
  | { id: number; op: "download"; slugs: string[]; base: string }
  | { id: number; op: "import"; slugs: string[]; files: File[] }
  | { id: number; op: "delete"; slugs: string[] }
  /** key = 门面给这次装载起的名字（同名再装 = 已经装着）。 */
  | { id: number; op: "load"; engine: string; key: string; slugs: string[] }
  | { id: number; op: "synth"; text: string; lang: SpeechLang; speaker: number; speed: number; steady: boolean }
  | { id: number; op: "unload" };

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: PackProgress };
