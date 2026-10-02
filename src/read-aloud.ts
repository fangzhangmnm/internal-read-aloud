// 连读控制器：分句 → 提前合成后面几句 → 一句一句播 → 报「现在读到哪一句」。created 2026-10-01 by Claude Fable 5.1
//
// 不画任何界面（按钮、高亮、滚动归宿主）；不认识引擎长什么样（只要一个 synth）；不认识喇叭（只要一个 sink）。
// 所以整个文件零 DOM，node 里用假引擎 + 假喇叭全测。
//
// 行为：
//   · start(text, from)：从 from 落在的那一句开始。once = 只读这一句就停；否则一路读到文本结束 → 发 "end"（宿主决定翻章还是停）。
//   · 合成比播放慢的时候会等（state = "loading"）；比播放快的时候提前合成 lookahead 句，句与句之间只隔规定的停顿。
//   · 句间停顿由这里定（合成出来的一句首尾几乎没有静音，不留气口听着就是「不喘气」）：同一段里 sentenceGapMs，跨段 paragraphGapMs。
//     默认 600 / 900 毫秒：600 = piper-plus 参考实现的句间静音（user 2026-10-01 听参考实现的长段说节奏没问题）。句内逗号处的停顿归后端。
//     停顿除以语速倍数（user 2026-10-01「加速加1.5档，然后中间的空也应该等比例加」）。
//   · 任何时候 stop / 再 start / skip：旧的一轮立刻作废（代号 gen），它还没回来的合成结果回来也不播。
//   · **新点的优先，任何时刻只有一段在响**：再 start / skip / stop 先掐掉正在响的那一段，再起新的。
//   · **语言**：给了 lang = 整段文本都按这种语言念（老行为）。不给 = 每句自己判（lang-route.ts；user 2026-10-01「每句话路由不同的前端」）：
//     一句里中日混排就切成几段分别合成、再接起来；langs = 宿主装好的语言。**判出来的语言没装 = 这一句报错，不拿别的语言凑合**
//     （user 2026-10-01「主语言替代朗读（日文会念不准）不要这样，这是静默退化」）——宿主应先用 langsIn 把要的语言都装上。
import { splitSentences, sentenceAt, type SentenceSpan, type SpeechLang } from "./sentences.ts";
import { contextLang, langRuns, type LangRun } from "./lang-route.ts";

/** 一段合成好的声音。 */
export interface Clip { samples: Float32Array; sampleRate: number }
/** 控制器向引擎要的唯一一件事。 */
/** speaker = 一个模型里有几个说话人时的编号（缺省 0）。没有可念的内容（只有标点）→ 长度 0 的一段，控制器跳过这一句。 */
export interface Synthesizer { synth(text: string, opts: { lang: SpeechLang; speaker?: number; speed?: number; steadiness?: number; whole?: boolean }): Promise<Clip> }
/** 正在播的一段：done 在播完或被 stop 时兑现（true = 自然播完，false = 被停）。 */
export interface Playback { done: Promise<boolean>; stop(): void; pause(): void; resume(): void }
/** 喇叭：给一段声音，开始播。 */
export interface AudioSink { play(clip: Clip): Playback }

export type ReadAloudState = "idle" | "loading" | "playing" | "paused";
/**
 * steadiness = 实验念法，0（原样，默认）… 1（平稳：采样噪声小 + 稍慢），中间连续可调；后端支持才生效，sherpa 忽略。
 * steady: true = steadiness 1（0.1.9 的开关，留着兼容）。
 * whole = 整句合成（默认开；user 2026-10-02「加一个整句合成的选项，默认开，可以开关」）：中文 / 英语一句里同一种语言的几个小句
 *   一次交给模型，小句之间放模型自己认得的停顿记号、再补静音到该有的长度；false = 每个小句单独合成再接起来（0.1.12 及以前的做法）。
 *   日语本来就整句；后端支持才生效，sherpa 忽略。
 */
