// 朗读引擎的主线程门面：懒建 worker，promise RPC。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/engine.ts）
//
// 这里一个字节都不下、一行引擎代码都不跑：worker、引擎二进制、语音包全在第一次真用到时才动。
// 宿主不开朗读 = bundle 里只多这个门面。
//
// 对宿主说的是「音色」，不是「包」：一个音色由几个包组成（权重 / 运行时 / 每种语言的词典，见 packs.ts 的 VoiceDef），
// 哪几个、装哪几种语言，都在这里算；worker 只认包。
// 每种引擎一个 worker（音色定义里的 `engine` 名决定用哪个）：不同引擎的装法不一样（sherpa 要 classic worker，piper-plus 要 module worker），
// 宿主只打它用得上的那几个。同一时刻只有一个音色装在引擎里；换到另一种引擎的音色时，前一个 worker 直接关掉还内存。
//
// 0.1.20（2026-10-06，Claude Fable 5.1）：**库不管持久化**——下载 / 校验 / 缓存 / 导入 / 删除语音包全归宿主
// （user 2026-10-02「库不应该管持久化，让app管，库不知道任何持久化的东西，string in, audio out. app喂」）。
// 宿主把每个包的分片字节随 `load` 递进来（`chunks`），门面只算「这些包够装哪几种语言」；status / download / importFiles / delete / isKnownReady 删掉。
// 本库 `src/` 里从此没有 fetch、没有 Cache Storage（test/redline-guard 守）。
import type { SpeechLang } from "./sentences.ts";
import type { Clip, Synthesizer } from "./read-aloud.ts";
import { availableLangs, coveredPacks, logicalName, voiceLangs, voicePacks, type EmbeddedPack, type VoiceDef } from "./packs.ts";
import type { Request, Response, LoadResult, PackChunks, WorkerLoadResult, WorkerInit } from "./protocol.ts";

