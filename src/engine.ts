// 朗读引擎的主线程门面：懒建 worker，promise RPC + 进度回调。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/engine.ts）
//
// 这里一个字节都不下、一行引擎代码都不跑：worker、引擎 WASM、语音包全在第一次真用到时才动。
// 宿主不开朗读 = bundle 里只多这个门面。
import type { SpeechLang } from "./sentences.ts";
import type { Clip, Synthesizer } from "./read-aloud.ts";
import type { EmbeddedPack } from "./packs.ts";
import type { Request, Response, PackProgress, PackStatus, LoadResult, WorkerInit } from "./protocol.ts";

export interface SpeechEngineDeps {
  /** worker 脚本的 URL（宿主把本库的 ./worker 入口单独打成一个文件，build 时注入带 hash 的路径）。 */
  workerUrl: string;
  /** 引擎文件（WASM + 胶水）所在目录，相对页面或绝对都行；宿主 vendor 它。 */
  engineBase: string;
  /** 宿主内嵌的语音包清单（信任根）。 */
  packs: Record<string, EmbeddedPack>;
  /** 语音包缓存名；默认家族共享的 "pwa-models"（同源兄弟 app 下过的包直接能用）。 */
  cacheName?: string;
}
export interface SpeechEngine extends Synthesizer {
  status(slug: string): Promise<PackStatus>;
  /** 从 base（模型源，如 https://…/pwa-models）下载并逐片校验。可续传。 */
  download(slug: string, base: string, onProgress?: (p: PackProgress) => void): Promise<PackStatus>;
  /** 用户自己拿到的文件：一个整包 .bin 或全部 chunk-NNN。逐片校验后入缓存。 */
  importFiles(slug: string, files: File[], onProgress?: (p: PackProgress) => void): Promise<PackStatus>;
  delete(slug: string): Promise<void>;
  /** 把语音包装进引擎（首次几秒）。synth 之前必须先 load。 */
  load(slug: string): Promise<LoadResult>;
  /** 现在装着哪个包；没有 = null。 */
  loaded(): string | null;
  /** 最近一次 status / download / delete 的结论（同步问「有没有包」用）；没问过 = undefined。 */
  isKnownReady(slug: string): boolean | undefined;
  /** 关掉 worker，归还内存（WASM 堆只涨不缩，这是唯一的归还办法）。之后再用会重新起。 */
  dispose(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: PackProgress) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Req = DistributiveOmit<Request, "id">;

export function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine {
  let worker: Worker | null = null, seq = 0, loadedSlug: string | null = null;
  const pending = new Map<number, Pending>();
  const knownReady = new Map<string, boolean>();

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(deps.workerUrl);
    w.onmessage = (e: MessageEvent<Response>) => {
      const m = e.data; const p = pending.get(m.id); if (!p) return;
      if ("progress" in m) { p.onProgress?.(m.progress); return; }
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    w.onerror = (e) => {
      const err = new Error(`read-aloud worker crashed: ${e.message || "unknown"}`);
      for (const p of pending.values()) p.reject(err);
      pending.clear(); try { w.terminate(); } catch { /* ignore */ }
      if (worker === w) { worker = null; loadedSlug = null; }
    };
    worker = w;
    const init: WorkerInit = { engineBase: new URL(deps.engineBase.replace(/\/?$/, "/"), document.baseURI).href, cacheName: deps.cacheName ?? "pwa-models", packs: deps.packs };
    void call<void>({ op: "init", init }).catch(() => { /* 真正的调用会带出同一个错 */ });
    return w;
  }
  function call<T>(req: Req, onProgress?: (p: PackProgress) => void): Promise<T> {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      try { ensureWorker().postMessage({ ...req, id }); }
      catch (e) { pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }
  const note = (st: PackStatus): PackStatus => { knownReady.set(st.slug, st.ready); return st; };

  return {
    status: (slug) => call<PackStatus>({ op: "status", slug }).then(note),
    download: (slug, base, onProgress) => call<PackStatus>({ op: "download", slug, base }, onProgress).then(note),
    importFiles: (slug, files, onProgress) => call<PackStatus>({ op: "import", slug, files }, onProgress).then(note),
    delete: (slug) => call<void>({ op: "delete", slug }).then(() => { knownReady.set(slug, false); if (loadedSlug === slug) loadedSlug = null; }),
    load: (slug) => call<LoadResult>({ op: "load", slug }).then((r) => { loadedSlug = slug; return r; }),
    loaded: () => loadedSlug,
    isKnownReady: (slug) => knownReady.get(slug),
    synth: (text: string, o: { lang: SpeechLang; voice?: number; speed?: number }) => call<Clip>({ op: "synth", text, lang: o.lang, voice: o.voice ?? 0, speed: o.speed ?? 1 }),
    dispose() {
      const w = worker; worker = null; loadedSlug = null;
      const err = new Error("read-aloud engine disposed");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      if (w) { try { w.terminate(); } catch { /* ignore */ } }
    },
  };
}
