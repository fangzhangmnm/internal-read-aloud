// 朗读引擎的主线程门面：懒建 worker，promise RPC + 进度回调。created 2026-10-01 by Claude Fable 5.1（形状抄 WebXiaoHeiWu src/asr/engine.ts）
//
// 这里一个字节都不下、一行引擎代码都不跑：worker、引擎二进制、语音包全在第一次真用到时才动。
// 宿主不开朗读 = bundle 里只多这个门面。
//
// 对宿主说的是「音色」，不是「包」：一个音色由几个包组成（权重 / 运行时 / 每种语言的词典，见 packs.ts 的 VoiceDef），
// 哪几个、下没下齐、装哪几种语言，都在这里算；worker 只认包。
// 每种引擎一个 worker（音色定义里的 `engine` 名决定用哪个）：不同引擎的装法不一样（sherpa 要 classic worker，piper-plus 要 module worker），
// 宿主只打它用得上的那几个。同一时刻只有一个音色装在引擎里；换到另一种引擎的音色时，前一个 worker 直接关掉还内存。
import type { SpeechLang } from "./sentences.ts";
import type { Clip, Synthesizer } from "./read-aloud.ts";
import { logicalName, voiceLangs, voicePacks, type EmbeddedPack, type VoiceDef } from "./packs.ts";
import type { Request, Response, PackProgress, PackStatus, VoiceStatus, LoadResult, WorkerLoadResult, WorkerInit } from "./protocol.ts";

