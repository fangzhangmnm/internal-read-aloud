// 后端的形状：一种引擎一个后端，worker 入口只认这三个动词。created 2026-10-01 by Claude Fable 5.1
import type { SpeechLang } from "../sentences.ts";
import type { Clip } from "../read-aloud.ts";
import type { PackManifest } from "../packs.ts";

export interface BackendLoadContext {
  /** 引擎文件目录的绝对 URL（以 / 结尾）。 */
  engineBase: string;
  manifest: PackManifest;
  /** 包里的每个文件一块 buffer，顺序同 manifest.files；后端可以拿走所有权。 */
  files: Uint8Array[];
}
export interface Backend {
  load(ctx: BackendLoadContext): Promise<{ sampleRate: number; voices: number }>;
  synth(text: string, o: { lang: SpeechLang; voice: number; speed: number }): Clip | Promise<Clip>;
  unload(): void;
}
