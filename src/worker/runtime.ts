// 朗读 worker 的公共运行时：语音包的下载 / 校验 / 缓存 / 取出 + 把合成请求转给后端。主线程只经 src/engine.ts 发消息。
// 每种引擎一个入口文件（sherpa-entry.ts / piper-plus-entry.ts），入口只做一件事：startWorker({ 引擎名: 后端工厂 })。
// 这里只认「包」：一次装载 = 几个包的文件合成一张表交给后端（音色由哪几个包组成是门面的事）。
// created 2026-10-01 by Claude Fable 5.1（包的那一半移植自 WebXiaoHeiWu src/asr/worker.ts，2026-09-03 同一作者）
//
//   · 信任根 = 宿主内嵌的清单（init 时给）：分片从「模型源 URL / 用户导入的文件」来都先对 chunks[].sha256 再入缓存；对不上整包拒收。
//   · 缓存 = Cache Storage（名字由宿主给，默认家族共享的 `pwa-models`；key 是本 origin 下的合成路径 /__pwa-models__/<slug>/<chunk>，永不真的去 fetch 它）。
//   · **本库里唯一允许联网、唯一允许碰 Cache Storage 的文件**（test/redline-guard 守）。联网只有一种：GET 模型源的分片，到手先验。
//   · 包里以 `.gz` 结尾的文件是压缩存放的：装进引擎前在这里解开，后端看到的是去掉 `.gz` 的名字和解开后的字节。
import { Sha256 } from "../sha256.ts";
import { assembleFiles, logicalName, type PackManifest } from "../packs.ts";
import type { Request, Response, PackProgress, PackStatus, WorkerLoadResult, WorkerInit } from "../protocol.ts";
import type { Backend, BackendInfo } from "./backend.ts";

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
  await dropIfStale(slug);   // 同 slug 重打包（packId 变了）→ 旧分片全部作废重下，不能只看尺寸对就免验
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

/** 缓存里这个包的每一片重新算一遍哈希（没被这次调用验过的才算）；全对 → 盖「已验」章。有一片不对就删掉那一片、不盖章。 */
async function sealIfComplete(slug: string, fresh: ReadonlySet<string>): Promise<void> {
  const { packId, manifest: m } = manifestOf(slug);
  const sizes = await cachedChunkSizes(slug, m);
  if (!sizes.every((n, i) => n === m.chunks[i]!.bytes)) return;
  const cache = await openCache();
  for (const c of m.chunks) {
    if (fresh.has(c.name)) continue;
    const r = await cache.match(keyOf(slug, c.name));
    const ok = !!r && new Sha256().update(new Uint8Array(await r.arrayBuffer())).hex() === c.sha256;
    if (!ok) { await cache.delete(keyOf(slug, c.name)); return; }
  }
  await markVerified(slug, packId);
}
/** 同 slug 重打包过（缓存里的「已验」章是别的 packId）→ 旧分片全部作废。 */
async function dropIfStale(slug: string): Promise<void> {
  const { packId, manifest: m } = manifestOf(slug);
  const cache = await openCache();
  const marker = await cache.match(keyOf(slug, "verified.json"));
  if (!marker || ((await marker.json()) as { packId?: string }).packId === packId) return;
  for (const c of m.chunks) await cache.delete(keyOf(slug, c.name));
  await cache.delete(keyOf(slug, "verified.json"));
}

/**
 * 用户导入：给一把文件，按**内容哈希**认它们是哪个包的哪一片（文件名不作数——几个包的分片都叫 chunk-000）。
 * 认得的逐片入缓存；尺寸和哪一片都对不上的文件直接略过（用户把 manifest.json、LICENSE.txt 一起选进来不算错）；
 * 尺寸对得上、哈希对不上的 = 坏文件，报错。也收「整包一个文件」（= 所有分片按序拼接，尺寸等于包的 totalBytes）。
 */
