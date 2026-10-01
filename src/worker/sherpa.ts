// sherpa-onnx 后端：家族已经 vendor 的那份语音引擎（WebXiaoHeiWu `vendor/sherpa-onnx-wasm/`，自编 v1.13.7，单线程 SIMD，TTS 已编入）。
// created 2026-10-01 by Claude Fable 5.1
//
// 引擎目录里要有三个文件：sherpa-onnx-wasm-web.js（emscripten 胶水）、sherpa-onnx-wasm-web.wasm、
// sherpa-onnx-tts.js（上游 `wasm/tts/` 的 JS 包装，原样拷）。前两个和 WXHW 识别用的是同一份。
// 流程：importScripts 胶水 → 包里的文件零拷贝挂进内存盘 → 建 OfflineTts → 权重文件从内存盘删掉（已经读进引擎）→ 逐句 generate。
import type { Clip } from "../read-aloud.ts";
import { resolvePackPaths, type SherpaTtsEngineConfig } from "../packs.ts";
import type { Backend } from "./backend.ts";

// sherpa-onnx 的 emscripten 胶水 + JS 包装（importScripts 挂全局）
declare function importScripts(...urls: string[]): void;
declare const SherpaOnnx: (opts: Record<string, unknown>) => Promise<SherpaModule>;
declare const OfflineTts: new (cfg: unknown, m: SherpaModule) => SherpaTts;
interface EmFS { mkdir(p: string): void; createDataFile(parent: string, name: string, data: Uint8Array, r: boolean, w: boolean, own: boolean): void; unlink(p: string): void }
interface SherpaModule { FS: EmFS; HEAPU8: Uint8Array }
interface SherpaTts {
  handle: number; sampleRate: number; numSpeakers: number;
  generateWithConfig(text: string, cfg: Record<string, unknown>): { samples: Float32Array; sampleRate: number };
  free(): void;
}

let modulePromise: Promise<SherpaModule> | null = null;
function ensureModule(base: string): Promise<SherpaModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      importScripts(base + "sherpa-onnx-wasm-web.js", base + "sherpa-onnx-tts.js");
      return SherpaOnnx({ locateFile: (p: string) => base + p, print: (s: string) => console.log("[sherpa]", s), printErr: (s: string) => console.warn("[sherpa]", s) });
    })().catch((e) => { modulePromise = null; throw e; });
  }
  return modulePromise;
}

export function createSherpaBackend(): Backend {
  let tts: SherpaTts | null = null;
  let ec: SherpaTtsEngineConfig | null = null;
  return {
    async load({ engineBase, manifest: m, files }) {
      const Module = await ensureModule(engineBase);
      const conf = m.engineConfig as unknown as SherpaTtsEngineConfig;
      if (conf.kind !== "sherpa-offline-tts") throw new Error(`pack ${m.slug}: engineConfig.kind is "${String(conf.kind)}", expected "sherpa-offline-tts"`);
      const dir = `/packs/${m.slug}`;
      const mkdirp = (p: string) => { let cur = ""; for (const part of p.split("/").filter(Boolean)) { cur += "/" + part; try { Module.FS.mkdir(cur); } catch { /* exists */ } } };
      mkdirp(dir);
      m.files.forEach((f, i) => {
        const slash = f.path.lastIndexOf("/");
        const parent = slash < 0 ? dir : `${dir}/${f.path.slice(0, slash)}`;
        if (slash >= 0) mkdirp(parent);
        try { Module.FS.unlink(`${dir}/${f.path}`); } catch { /* 上次没删干净的同名文件 */ }
        Module.FS.createDataFile(parent, slash < 0 ? f.path : f.path.slice(slash + 1), files[i]!, true, true, true);
      });
      const created = new OfflineTts(resolvePackPaths(conf.config, dir, m.files), Module);
      for (const name of conf.unlinkAfterLoad ?? []) { try { Module.FS.unlink(`${dir}/${name}`); } catch { /* ignore */ } }
      if (!created.handle) throw new Error("voice engine creation failed (see [sherpa] console output)");
      tts = created; ec = conf;
      return { sampleRate: created.sampleRate, voices: created.numSpeakers };
    },
    synth(text, o): Clip {
      if (!tts || !ec) throw new Error("no voice pack loaded");
      const r = tts.generateWithConfig(text, {
        sid: o.voice, speed: o.speed,
        numSteps: ec.generate?.numSteps, silenceScale: ec.generate?.silenceScale ?? 0.2,
        extra: ec.passLang ? { lang: o.lang } : undefined,
      });
      if (!r.samples.length) throw new Error("voice engine returned no audio");
      return { samples: r.samples, sampleRate: r.sampleRate };
    },
    unload() { if (tts) { try { tts.free(); } catch { /* ignore */ } tts = null; ec = null; } },
  };
}
