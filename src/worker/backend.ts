// 后端的形状：一种引擎一个后端，worker 入口只认这三个动词。created 2026-10-01 by Claude Fable 5.1
import type { SpeechLang } from "../sentences.ts";
import type { Clip } from "../read-aloud.ts";
import type { PackManifest } from "../packs.ts";

export interface BackendLoadContext {
  /** 引擎文件目录的绝对 URL（以 / 结尾）；二进制随语音包来的引擎不用它。 */
  engineBase: string;
  /** 这次装的每个包的清单（顺序 = 门面给的顺序，音色定义里 packs 在前、语言包在后）。 */
  manifests: PackManifest[];
  /** 这些包里的所有文件合在一起：名字（压缩存放的已解开、名字去掉 `.gz`）→ 字节。后端可以拿走所有权；load 返回后运行时会清空这张表。 */
  files: Map<string, Uint8Array>;
  /** 宿主这次换掉的文件（本地模型，见 SpeechEngine.load 的 override）：名字 → 包里原来的字节。后端据此核对换进来的文件能不能用（比如音素表）。没换 = 空表。 */
  replaced: Map<string, Uint8Array>;
}
export interface BackendInfo {
  sampleRate: number;
  /** 说话人个数。 */
  speakers: number;
  /** 实际装上的语言（后端按到手的文件判断）；不报 = 门面按音色定义算。 */
  langs?: string[];
}
export interface Backend {
  load(ctx: BackendLoadContext): Promise<BackendInfo>;
  /** 一句进、一段出。没有可念的内容（只有标点 / 不认识的符号）→ 长度 0 的一段。 */
  synth(text: string, o: { lang: SpeechLang; speaker: number; speed: number; steadiness: number; whole: boolean }): Clip | Promise<Clip>;
  unload(): void | Promise<void>;
}