async function importFiles(slugs: string[], files: File[], progress: (p: PackProgress) => void): Promise<PackStatus[]> {
  const packs = slugs.map((slug) => ({ slug, m: manifestOf(slug).manifest }));
  for (const p of packs) await dropIfStale(p.slug);
  const fresh = new Map(packs.map((p) => [p.slug, new Set<string>()] as const));
  const total = files.reduce((a, f) => a + f.size, 0);
  let done = 0, matched = 0; const bad: string[] = [];
  for (const f of files) {
    const whole = packs.find((p) => p.m.chunks.length > 1 && p.m.totalBytes === f.size);
    if (whole) {
      let offset = 0;
      for (const c of whole.m.chunks) {
        const bytes = new Uint8Array(await f.slice(offset, offset + c.bytes).arrayBuffer());
        if (new Sha256().update(bytes).hex() !== c.sha256) throw new Error(`${f.name}: sha256 mismatch at ${c.name} (wrong or corrupted file)`);
        await putChunk(whole.slug, c.name, bytes); fresh.get(whole.slug)!.add(c.name);
        offset += c.bytes; progress({ done: done + offset, total });
      }
      matched++;
    } else {
      const sameSize = packs.flatMap((p) => p.m.chunks.filter((c) => c.bytes === f.size).map((c) => ({ slug: p.slug, c })));
      if (sameSize.length) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const hex = new Sha256().update(bytes).hex();
        const hits = sameSize.filter((x) => x.c.sha256 === hex);
        if (!hits.length) bad.push(f.name);
        for (const h of hits) { await putChunk(h.slug, h.c.name, bytes); fresh.get(h.slug)!.add(h.c.name); }
        if (hits.length) matched++;
      }
    }
    done += f.size; progress({ done, total });
  }
  for (const p of packs) await sealIfComplete(p.slug, fresh.get(p.slug)!);
  if (bad.length) throw new Error(`${bad[0]}: sha256 mismatch (wrong or corrupted file)`);
  if (!matched) throw new Error("no-matching-file");
  return Promise.all(slugs.map(status));
}

async function downloadAll(slugs: string[], base: string, progress: (p: PackProgress) => void): Promise<PackStatus[]> {
  const total = slugs.reduce((a, s) => a + manifestOf(s).manifest.totalBytes, 0);
  const have = (await Promise.all(slugs.map(status))).map((st) => st.bytesCached);   // 已经在缓存里的算在起点里
  const report = () => progress({ done: have.reduce((a, b) => a + b, 0), total });
  report();
  for (let i = 0; i < slugs.length; i++) await download(slugs[i]!, base, (p) => { have[i] = p.done; report(); });
  return Promise.all(slugs.map(status));
}

async function deletePack(slug: string): Promise<void> {
  if (loaded?.slugs.includes(slug)) await unload();
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
let loaded: { key: string; slugs: string[]; backend: Backend; info: BackendInfo } | null = null;

async function unload(): Promise<void> { if (loaded) { const l = loaded; loaded = null; try { await l.backend.unload(); } catch { /* ignore */ } } }

/** 一个包 → 它的文件（压缩存放的解开），加进 files。一次只把一个包的原始字节放在内存里。 */
async function readPack(slug: string, files: Map<string, Uint8Array>): Promise<PackManifest> {
  const { manifest: m } = manifestOf(slug);
  const cache = await openCache();
  const chunks: Uint8Array[] = [];
  for (const c of m.chunks) {
    const r = await cache.match(keyOf(slug, c.name));
    if (!r) throw new Error("pack-missing");
    chunks.push(new Uint8Array(await r.arrayBuffer()));
  }
  const raw = assembleFiles(m, chunks);
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
 * 只能替换这个音色的包里已经有的文件名；只在这次装载时用，不进缓存、不校验哈希（是用户自己手上的文件）。
 */
async function load(engine: string, key: string, slugs: string[], override: { name: string; data: Blob }[] = []): Promise<WorkerLoadResult> {
  if (loaded?.key === key) return { alreadyLoaded: true, createMs: 0, ...loaded.info };
  const make = BACKENDS[engine];
  if (!make) throw new Error(`this worker has no backend for engine "${engine}"`);
  for (const slug of slugs) if (!(await status(slug)).ready) throw new Error("pack-missing");
  await unload();
  const files = new Map<string, Uint8Array>(), manifests: PackManifest[] = [];
  for (const slug of slugs) manifests.push(await readPack(slug, files));
  const replaced = new Map<string, Uint8Array>();
  try {
    for (const o of override) {
      const was = files.get(o.name);
      if (!was) throw new Error(`override: this voice has no file "${o.name}" (only files it already has can be replaced)`);
      replaced.set(o.name, was);
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
  const progress = (p: PackProgress) => post({ id: req.id, progress: p });
  chain = chain.then(async () => {
    try {
      let result: unknown = null; let transfer: Transferable[] = [];
      switch (req.op) {
        case "init": init = req.init; break;
        case "status": result = await Promise.all(req.slugs.map(status)); break;
        case "download": result = await downloadAll(req.slugs, req.base, progress); break;
        case "import": result = await importFiles(req.slugs, req.files, progress); break;
        case "delete": for (const slug of req.slugs) await deletePack(slug); break;
        case "load": result = await load(req.engine, req.key, req.slugs, req.override); break;
        case "synth": {
          if (!loaded) throw new Error("no voice loaded");
          const clip = await loaded.backend.synth(req.text, { lang: req.lang, speaker: req.speaker, speed: req.speed, steadiness: req.steadiness, whole: req.whole });
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
