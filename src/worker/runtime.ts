// 朗读 worker 的公共运行时：把宿主递进来的包字节拼成文件交给后端 + 把合成请求转给后端。主线程只经 src/engine.ts 发消息。
// 每种引擎一个入口文件（sherpa-entry.ts / piper-plus-entry.ts），入口只做一件事：startWorker({ 引擎名: 后端工厂 })。
// 这里只认「包」：一次装载 = 几个包的文件合成一张表交给后端（音色由哪几个包组成是门面的事）。
// created 2026-10-01 by Claude Fable 5.1
//
// 0.1.20（2026-10-06，Claude Fable 5.1）：这里**不再**下载、校验、缓存任何东西——分片字节由宿主随 load 递进来（Blob，postMessage 按引用传，不拷贝）；
//   本 worker 零 fetch、零 Cache Storage（test/redline-guard 守整个 src/）。哈希校验、缓存、导入、删除搬去了宿主（JustReadBooks src/model-packs.ts）。
//   · 信任根仍是宿主内嵌的清单（init 时给）：这里只拿它看文件表（哪片是哪个文件、哪个压缩存放）；分片字节数对不上清单 → 拒绝（packs.ts assembleFiles）。
//   · 包里以 `.gz` 结尾的文件是压缩存放的：装进引擎前在这里解开，后端看到的是去掉 `.gz` 的名字和解开后的字节。
import { assembleFiles, logicalName, type PackManifest } from "../packs.ts";
import type { Request, Response, WorkerLoadResult, WorkerInit } from "../protocol.ts";
import type { Backend, BackendInfo } from "./backend.ts";

const post = (m: Response, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

let init: WorkerInit | null = null;
function cfg(): WorkerInit { if (!init) throw new Error("read-aloud worker not initialised"); return init; }
function manifestOf(slug: string): PackManifest {
  const p = cfg().packs[slug];
  if (!p) throw new Error(`unknown pack: ${slug}`);
  return p.manifest;
}

// ── 引擎 ──
let BACKENDS: Record<string, () => Backend> = {};
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
let loaded: { key: string; slugs: string[]; backend: Backend; info: BackendInfo } | null = null;

async function unload(): Promise<void> { if (loaded) { const l = loaded; loaded = null; try { await l.backend.unload(); } catch { /* ignore */ } } }

/** 一个包的分片 → 它的文件（压缩存放的解开），加进 files。一次只把一个包的原始字节放在内存里。 */
async function readPack(slug: string, blobs: readonly Blob[] | undefined, files: Map<string, Uint8Array>): Promise<PackManifest> {
  const m = manifestOf(slug);
  if (!blobs || blobs.length !== m.chunks.length) throw new Error("pack-missing");
  const chunks: Uint8Array[] = [];
  for (const b of blobs) chunks.push(new Uint8Array(await b.arrayBuffer()));
  const raw = assembleFiles(m, chunks);   // 分片数 / 每片字节数 / 总量对不上清单 → 这里抛
  chunks.length = 0;
  for (let i = 0; i < m.files.length; i++) {
    const path = m.files[i]!.path, name = logicalName(path);
    if (files.has(name)) throw new Error(`pack ${slug}: file "${name}" is also in another pack of this voice`);
    files.set(name, name === path ? raw[i]! : await gunzip(raw[i]!));
    raw[i] = new Uint8Array(0);   // 放手：压缩件解开后原字节不留
  }
  return m;
}

/**
 * override = 宿主给的本地文件（user 2026-10-02「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」）：
 * 只能替换这个音色的包里已经有的文件名（free 里的名字除外：那是被整个顶替、没递进来的包的文件名）；只在这次装载时用，不校验哈希（是用户自己手上的文件）。
 */
async function load(engine: string, key: string, slugs: string[], chunks: Record<string, Blob[]>, override: { name: string; data: Blob }[] = [], free: string[] = []): Promise<WorkerLoadResult> {
  if (loaded?.key === key) return { alreadyLoaded: true, createMs: 0, ...loaded.info };
  const make = BACKENDS[engine];
  if (!make) throw new Error(`this worker has no backend for engine "${engine}"`);
  for (const slug of slugs) { const m = manifestOf(slug); if (!chunks[slug] || chunks[slug]!.length !== m.chunks.length) throw new Error("pack-missing"); }
  await unload();
  const files = new Map<string, Uint8Array>(), manifests: PackManifest[] = [];
  try {
    for (const slug of slugs) manifests.push(await readPack(slug, chunks[slug], files));
  } catch (e) { files.clear(); throw e; }
  const replaced = new Map<string, Uint8Array>();
  try {
    for (const o of override) {
      const was = files.get(o.name);
      if (!was && !free.includes(o.name)) throw new Error(`override: this voice has no file "${o.name}" (only files it already has can be replaced)`);
      if (was) replaced.set(o.name, was);
      files.set(o.name, new Uint8Array(await o.data.arrayBuffer()));
    }
  } catch (e) { files.clear(); throw e; }
  const backend = make();
  const t0 = performance.now();
  let info: BackendInfo;
  try { info = await backend.load({ engineBase: cfg().engineBase, manifests, files, replaced }); }
  catch (e) { try { await backend.unload(); } catch { /* ignore */ } throw e; }
  finally { files.clear(); replaced.clear(); }
  loaded = { key, slugs: [...slugs], backend, info };
  return { alreadyLoaded: false, createMs: Math.round(performance.now() - t0), ...info };
}

// ── 消息泵（严格串行：引擎单线程，请求排队） ──
let chain: Promise<unknown> = Promise.resolve();
/** 入口调用：登记这个 worker 认得的后端（按清单里的 engine 名），开始收消息。 */
export function startWorker(backends: Record<string, () => Backend>): void {
  BACKENDS = backends;
  self.onmessage = onMessage;
}
function onMessage(e: MessageEvent<Request>): void {
  const req = e.data;
  chain = chain.then(async () => {
    try {
      let result: unknown = null; let transfer: Transferable[] = [];
      switch (req.op) {
        case "init": init = req.init; break;
        case "load": result = await load(req.engine, req.key, req.slugs, req.chunks, req.override, req.free); break;
        case "synth": {
          if (!loaded) throw new Error("no voice loaded");
          const clip = await loaded.backend.synth(req.text, { lang: req.lang, speaker: req.speaker, speed: req.speed, steadiness: req.steadiness, whole: req.whole, preset: req.preset });
          result = clip; if (clip.samples.buffer.byteLength) transfer = [clip.samples.buffer as ArrayBuffer];
          break;
        }
        case "unload": await unload(); break;
      }
      post({ id: req.id, ok: true, result }, transfer);
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
