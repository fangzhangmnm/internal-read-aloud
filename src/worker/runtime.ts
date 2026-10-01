// 朗读 worker 的公共运行时：语音包的下载 / 校验 / 缓存 / 取出 + 把合成请求转给后端。主线程只经 src/engine.ts 发消息。
// 每种引擎一个入口文件（sherpa-entry.ts / piper-plus-entry.ts），入口只做一件事：startWorker({ 引擎名: 后端工厂 })。
// created 2026-10-01 by Claude Fable 5.1（包的那一半移植自 WebXiaoHeiWu src/asr/worker.ts，2026-09-03 同一作者）
//
//   · 信任根 = 宿主内嵌的清单（init 时给）：分片从「模型源 URL / 用户导入的文件」来都先对 chunks[].sha256 再入缓存；对不上整包拒收。
//   · 缓存 = Cache Storage（名字由宿主给，默认家族共享的 `pwa-models`；key 是本 origin 下的合成路径 /__pwa-models__/<slug>/<chunk>，永不真的去 fetch 它）。
//   · **本库里唯一允许联网、唯一允许碰 Cache Storage 的文件**（test/redline-guard 守）。联网只有一种：GET 模型源的分片，到手先验。
//   · 包里以 `.gz` 结尾的文件是压缩存放的：装进引擎前在这里解开，后端看到的是去掉 `.gz` 的名字和解开后的字节。
import { Sha256 } from "../sha256.ts";
import { assembleFiles, logicalName, type PackManifest } from "../packs.ts";
import type { Request, Response, PackProgress, PackStatus, LoadResult, WorkerInit } from "../protocol.ts";
import type { Backend } from "./backend.ts";

const post = (m: Response, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);
const keyOf = (slug: string, name: string) => `${self.location.origin}/__pwa-models__/${slug}/${name}`;

let init: WorkerInit | null = null;
function cfg(): WorkerInit { if (!init) throw new Error("read-aloud worker not initialised"); return init; }
function manifestOf(slug: string): { packId: string; manifest: PackManifest } {
  const p = cfg().packs[slug];
  if (!p) throw new Error(`unknown pack: ${slug}`);
  return p;
}
const openCache = () => caches.open(cfg().cacheName);

// ── 缓存面 ──
async function cachedChunkSizes(slug: string, m: PackManifest): Promise<number[]> {
  const cache = await openCache();
  const sizes: number[] = [];
  for (const c of m.chunks) {
    const r = await cache.match(keyOf(slug, c.name));
    sizes.push(r ? Number(r.headers.get("content-length") ?? 0) : 0);
  }
  return sizes;
}
async function putChunk(slug: string, name: string, bytes: Uint8Array): Promise<void> {
  const cache = await openCache();
  await cache.put(keyOf(slug, name), new Response(bytes as unknown as BodyInit, { headers: { "content-length": String(bytes.length), "content-type": "application/octet-stream" } }));
}
async function markVerified(slug: string, packId: string): Promise<void> {
  const cache = await openCache();
  await cache.put(keyOf(slug, "verified.json"), new Response(JSON.stringify({ packId, at: new Date().toISOString() }), { headers: { "content-type": "application/json" } }));
}
async function status(slug: string): Promise<PackStatus> {
  const { packId, manifest: m } = manifestOf(slug);
  const cache = await openCache();
  const sizes = await cachedChunkSizes(slug, m);
  const complete = sizes.every((n, i) => n === m.chunks[i]!.bytes);
  const marker = await cache.match(keyOf(slug, "verified.json"));
  const verified = marker ? ((await marker.json()) as { packId?: string }).packId === packId : false;
  return { slug, ready: complete && verified, bytesCached: sizes.reduce((a, b) => a + b, 0), bytesTotal: m.totalBytes };
}

async function download(slug: string, base: string, progress: (p: PackProgress) => void): Promise<PackStatus> {
  const { packId, manifest: m } = manifestOf(slug);
  // 同 slug 重打包（packId 变了）→ 旧分片全部作废重下，不能只看尺寸对就免验
  const cache0 = await openCache();
  const marker = await cache0.match(keyOf(slug, "verified.json"));
  const markedId = marker ? ((await marker.json()) as { packId?: string }).packId : null;
  if (marker && markedId !== packId) { for (const c of m.chunks) await cache0.delete(keyOf(slug, c.name)); await cache0.delete(keyOf(slug, "verified.json")); }
  const sizes = await cachedChunkSizes(slug, m);
  let done = sizes.reduce((a, n, i) => a + (n === m.chunks[i]!.bytes ? n : 0), 0);
  progress({ done, total: m.totalBytes });
  const root = base.replace(/\/+$/, "");
  for (let i = 0; i < m.chunks.length; i++) {
    const c = m.chunks[i]!;
    if (sizes[i] === c.bytes) continue;
    const res = await fetch(`${root}/packs/${slug}/${c.name}`, { cache: "no-store" });
    if (!res.ok || !res.body) throw new Error(`fetch ${c.name}: HTTP ${res.status}`);
    const reader = res.body.getReader(); const sha = new Sha256(); const buf = new Uint8Array(c.bytes); let got = 0, lastReported = 0;
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) break;
      if (got + value.length > c.bytes) throw new Error(`${c.name}: larger than manifest says`);
      sha.update(value); buf.set(value, got); got += value.length;
      if (got - lastReported >= 1048576 || got === c.bytes) { lastReported = got; progress({ done: done + got, total: m.totalBytes }); }   // ≥1 MiB 报一次
    }
    if (got !== c.bytes) throw new Error(`${c.name}: got ${got} bytes, expected ${c.bytes}`);
    if (sha.hex() !== c.sha256) throw new Error(`${c.name}: sha256 mismatch (source tampered or corrupted)`);
    await putChunk(slug, c.name, buf);
    done += got;
  }
  await markVerified(slug, packId);
  return status(slug);
}