export interface ReadAloudOptions {
  /** 整段文本都按这种语言念；不给 = 每句自己判。 */
  lang?: SpeechLang;
  /** 每句自己判时可用的语言（宿主装进引擎的）；不给 = 中日英都可以。 */
  langs?: SpeechLang[];
  speaker?: number; speed?: number; steadiness?: number; steady?: boolean; whole?: boolean; once?: boolean;
}
export interface ReadAloudDeps {
  engine: Synthesizer;
  sink: AudioSink;
  /** 提前合成几句（默认 2）。合成引擎一次只算一句，排太多是白算（用户一跳就全作废）。 */
  lookahead?: number;
  /** 同一段里两句之间的停顿，毫秒（默认 600；实际停顿 = 它 ÷ 语速倍数）。 */
  sentenceGapMs?: number;
  /** 跨段（两句之间隔着换行）的停顿，毫秒（默认 900）。 */
  paragraphGapMs?: number;
  /** 等停顿用的计时器；测试注入假的。 */
  sleep?: (ms: number) => Promise<void>;
}
export interface ReadAloudEvents {
  /** 开始读这一句（宿主拿去高亮 / 滚动）。index = 第几句。 */
  sentence: (span: SentenceSpan, index: number) => void;
  state: (s: ReadAloudState) => void;
  /** 这段文本读完了（once 读完那一句不算）。 */
  end: () => void;
  /** 合成或播放出错；控制器已回到 idle。 */
  error: (e: Error) => void;
}
export interface ReadAloud {
  start(text: string, from: number, opts?: ReadAloudOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 上一句 / 下一句。正在连读 → 跳过去接着连读；停着 / 逐句 → 只读那一句。 */
  skip(delta: 1 | -1): void;
  state(): ReadAloudState;
  /** 当前（或最后读过的）那一句；没有 = null。 */
  current(): { span: SentenceSpan; index: number } | null;
  /** 这段文本分出来的所有句子（宿主算「屏幕上第一句是第几句」用）。没 start 过 = 空。 */
  sentences(): readonly SentenceSpan[];
  on<K extends keyof ReadAloudEvents>(ev: K, cb: ReadAloudEvents[K]): () => void;
}

/** 选项里的念法 → 0…1 的一个数（steady: true = 1，都没给 = 0）。 */
function steadinessOf(o: ReadAloudOptions): number {
  const v = typeof o.steadiness === "number" && Number.isFinite(o.steadiness) ? o.steadiness : o.steady ? 1 : 0;
  return Math.min(1, Math.max(0, v));
}

/** 一句里两段语言交界处的停顿（毫秒，1 倍速）：前一段以句末符号收尾 400、以逗号类收尾 250、交界处没有标点 60。 */
function runGapMs(prev: string): number {
  const t = prev.replace(/[\s"'”’」』）)】》〉〟]+$/u, "");
  return /[。！？!?…‥.]$/u.test(t) ? 400 : /[，、；：,;:—]$/u.test(t) ? 250 : 60;
}

export function createReadAloud(deps: ReadAloudDeps): ReadAloud {
  const lookahead = Math.max(0, deps.lookahead ?? 2);
  const gapS = deps.sentenceGapMs ?? 600, gapP = deps.paragraphGapMs ?? 900;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const listeners: { [K in keyof ReadAloudEvents]: Set<ReadAloudEvents[K]> } = { sentence: new Set(), state: new Set(), end: new Set(), error: new Set() };
  const emit = <K extends keyof ReadAloudEvents>(ev: K, ...args: Parameters<ReadAloudEvents[K]>) => { for (const cb of [...listeners[ev]]) (cb as (...a: unknown[]) => void)(...args); };

  let text = "", spans: SentenceSpan[] = [], ctx: SpeechLang = "en", opts: ReadAloudOptions = {};
  let index = -1, st: ReadAloudState = "idle", gen = 0, continuous = false;
  let playing: Playback | null = null;
  let clips = new Map<number, Promise<Clip>>();
  let ready = new Map<number, Clip>();   // 已经算好的（同步可查）：点到算好的句子不闪「加载中」

  /** 语速倍数：句间停顿跟着它等比例缩放（念得快，气口也短）。 */
  const pace = () => { const v = opts.speed; return typeof v === "number" && v > 0 ? v : 1; };
  const setState = (s: ReadAloudState) => { if (st !== s) { st = s; emit("state", s); } };
  function clipFor(i: number): Promise<Clip> {
    let p = clips.get(i);
    if (!p) {
      const sp = spans[i]!;
      const mine = clips, got = ready;
      p = synthSentence(text.slice(sp.start, sp.end));
      p.then((c) => { if (mine === clips && mine.get(i) === p) got.set(i, c); }, () => { if (mine.get(i) === p) mine.delete(i); });   // 失败的不留：下次再点重算
      clips.set(i, p);
    }
    return p;
  }
  /** 这一句交给哪几种语言的前端：给了 lang 就整句一种；否则每句自己判。判出来的语言不在 langs 里 = 报错（不悄悄换成别的语言念）。 */
  function routesFor(sentence: string): LangRun[] {
    if (opts.lang) return [{ lang: opts.lang, text: sentence }];
    const runs = langRuns(sentence, ctx), allowed = opts.langs?.length ? opts.langs : null;
    const missing = allowed ? runs.map((r) => r.lang).filter((l) => !allowed.includes(l)) : [];
    if (missing.length) throw new Error(`language not loaded: ${[...new Set(missing)].join(", ")} (sentence: ${sentence.slice(0, 40)})`);
    return runs;
  }
  /** 合成一句：一段直接交给引擎；几段就一段一段合成，接起来，段间按交界处的标点留停顿（÷ 语速）。 */
  async function synthSentence(sentence: string): Promise<Clip> {
    const routes = routesFor(sentence), base = { speaker: opts.speaker, speed: opts.speed, steadiness: steadinessOf(opts), whole: opts.whole !== false };
    if (routes.length === 1) return deps.engine.synth(routes[0]!.text, { ...base, lang: routes[0]!.lang });
    const parts: { clip: Clip; gapMs: number }[] = [];
    for (const r of routes) {
      const clip = await deps.engine.synth(r.text, { ...base, lang: r.lang });
      if (clip.samples.length) parts.push({ clip, gapMs: runGapMs(r.text) / pace() });
    }
    if (!parts.length) return { samples: new Float32Array(0), sampleRate: 22050 };
    const sr = parts[0]!.clip.sampleRate;
    const gap = (k: number) => (k < parts.length - 1 ? Math.round((parts[k]!.gapMs / 1000) * sr) : 0);
    const out = new Float32Array(parts.reduce((a, p, k) => a + p.clip.samples.length + gap(k), 0));
    let off = 0;
    parts.forEach((p, k) => { out.set(p.clip.samples, off); off += p.clip.samples.length + gap(k); });
    return { samples: out, sampleRate: sr };
  }
  /** 只留当前句前一句到提前量之内的；别的放掉（一句几百 KB）。 */
  function prune(i: number): void { for (const k of [...clips.keys()]) if (k < i - 1 || k > i + lookahead) { clips.delete(k); ready.delete(k); } }
  function dropClips(): void { clips = new Map(); ready = new Map(); }
  /** 两句之间有没有隔着换行（= 跨段）。 */
  const crossesParagraph = (a: number, b: number) => text.slice(spans[a]!.end, spans[b]!.start).includes("\n");

  async function run(from: number, my: number): Promise<void> {
    try {
      for (let i = from; i < spans.length; i++) {
        if (my !== gen) return;
        index = i; prune(i);
        const clipP = clipFor(i);
        if (continuous) for (let k = 1; k <= lookahead && i + k < spans.length; k++) void clipFor(i + k);
        const hit = ready.get(i);
        if (!hit) setState("loading");
        const clip = hit ?? await clipP;
        if (my !== gen) return;
        if (!clip.samples.length) {   // 这一句没有可念的（「……」「——」）：连读时悄悄跳过；点名只读它 → 当作读完
          if (!continuous) { setState("idle"); return; }
          continue;
        }
        emit("sentence", spans[i]!, i);
        setState("playing");
        const pb = deps.sink.play(clip);
        playing = pb;
        const finished = await pb.done;
        if (playing === pb) playing = null;   // 只清自己那一段：被打断时新的一轮可能已经起播（句子已合成好 = 同步起播），不许把它的记录清掉
        if (my !== gen || !finished) return;
        if (!continuous) { setState("idle"); return; }
        if (i + 1 < spans.length) { await sleep((crossesParagraph(i, i + 1) ? gapP : gapS) / pace()); if (my !== gen) return; }
      }
      if (my !== gen) return;
      setState("idle");
      emit("end");
    } catch (e) {
      if (my !== gen) return;
      playing = null; gen++; dropClips(); setState("idle");
      emit("error", e instanceof Error ? e : new Error(String(e)));
    }
  }
  function halt(): void { gen++; if (playing) { const p = playing; playing = null; p.stop(); } }

  return {
    start(t, from, o = {}) {
      halt();
      if (t !== text) { text = t; spans = splitSentences(t); dropClips(); }
      else if (o.speaker !== opts.speaker || steadinessOf(o) !== steadinessOf(opts) || (o.whole !== false) !== (opts.whole !== false) || o.speed !== opts.speed || o.lang !== opts.lang || String(o.langs ?? "") !== String(opts.langs ?? "")) dropClips();   // 换了音色 / 语速 / 语言：旧的合成结果不能用
      opts = o; ctx = contextLang(t); continuous = !o.once;
      const i = sentenceAt(spans, from);
      if (i < 0) { index = -1; setState("idle"); if (continuous) emit("end"); return; }
      void run(i, gen);
    },
    pause() { if (st === "playing" && playing) { playing.pause(); setState("paused"); } },
    resume() { if (st === "paused" && playing) { playing.resume(); setState("playing"); } },
    stop() { halt(); setState("idle"); },
    skip(delta) {
      if (!spans.length) return;
      const target = Math.min(spans.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      const keep = continuous && (st === "playing" || st === "loading");
      halt(); continuous = keep;
      void run(target, gen);
    },
    state: () => st,
    current: () => (index >= 0 && spans[index] ? { span: spans[index]!, index } : null),
    sentences: () => spans,
    on(ev, cb) { listeners[ev].add(cb); return () => { listeners[ev].delete(cb); }; },
  };
}
