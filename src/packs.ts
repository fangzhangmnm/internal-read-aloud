// 语音包的清单形状 + 两个纯函数（分片 → 文件、给引擎配置里的文件名补上目录）。零 DOM 零网络，node 全测。
// created 2026-10-01 by Claude Fable 5.1
//
// 语音包 = 家族模型仓（`20260903 PWA Models` = GitHub fangzhangmnm/pwa-models）的一个 pack：
//   manifest.json（文件偏移表 + 逐片 sha256 + 引擎配置 + 许可证）+ chunk-NNN（所有文件按序拼接后按固定大小切片）。
// 信任根 = 宿主 app 内嵌的 manifest（packId = sha256(manifest.json 原字节)）；字节从哪来（模型源 / 镜像 / 用户导入）都先对 chunks[].sha256 再用。
import type { SpeechLang } from "./sentences.ts";

export interface PackFile { path: string; bytes: number; offset: number; sha256: string }
export interface PackChunk { name: string; bytes: number; sha256: string }
/** 模型仓 manifest.json 的形状（本库用到的部分；别的字段原样带着）。 */
export interface PackManifest {
  v: number; slug: string; name: string; task: string; lang: string[];
  /** 哪个后端来跑：现在只有 "sherpa-onnx"。 */
  engine: string;
  engineConfig: Record<string, unknown>;
  files: PackFile[]; chunkBytes: number; chunks: PackChunk[]; totalBytes: number; sha256: string;
  license: { name: string; file: string; sha256: string; attribution: string };
  source?: Record<string, unknown>; notes?: string; createdAt?: string; createdBy?: string;
}
/** 宿主内嵌进 bundle 的一个包：packId 是信任根。 */
export interface EmbeddedPack { packId: string; manifest: PackManifest }

/** 朗读包在 engineConfig 里的约定（sherpa-onnx 离线 TTS）。文件名都是包内相对名。 */
export interface SherpaTtsEngineConfig {
  kind: "sherpa-offline-tts";
  /** 直接交给 sherpa `OfflineTts` 的配置；其中出现的包内文件名由本库补上挂载目录。 */
  config: Record<string, unknown>;
  /** 每次合成附带的固定参数（如 Supertonic 的 numSteps）。 */
  generate?: { numSteps?: number; silenceScale?: number };
  /** true = 合成时把语言码传给模型（多语模型需要）。 */
  passLang?: boolean;
  /** 能念的语言。 */
  langs: SpeechLang[];
  /** 音色：id = 引擎里的说话人编号。 */
  voices: { id: number; name: string }[];
  /** 建好引擎后可以从内存盘删掉的大文件（权重已经读进引擎了）；不写 = 一个都不删。 */
  unlinkAfterLoad?: string[];
}

/**
 * 分片 → 文件。输入：清单 + 每个分片的字节（顺序同 manifest.chunks）。输出：每个文件一块独立的 buffer（顺序同 manifest.files）。
 * 分片是「所有文件按 offset 拼接」后的等长切片，所以一个分片可能横跨几个文件、一个文件也可能横跨几个分片。
 */
export function assembleFiles(m: PackManifest, chunks: readonly Uint8Array[]): Uint8Array[] {
  if (chunks.length !== m.chunks.length) throw new Error(`pack ${m.slug}: got ${chunks.length} chunks, manifest lists ${m.chunks.length}`);
  const bufs = m.files.map((f) => new Uint8Array(f.bytes));
  let offset = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const bytes = chunks[ci]!;
    if (bytes.length !== m.chunks[ci]!.bytes) throw new Error(`pack ${m.slug}: ${m.chunks[ci]!.name} is ${bytes.length} bytes, manifest says ${m.chunks[ci]!.bytes}`);
    let pos = 0;
    while (pos < bytes.length) {
      const abs = offset + pos;
      const fi = m.files.findIndex((f) => abs >= f.offset && abs < f.offset + f.bytes);
      if (fi < 0) throw new Error(`pack ${m.slug}: ${m.chunks[ci]!.name} overflows the file table`);
      const f = m.files[fi]!, n = Math.min(f.offset + f.bytes - abs, bytes.length - pos);
      bufs[fi]!.set(bytes.subarray(pos, pos + n), abs - f.offset); pos += n;
    }
    offset += bytes.length;
  }
  if (offset !== m.totalBytes) throw new Error(`pack ${m.slug}: chunks add up to ${offset} bytes, manifest says ${m.totalBytes}`);
  return bufs;
}

/**
 * 给引擎配置里的包内文件名补上挂载目录。规则：配置里任何字符串值，按逗号拆开后**每一段都是包里的文件名或目录名**，就整段补目录；别的字符串原样。
 * （所以 "cpu"、"ja" 这种不会被误伤；"a.fst,b.fst" 这种逗号表会逐项补。）返回新对象，不改入参。
 */
export function resolvePackPaths<T>(config: T, dir: string, files: readonly PackFile[]): T {
  const names = new Set<string>();
  for (const f of files) { names.add(f.path); const parts = f.path.split("/"); for (let i = 1; i < parts.length; i++) names.add(parts.slice(0, i).join("/")); }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!v) return v;
      const parts = v.split(",").map((s) => s.trim());
      return parts.every((p) => names.has(p)) ? parts.map((p) => `${dir}/${p}`).join(",") : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    return v;
  };
  return walk(config) as T;
}