/** 用户导入：单个整文件（= 所有文件按序拼接的 .bin，size 必须等于 totalBytes）或全部 chunk-NNN 文件。 */
async function importFiles(slug: string, files: File[], progress: (p: PackProgress) => void): Promise<PackStatus> {
  const { packId, manifest: m } = manifestOf(slug);
  const byName = new Map(files.map((f) => [f.name, f] as const));
  const whole = files.length === 1 && files[0]!.size === m.totalBytes ? files[0]! : null;
  let offset = 0, done = 0;
  for (const c of m.chunks) {
    const blob = whole ? whole.slice(offset, offset + c.bytes) : byName.get(c.name);
    if (!blob) throw new Error(`missing ${c.name} (select the whole .bin or every chunk file)`);
    if (blob.size !== c.bytes) throw new Error(`${c.name}: size ${blob.size}, expected ${c.bytes}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (new Sha256().update(bytes).hex() !== c.sha256) throw new Error(`${c.name}: sha256 mismatch (wrong or corrupted file)`);
    await putChunk(slug, c.name, bytes);
    offset += c.bytes; done += c.bytes; progress({ done, total: m.totalBytes });
  }
  await markVerified(slug, packId);
  return status(slug);
}

async function deletePack(slug: string): Promise<void> {
  if (loaded?.slug === slug) unload();
  const { manifest: m } = manifestOf(slug);
  const cache = await openCache();
  for (const c of m.chunks) await cache.delete(keyOf(slug, c.name));
  await cache.delete(keyOf(slug, "verified.json"));
}

// ── 引擎 ──
let BACKENDS: Record<string, () => Backend> = {};
async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
let loaded: { slug: string; backend: Backend; info: { sampleRate: number; voices: number } } | null = null;

function unload(): void { if (loaded) { try { loaded.backend.unload(); } catch { /* ignore */ } loaded = null; } }

async function load(slug: string): Promise<LoadResult> {
  if (loaded?.slug === slug) return { slug, alreadyLoaded: true, createMs: 0, ...loaded.info };
  const st = await status(slug);
  if (!st.ready) throw new Error("pack-missing");
  unload();
  const { manifest: m } = manifestOf(slug);
  const make = BACKENDS[m.engine];
  if (!make) throw new Error(`pack ${slug}: no backend for engine "${m.engine}"`);
  const cache = await openCache();
  const chunks: Uint8Array[] = [];
  for (const c of m.chunks) {
    const r = await cache.match(keyOf(slug, c.name));
    if (!r) throw new Error("pack-missing");
    chunks.push(new Uint8Array(await r.arrayBuffer()));
  }
  const raw = assembleFiles(m, chunks);
  chunks.length = 0;
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < m.files.length; i++) {
    const path = m.files[i]!.path, name = logicalName(path);
    files.set(name, name === path ? raw[i]! : await gunzip(raw[i]!));
    raw[i] = new Uint8Array(0);   // 放手：压缩件解开后原字节不留
  }
  const backend = make();
  const t0 = performance.now();
  const info = await backend.load({ engineBase: cfg().engineBase, manifest: m, files });
  loaded = { slug, backend, info };
  return { slug, alreadyLoaded: false, createMs: Math.round(performance.now() - t0), ...info };
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
  const progress = (p: PackProgress) => post({ id: req.id, progress: p });
  chain = chain.then(async () => {
    try {
      let result: unknown = null; let transfer: Transferable[] = [];
      switch (req.op) {
        case "init": init = req.init; break;
        case "status": result = await status(req.slug); break;
        case "download": result = await download(req.slug, req.base, progress); break;
        case "import": result = await importFiles(req.slug, req.files, progress); break;
        case "delete": await deletePack(req.slug); break;
        case "load": result = await load(req.slug); break;
        case "synth": {
          if (!loaded) throw new Error("no voice pack loaded");
          const clip = await loaded.backend.synth(req.text, { lang: req.lang, voice: req.voice, speed: req.speed });
          result = clip; transfer = [clip.samples.buffer as ArrayBuffer];
          break;
        }
        case "unload": unload(); break;
      }
      post({ id: req.id, ok: true, result }, transfer);
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
