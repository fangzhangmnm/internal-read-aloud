// 主线程 ⇄ 朗读 worker 的消息协议（类型 SSoT）。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/protocol.ts）
// worker 只认「包」；「音色 = 哪几个包」是门面（src/engine.ts）的事。
// 0.1.20（2026-10-06）起 worker 不再下载 / 缓存任何东西：包的分片字节由宿主随 load 一起递进来（user 2026-10-02「库不应该管持久化，让app管，
// 库不知道任何持久化的东西，string in, audio out. app喂」）。status / download / import / delete 四个动作连同 cacheName 一起从协议里删掉。
import type { SpeechLang } from "./sentences.ts";
import type { EmbeddedPack } from "./packs.ts";

/** 宿主递进来的包字节：包名 → 分片（顺序 = 清单 `chunks` 的顺序；每片的字节数必须和清单一致）。 */
export type PackChunks = Readonly<Record<string, readonly Blob[]>>;

export interface LoadResult {
  voice: string;
  /** 这次装进引擎的语言。 */
  langs: SpeechLang[];
  alreadyLoaded: boolean; createMs: number; sampleRate: number;
  /** 说话人个数。 */
  speakers: number;
  /** 这次换成宿主给的本地文件的文件名（没换 = 空）。 */
  override: string[];
  /** 模型认不认预设（声明了 `preset` 输入）：宿主据此决定露不露预设的输入框。 */
  preset: boolean;
}
/** worker 装好之后回的。 */
export interface WorkerLoadResult { alreadyLoaded: boolean; createMs: number; sampleRate: number; speakers: number; langs?: string[]; preset?: boolean }
/** worker 开工前要知道的两件事（宿主经门面给）。 */
export interface WorkerInit {
  /** 引擎文件所在目录的绝对 URL（以 / 结尾）；只有二进制由宿主 vendor 的引擎才用。 */
  engineBase: string;
  /** 宿主内嵌的清单：slug → { packId, manifest }。worker 只拿它看文件表（哪片是哪个文件、哪个是压缩存放的）。 */
  packs: Record<string, EmbeddedPack>;
}

export type Request =
  | { id: number; op: "init"; init: WorkerInit }
  /**
   * key = 门面给这次装载起的名字（同名再装 = 已经装着）。chunks = 这次要装的每个包的分片字节（宿主给）。
   * override = 宿主给的替换文件（本地模型），只替换包里已有的文件名；free = 被整个顶替、没递进来的包里的文件名（这些名字允许 override 新增）。
   */
  | { id: number; op: "load"; engine: string; key: string; slugs: string[]; chunks: Record<string, Blob[]>; override?: { name: string; data: Blob }[]; free?: string[] }
  | { id: number; op: "synth"; text: string; lang: SpeechLang; speaker: number; speed: number; steadiness: number; whole: boolean; preset?: number }
  | { id: number; op: "unload" };

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