/** 一个 worker 脚本：url 由宿主 build 注入（带 hash）；type 缺省 classic。 */
export interface WorkerSpec { url: string; type?: "classic" | "module" }
export interface SpeechEngineDeps {
  /** 音色定义里的 engine 名 → worker 脚本（本库的 `./worker-<引擎>` 入口，宿主单独打成一个文件）。 */
  workers: Record<string, WorkerSpec>;
  /** 宿主内嵌的音色定义：id → 定义。 */
  voices: Record<string, VoiceDef>;
  /** 宿主内嵌的语音包清单：音色定义点名的每个包都要在。库拿它看文件表（哪片是哪个文件、哪个压缩存放）；字节对不对清单是宿主的事。 */
  packs: Record<string, EmbeddedPack>;
  /** 引擎文件目录（相对页面或绝对）：只有二进制由宿主 vendor 的引擎才用（sherpa-onnx）；二进制随语音包走的引擎不用给。 */
  engineBase?: string;
}
export interface SpeechEngine extends Synthesizer {
  /**
   * 把音色装进引擎（首次几秒）。synth 之前必须先 load。
   * chunks = 宿主递进来的包字节：包名 → 分片 Blob（顺序同清单，每片字节数必须和清单一致；库不校验哈希——字节从哪来、验没验过是宿主的事）。
   *   没递的包 = 没有：必装的包不齐、或点名的语言一种都装不了 → 拒绝，错误信息 "pack-missing"；点名的语言里缺包的那几种不装、不报错（宿主自己先问清楚）。
   * langs = 只装这几种语言（省内存：日语前端固定占 160 MB）；不给 = 递进来的包够装的全部语言。
   * override = 本地模型（user 2026-10-02「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」）：音色包里的文件名
   *   → 用户自己的文件，这次装载用它代替包里那份（piper-plus：`model.onnx`、`config.json`）。只能换这个音色的包里有的文件名；文件全被换掉的包
   *   不用递进来、不装（递了的照装，好拿原配置来核对）；不校验哈希、不跨装载留着——下一次 load 不带 override 就换回包里的。换进来的配置和音色的音素表对不上
   *   → 拒绝，错误信息以 "override-mismatch" 开头（包没递、没有原配置可比时不比）。
   */
  load(voice: string, opts: { chunks: PackChunks; langs?: readonly SpeechLang[]; override?: Readonly<Record<string, Blob>> }): Promise<LoadResult>;
  /** 现在装着哪个音色、哪几种语言、换了哪些本地文件；没有 = null。 */
  loaded(): { voice: string; langs: SpeechLang[]; override: string[]; preset: boolean } | null;
  /** 关掉所有 worker，归还内存（WASM 堆只涨不缩，这是唯一的归还办法）。之后再用会重新起。 */
  dispose(): void;
  /** 扔掉排着还没开始算的合成请求（以 "cancelled" 拒绝）；正在算的那一个算完为止。 */
  cancelPending(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Req = DistributiveOmit<Request, "id">;
interface Channel { worker: Worker; pending: Map<number, Pending> }
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

export function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine {
  const channels = new Map<string, Channel>();   // engine 名 → 活着的 worker
  let seq = 0;
  let current: { voice: string; langs: SpeechLang[]; override: string[]; preset: boolean } | null = null;
  // 合成请求在这里排队、一次只给 worker 一个（worker 本来就一个一个算）：这样没开始的能扔掉（cancelPending）
  const synthQueue: { make: () => Promise<Clip>; resolve: (c: Clip) => void; reject: (e: Error) => void }[] = [];
  let synthBusy = false;
  function pumpSynth(): void {
    if (synthBusy) return;
    const job = synthQueue.shift(); if (!job) return;
    synthBusy = true;
    let p: Promise<Clip>;
    try { p = job.make(); } catch (e) { p = Promise.reject(asError(e)); }
    p.then(job.resolve, job.reject).finally(() => { synthBusy = false; pumpSynth(); });
  }
  const cancelPending = () => { for (const j of synthQueue.splice(0)) j.reject(new Error("cancelled")); };

  function voiceOf(id: string): VoiceDef {
    const v = deps.voices[id];
    if (!v) throw new Error(`unknown voice: ${id}`);
    for (const slug of voicePacks(v)) if (!deps.packs[slug]) throw new Error(`voice ${id}: pack "${slug}" is not embedded`);
    return v;
  }
  function closeChannel(engine: string, why: string): void {
    const ch = channels.get(engine); if (!ch) return;
    channels.delete(engine);
    const err = new Error(why);
    for (const p of ch.pending.values()) p.reject(err);
    ch.pending.clear();
    try { ch.worker.terminate(); } catch { /* ignore */ }
    if (current && deps.voices[current.voice]?.engine === engine) current = null;
  }
  function channel(engine: string): Channel {
    const have = channels.get(engine); if (have) return have;
    const spec = deps.workers[engine];
    if (!spec) throw new Error(`no worker configured for engine "${engine}"`);
    const worker = new Worker(spec.url, spec.type === "module" ? { type: "module" } : undefined);
    const ch: Channel = { worker, pending: new Map() };
    worker.onmessage = (e: MessageEvent<Response>) => {
      const m = e.data; const p = ch.pending.get(m.id); if (!p) return;
      ch.pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    };
    worker.onerror = (e) => { if (channels.get(engine) === ch) closeChannel(engine, `read-aloud worker crashed: ${e.message || "unknown"}`); };
    channels.set(engine, ch);
    const init: WorkerInit = { engineBase: new URL((deps.engineBase ?? "./").replace(/\/?$/, "/"), document.baseURI).href, packs: deps.packs };
    void send<void>(ch, { op: "init", init }).catch(() => { /* 真正的调用会带出同一个错 */ });
    return ch;
  }
  function send<T>(ch: Channel, req: Req): Promise<T> {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      ch.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try { ch.worker.postMessage({ ...req, id }); }
      catch (e) { ch.pending.delete(id); reject(asError(e)); }
    });
  }
  /** 按音色找 worker 再发（音色不认识、建 worker 失败都走 reject，不同步抛）。 */
  function call<T>(make: (v: VoiceDef) => Req, voice: string): Promise<T> {
    try { const v = voiceOf(voice); return send<T>(channel(v.engine), make(v)); }
    catch (e) { return Promise.reject(asError(e)); }
  }