/** 一个 worker 脚本：url 由宿主 build 注入（带 hash）；type 缺省 classic。 */
export interface WorkerSpec { url: string; type?: "classic" | "module" }
export interface SpeechEngineDeps {
  /** 音色定义里的 engine 名 → worker 脚本（本库的 `./worker-<引擎>` 入口，宿主单独打成一个文件）。 */
  workers: Record<string, WorkerSpec>;
  /** 宿主内嵌的音色定义：id → 定义。 */
  voices: Record<string, VoiceDef>;
  /** 宿主内嵌的语音包清单（信任根）：音色定义点名的每个包都要在。 */
  packs: Record<string, EmbeddedPack>;
  /** 引擎文件目录（相对页面或绝对）：只有二进制由宿主 vendor 的引擎才用（sherpa-onnx）；二进制随语音包走的引擎不用给。 */
  engineBase?: string;
  /** 语音包缓存名；默认家族共享的 "pwa-models"（同源兄弟 app 下过的包直接能用）。 */
  cacheName?: string;
}
export interface SpeechEngine extends Synthesizer {
  /**
   * override = 本地模型会换掉的文件名（同 load 的 override 的键）：文件全被换掉的包算「有了」——比如 `.onnx` + `.json` 换掉了整个权重包，
   * 没下官方权重也能念（user 2026-10-02「没有下载官方模型的时候，本地模型加载了还是没法启用语音」）。
   */
  status(voice: string, opts?: { override?: readonly string[] }): Promise<VoiceStatus>;
  /**
   * 从 base（模型源，如 https://…/pwa-models）下载并逐片校验。可续传；已经有的包（别的音色、同源的兄弟 app 下过的）不重下。
   * langs = 只下这几种语言要的包；不给 = 这个音色的全部语言。进度按「这次要的所有包」的总字节报。
   */
  download(voice: string, base: string, opts?: { langs?: readonly SpeechLang[]; override?: readonly string[]; onProgress?: (p: PackProgress) => void }): Promise<VoiceStatus>;
  /** 用户自己拿到的文件（任意个包的分片，或整包一个文件）：按内容哈希认领，验过才入缓存。文件名不作数。 */
  importFiles(voice: string, files: File[], onProgress?: (p: PackProgress) => void): Promise<VoiceStatus>;
  /** 删掉这个音色的包；宿主内嵌的别的音色里、已经装着的那些还要用的包留着（运行时、共用的词典）。同源兄弟 app 是否在用看不见：它那边会显示「未下载」，重下即可。 */
  delete(voice: string): Promise<void>;
  /**
   * 把音色装进引擎（首次几秒）。synth 之前必须先 load。
   * langs = 只装这几种语言（省内存：日语前端固定占 160 MB）；不给 = 已经下好的全部语言。必装的包不齐、或点名的语言一种都没下 → 拒绝，错误信息 "pack-missing"。
   * override = 本地模型（user 2026-10-02「加一个本地上传的模型，这样我们改权重可以拖到网页上测试，而不用动远端」）：音色包里的文件名
   *   → 用户自己的文件，这次装载用它代替包里那份（piper-plus：`model.onnx`、`config.json`）。只能换这个音色的包里有的文件名；文件全被换掉、
   *   又没下载的包不用下载、不装（0.1.18；下载了的照装，好拿原配置来核对）；不进缓存、不校验哈希、不跨装载留着——下一次 load 不带 override 就换回包里的。换进来的配置和音色的音素表对不上
   *   → 拒绝，错误信息以 "override-mismatch" 开头（包没下、没有原配置可比时不比）。
   */
  load(voice: string, opts?: { langs?: readonly SpeechLang[]; override?: Readonly<Record<string, Blob>> }): Promise<LoadResult>;
  /** 现在装着哪个音色、哪几种语言、换了哪些本地文件；没有 = null。 */
  loaded(): { voice: string; langs: SpeechLang[]; override: string[]; preset: boolean } | null;
  /** 最近一次 status / download / import / delete 的结论（同步问「能不能念」用）：给 lang = 那种语言能不能念；不给 = 有没有任何一种能念。没问过 = undefined。 */
  isKnownReady(voice: string, lang?: SpeechLang): boolean | undefined;
  /** 关掉所有 worker，归还内存（WASM 堆只涨不缩，这是唯一的归还办法）。之后再用会重新起。 */
  dispose(): void;
  /** 扔掉排着还没开始算的合成请求（以 "cancelled" 拒绝）；正在算的那一个算完为止。 */
  cancelPending(): void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: PackProgress) => void };
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
  const known = new Map<string, VoiceStatus>();

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
      catch (e) { ch.pending.delete(id); reject(asError(e)); }
    });
  }
  /** 按音色找 worker 再发（音色不认识、建 worker 失败都走 reject，不同步抛）。 */
  function call<T>(make: (v: VoiceDef) => Req, voice: string, onProgress?: (p: PackProgress) => void): Promise<T> {
    try { const v = voiceOf(voice); return send<T>(channel(v.engine), make(v), onProgress); }
    catch (e) { return Promise.reject(asError(e)); }
  }
  /** 这个音色的包里，文件全被本地文件顶替的那些（不用下载、不用装）。 */
  function covered(v: VoiceDef, names: readonly string[] | undefined): Set<string> {
    const set = new Set(names ?? []), out = new Set<string>();
    if (!set.size) return out;
    for (const slug of voicePacks(v)) { const files = deps.packs[slug]?.manifest.files ?? []; if (files.length && files.every((f) => set.has(logicalName(f.path)))) out.add(slug); }
    return out;
  }
  /** 几个包的状态 → 这个音色的状态（被本地文件全部顶替的包算有）。 */
  function summarize(v: VoiceDef, packs: PackStatus[], skip: Set<string> = new Set()): VoiceStatus {
    const ready = (slugs: readonly string[]) => slugs.every((s) => skip.has(s) || packs.find((p) => p.slug === s)?.ready === true);
    const st: VoiceStatus = {
      voice: v.id,
      ready: packs.every((p) => p.ready || skip.has(p.slug)),
      langs: ready(v.packs) ? voiceLangs(v).filter((l) => ready(v.langPacks[l] ?? [])) : [],
      bytesCached: packs.reduce((a, p) => a + p.bytesCached, 0),
      bytesTotal: packs.reduce((a, p) => a + p.bytesTotal, 0),
      packs,
    };
    known.set(v.id, st);
    return st;
  }
  const status = (voice: string, opts?: { override?: readonly string[] }) => call<PackStatus[]>((v) => ({ op: "status", slugs: voicePacks(v) }), voice)
    .then((packs) => summarize(deps.voices[voice]!, packs, covered(deps.voices[voice]!, opts?.override)));

  return {
    status,
    download: (voice, base, opts) => call<PackStatus[]>((v) => { const skip = covered(v, opts?.override); return { op: "download", slugs: voicePacks(v, opts?.langs).filter((s) => !skip.has(s)), base }; }, voice, opts?.onProgress)
      .then(() => status(voice, { override: opts?.override })),
    importFiles: (voice, files, onProgress) => call<PackStatus[]>((v) => ({ op: "import", slugs: voicePacks(v), files }), voice, onProgress)
      .then(() => status(voice), (e) => status(voice).then(() => { throw e; }, () => { throw e; })),   // 部分认领成功也要把账记对
    async delete(voice) {
      const v = voiceOf(voice);
      const ch = channel(v.engine);
      // 别的音色里「装着的」（必装包都在）还要用的包留着；没装的音色不占着共用包不放。
      const others = Object.values(deps.voices).filter((o) => o.id !== v.id);
      const all = [...new Set(others.flatMap((o) => voicePacks(o)))].filter((s) => deps.packs[s]);
      const st = all.length ? await send<PackStatus[]>(ch, { op: "status", slugs: all }) : [];
      const ready = (s: string) => st.find((p) => p.slug === s)?.ready === true;
      const keep = new Set<string>();
      for (const o of others) {
        if (!o.packs.every(ready)) continue;
        for (const s of o.packs) keep.add(s);
        for (const l of voiceLangs(o)) { const lp = o.langPacks[l] ?? []; if (lp.every(ready)) for (const s of lp) keep.add(s); }
      }
      await send<void>(ch, { op: "delete", slugs: voicePacks(v).filter((s) => !keep.has(s)) });
      if (current?.voice === voice) current = null;
      await status(voice);
    },
    async load(voice, opts) {
      const v = voiceOf(voice);
      const names = Object.keys(opts?.override ?? {});
      const st = await status(voice, { override: names });
      // skip only a covered pack that is NOT downloaded: a downloaded one is still loaded, so the replaced config can be checked against it
      const skip = new Set([...covered(v, names)].filter((s) => !st.packs.find((p) => p.slug === s)?.ready));
      const langs = (opts?.langs ?? voiceLangs(v)).filter((l) => st.langs.includes(l));
      if (!langs.length) throw new Error("pack-missing");
      for (const other of [...channels.keys()]) if (other !== v.engine) closeChannel(other, "switched to a voice of another engine");
      const slugs = voicePacks(v, langs).filter((s) => !skip.has(s));
      const free = [...skip].flatMap((s) => deps.packs[s]!.manifest.files.map((f) => logicalName(f.path)));   // files of skipped packs: added, not replaced
      const ov = Object.entries(opts?.override ?? {}).sort(([x], [y]) => (x < y ? -1 : 1));
      const tag = ov.map(([n, b]) => { const f = b as Partial<File>; return `${n}=${f.name ?? ""}:${b.size}:${f.lastModified ?? ""}`; }).join(";");   // a different file -> a different load
      const override = ov.map(([name, data]) => ({ name, data }));
      let r: WorkerLoadResult;
      try { r = await send<WorkerLoadResult>(channel(v.engine), { op: "load", engine: v.engine, key: `${voice}|${slugs.join(",")}|${tag}`, slugs, ...(override.length ? { override, free } : {}) }); }
      catch (e) { current = null; throw e; }   // the worker dropped the previous load before trying this one
      const got = r.langs ? langs.filter((l) => r.langs!.includes(l)) : langs;
      current = { voice, langs: got, override: override.map((o) => o.name), preset: r.preset === true };
      return { voice, langs: got, alreadyLoaded: r.alreadyLoaded, createMs: r.createMs, sampleRate: r.sampleRate, speakers: r.speakers, override: [...current.override], preset: current.preset };
    },
    loaded: () => (current ? { voice: current.voice, langs: [...current.langs], override: [...current.override], preset: current.preset } : null),
    isKnownReady(voice, lang) { const st = known.get(voice); return st ? (lang ? st.langs.includes(lang) : st.langs.length > 0) : undefined; },
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
