// 朗读引擎的主线程门面：懒建 worker，promise RPC + 进度回调。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/engine.ts）
//
// 这里一个字节都不下、一行引擎代码都不跑：worker、引擎二进制、语音包全在第一次真用到时才动。
// 宿主不开朗读 = bundle 里只多这个门面。
// 每种引擎一个 worker（清单里的 `engine` 名决定用哪个）：不同引擎的装法不一样（sherpa 要 classic worker，piper-plus 要 module worker），
// 宿主只打它用得上的那几个。同一时刻只有一个语音包装在引擎里；换到另一种引擎的包时，前一个 worker 直接关掉还内存。
import type { SpeechLang } from "./sentences.ts";
import type { Clip, Synthesizer } from "./read-aloud.ts";
import type { EmbeddedPack } from "./packs.ts";
import type { Request, Response, PackProgress, PackStatus, LoadResult, WorkerInit } from "./protocol.ts";

/** 一个 worker 脚本：url 由宿主 build 注入（带 hash）；type 缺省 classic。 */
export interface WorkerSpec { url: string; type?: "classic" | "module" }
export interface SpeechEngineDeps {
  /** 清单里的 engine 名 → worker 脚本（本库的 `./worker-<引擎>` 入口，宿主单独打成一个文件）。 */
  workers: Record<string, WorkerSpec>;
  /** 宿主内嵌的语音包清单（信任根）。 */
  packs: Record<string, EmbeddedPack>;
  /** 引擎文件目录（相对页面或绝对）：只有二进制由宿主 vendor 的引擎才用（sherpa-onnx）；二进制随语音包走的引擎不用给。 */
  engineBase?: string;
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
  /** 关掉所有 worker，归还内存（WASM 堆只涨不缩，这是唯一的归还办法）。之后再用会重新起。 */
  dispose(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: PackProgress) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Req = DistributiveOmit<Request, "id">;
interface Channel { worker: Worker; pending: Map<number, Pending> }

export function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine {
  const channels = new Map<string, Channel>();   // engine 名 → 活着的 worker
  let seq = 0, loadedSlug: string | null = null;
  const knownReady = new Map<string, boolean>();

  function engineOf(slug: string): string {
    const p = deps.packs[slug];
    if (!p) throw new Error(`unknown pack: ${slug}`);
    return p.manifest.engine;
  }
  function closeChannel(engine: string, why: string): void {
    const ch = channels.get(engine); if (!ch) return;
    channels.delete(engine);
    const err = new Error(why);
    for (const p of ch.pending.values()) p.reject(err);
    ch.pending.clear();
    try { ch.worker.terminate(); } catch { /* ignore */ }
    if (loadedSlug && engineOf(loadedSlug) === engine) loadedSlug = null;
  }
  function channel(engine: string): Channel {
    const have = channels.get(engine); if (have) return have;
    const spec = deps.workers[engine];
    if (!spec) throw new Error(`no worker configured for engine "${engine}"`);
    const worker = new Worker(spec.url, spec.type === "module" ? { type: "module" } : undefined);
    const ch: Channel = { worker, pending: new Map() };
    worker.onmessage = (e: MessageEvent<Response>) => {
      const m = e.data; const p = ch.pending.get(m.id); if (!p) return;
      if ("progress" in m) { p.onProgress?.(m.progress); return; }
      ch.pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => { if (channels.get(engine) === ch) closeChannel(engine, `read-aloud worker crashed: ${e.message || "unknown"}`); };
    channels.set(engine, ch);
    const init: WorkerInit = { engineBase: new URL((deps.engineBase ?? "./").replace(/\/?$/, "/"), document.baseURI).href, cacheName: deps.cacheName ?? "pwa-models", packs: deps.packs };
    void send<void>(ch, { op: "init", init }).catch(() => { /* 真正的调用会带出同一个错 */ });
    return ch;
  }
  function send<T>(ch: Channel, req: Req, onProgress?: (p: PackProgress) => void): Promise<T> {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      ch.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      try { ch.worker.postMessage({ ...req, id }); }
      catch (e) { ch.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }
  /** 按包找 worker 再发（建 worker 失败也走 reject，不同步抛）。 */
  function call<T>(slug: string, req: Req, onProgress?: (p: PackProgress) => void): Promise<T> {
    try { return send<T>(channel(engineOf(slug)), req, onProgress); }
    catch (e) { return Promise.reject(e instanceof Error ? e : new Error(String(e))); }
  }
  const note = (st: PackStatus): PackStatus => { knownReady.set(st.slug, st.ready); return st; };

  return {
    status: (slug) => call<PackStatus>(slug, { op: "status", slug }).then(note),
    download: (slug, base, onProgress) => call<PackStatus>(slug, { op: "download", slug, base }, onProgress).then(note),
    importFiles: (slug, files, onProgress) => call<PackStatus>(slug, { op: "import", slug, files }, onProgress).then(note),
    delete: (slug) => call<void>(slug, { op: "delete", slug }).then(() => { knownReady.set(slug, false); if (loadedSlug === slug) loadedSlug = null; }),
    load(slug) {
      let engine: string;
      try { engine = engineOf(slug); } catch (e) { return Promise.reject(e instanceof Error ? e : new Error(String(e))); }
      for (const other of [...channels.keys()]) if (other !== engine) closeChannel(other, "switched to a voice pack of another engine");
      return call<LoadResult>(slug, { op: "load", slug }).then((r) => { loadedSlug = slug; return r; });
    },
    loaded: () => loadedSlug,
    isKnownReady: (slug) => knownReady.get(slug),
    synth(text: string, o: { lang: SpeechLang; voice?: number; speed?: number }) {
      if (!loadedSlug) return Promise.reject(new Error("no voice pack loaded"));
      return call<Clip>(loadedSlug, { op: "synth", text, lang: o.lang, voice: o.voice ?? 0, speed: o.speed ?? 1 });
    },
    dispose() { for (const engine of [...channels.keys()]) closeChannel(engine, "read-aloud engine disposed"); loadedSlug = null; },
  };
}
