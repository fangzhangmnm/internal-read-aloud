// index.js 的类型（手写，随 index.js 一起改）。created 2026-10-01 by Claude Fable 5.1
export interface PiperPlusLoadResult { sampleRate: number; voices: number; langs: string[] }
export interface PiperPlusSynthResult { samples: Float32Array; sampleRate: number }
export interface PiperPlusBackend {
  /** files：包里的文件名 → 字节（名字表见 index.js 的 FILES）。不改这个 Map、不留引用。 */
  load(ctx: { files: Map<string, Uint8Array> }): Promise<PiperPlusLoadResult>;
  /** 一句进、一段出；没有可念的内容 → samples 长度 0。 */
  synth(text: string, o: { lang: string; voice?: number; speed?: number; steadiness?: number; steady?: boolean; whole?: boolean }): Promise<PiperPlusSynthResult>;
  unload(): Promise<void>;
}
export function createPiperPlusBackend(): PiperPlusBackend;
/** 0 -> 原样的三个参数，1 -> 平稳的三个参数，中间线性插值（0…1 之外夹住）。 */
export function blendScales(t: number): { noiseScale: number; lengthScale: number; noiseW: number };