  return {
    async load(voice, opts) {
      const v = voiceOf(voice);
      const names = Object.keys(opts.override ?? {});
      const covered = coveredPacks(v, deps.packs, names);
      // 递进来 = 分片数和清单一致（每片的字节数到 worker 里拼文件时再核）；被本地文件整个顶替的包不递也算有
      const given = (slug: string) => { const c = opts.chunks[slug]; return !!c && c.length === deps.packs[slug]!.manifest.chunks.length; };
      const has = (slug: string) => given(slug) || covered.has(slug);
      const wanted = opts.langs ?? voiceLangs(v);
      const langs = availableLangs(v, has).filter((l) => wanted.includes(l));
      if (!langs.length) throw new Error("pack-missing");
      for (const other of [...channels.keys()]) if (other !== v.engine) closeChannel(other, "switched to a voice of another engine");
      // 递了的包都装（顶替过的也装，好拿原配置核对）；只有「被顶替 + 没递」的包跳过，它的文件名允许 override 新增
      const all = voicePacks(v, langs);
      const slugs = all.filter(given);
      const free = all.filter((s) => !given(s)).flatMap((s) => deps.packs[s]!.manifest.files.map((f) => logicalName(f.path)));
      const chunks: Record<string, Blob[]> = {};
      for (const s of slugs) chunks[s] = [...opts.chunks[s]!];
      const ov = Object.entries(opts.override ?? {}).sort(([x], [y]) => (x < y ? -1 : 1));
      const tag = ov.map(([n, b]) => { const f = b as Partial<File>; return `${n}=${f.name ?? ""}:${b.size}:${f.lastModified ?? ""}`; }).join(";");   // a different file -> a different load
      const override = ov.map(([name, data]) => ({ name, data }));
      let r: WorkerLoadResult;
      try { r = await send<WorkerLoadResult>(channel(v.engine), { op: "load", engine: v.engine, key: `${voice}|${slugs.join(",")}|${tag}`, slugs, chunks, ...(override.length ? { override, free } : {}) }); }
      catch (e) { current = null; throw e; }   // the worker dropped the previous load before trying this one
      const got = r.langs ? langs.filter((l) => r.langs!.includes(l)) : langs;
      current = { voice, langs: got, override: override.map((o) => o.name), preset: r.preset === true };
      return { voice, langs: got, alreadyLoaded: r.alreadyLoaded, createMs: r.createMs, sampleRate: r.sampleRate, speakers: r.speakers, override: [...current.override], preset: current.preset };
    },
    loaded: () => (current ? { voice: current.voice, langs: [...current.langs], override: [...current.override], preset: current.preset } : null),
    synth(text: string, o: { lang: SpeechLang; speaker?: number; speed?: number; steadiness?: number; whole?: boolean; preset?: number }) {
      if (!current) return Promise.reject(new Error("no voice loaded"));
      return new Promise<Clip>((resolve, reject) => { synthQueue.push({ make: () => {
      if (!current) return Promise.reject(new Error("no voice loaded"));
      return call<Clip>(() => ({ op: "synth", text, lang: o.lang, speaker: o.speaker ?? 0, speed: o.speed ?? 1, steadiness: Math.min(1, Math.max(0, Number.isFinite(o.steadiness) ? o.steadiness! : 0)), whole: o.whole !== false, preset: Number.isFinite(o.preset) ? Math.trunc(o.preset!) : undefined }), current.voice);
      }, resolve, reject }); pumpSynth(); });
    },
    cancelPending,
    dispose() { cancelPending(); for (const engine of [...channels.keys()]) closeChannel(engine, "read-aloud engine disposed"); current = null; },
  };
}
