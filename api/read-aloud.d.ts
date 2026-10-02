/**
 * 分片 → 文件。输入：清单 + 每个分片的字节（顺序同 manifest.chunks）。输出：每个文件一块独立的 buffer（顺序同 manifest.files）。
 * 分片是「所有文件按 offset 拼接」后的等长切片，所以一个分片可能横跨几个文件、一个文件也可能横跨几个分片。
 */
export declare function assembleFiles(m: PackManifest, chunks: readonly Uint8Array[]): Uint8Array[];

/** 喇叭：给一段声音，开始播。 */
export declare interface AudioSink {
    play(clip: Clip): Playback;
}

/** 一段合成好的声音。 */
export declare interface Clip {
    samples: Float32Array;
    sampleRate: number;
}

/** 一段正文的主语言（只看前 20000 个码元）。 */
export declare function contextLang(text: string): SpeechLang;

export declare function createReadAloud(deps: ReadAloudDeps): ReadAloud;

export declare function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine;

export declare function createWebAudioSink(): WebAudioSink;

/** （老接口：整段一种语言、有一个假名就算日语。新代码用 lang-route.ts 的 contextLang / langRuns / langsIn。）
 *  这段文字用哪种语言念：有假名 = 日语；有汉字没假名 = 中文；都没有 = 英语。只看前 4000 个码元（整本书不用全扫）。 */
export declare function detectLang(text: string): SpeechLang;

/** 宿主内嵌进 bundle 的一个包：packId 是信任根。 */
export declare interface EmbeddedPack {
    packId: string;
    manifest: PackManifest;
}

/** 一句话里的一段：交给哪种语言的前端念。 */
export declare interface LangRun {
    lang: SpeechLang;
    text: string;
}

/** 一句话 → 按语言切成几段（多数句子只有一段）。各段文字拼起来 = 原句。ctx = 这段正文的主语言（contextLang）。 */
export declare function langRuns(sentence: string, ctx: SpeechLang): LangRun[];

/** 念这段正文要装哪几种语言（顺序 ja / zh / en）。 */
export declare function langsIn(text: string): SpeechLang[];

export declare interface LoadResult {
    voice: string;
    /** 这次装进引擎的语言。 */
    langs: SpeechLang[];
    alreadyLoaded: boolean;
    createMs: number;
    sampleRate: number;
    /** 说话人个数。 */
    speakers: number;
    /** 这次换成宿主给的本地文件的文件名（没换 = 空）。 */
    override: string[];
    /** 模型认不认预设（声明了 `preset` 输入）：宿主据此决定露不露预设的输入框。 */
    preset: boolean;
}

/**
 * 包里压缩存放的文件以 `.gz` 结尾；后端看到的名字去掉这个后缀（worker 运行时负责解开）。
 */
export declare function logicalName(path: string): string;

/** 一句最多这么多码元；超过就找逗号断（合成引擎对超长输入又慢又容易念崩）。 */
export declare const MAX_SPAN = 160;

export declare interface PackChunk {
    name: string;
    bytes: number;
    sha256: string;
}

export declare interface PackFile {
    path: string;
    bytes: number;
    offset: number;
    sha256: string;
}

/** 模型仓 manifest.json 的形状（本库用到的部分；别的字段原样带着）。 */
export declare interface PackManifest {
    v: number;
    slug: string;
    name: string;
    task: string;
    lang: string[];
    /** 这个包是给哪个引擎用的（说明用；真正决定用哪个 worker 的是音色定义里的 engine）。 */
    engine: string;
    engineConfig: Record<string, unknown>;
    files: PackFile[];
    chunkBytes: number;
    chunks: PackChunk[];
    totalBytes: number;
    sha256: string;
    license: {
        name: string;
        file: string;
        sha256: string;
        attribution: string;
    };
    source?: Record<string, unknown>;
    notes?: string;
    createdAt?: string;
    createdBy?: string;
}

export declare interface PackProgress {
    done: number;
    total: number;
}

export declare interface PackStatus {
    slug: string;
    ready: boolean;
    bytesCached: number;
    bytesTotal: number;
}

/** 正在播的一段：done 在播完或被 stop 时兑现（true = 自然播完，false = 被停）。 */
export declare interface Playback {
    done: Promise<boolean>;
    stop(): void;
    pause(): void;
    resume(): void;
}

export declare interface ReadAloud {
    start(text: string, from: number, opts?: ReadAloudOptions): void;
    pause(): void;
    resume(): void;
    stop(): void;
    /** 上一句 / 下一句。正在连读 → 跳过去接着连读；停着 / 逐句 → 只读那一句。 */
    skip(delta: 1 | -1): void;
    state(): ReadAloudState;
    /** 当前（或最后读过的）那一句；没有 = null。 */
    current(): {
        span: SentenceSpan;
        index: number;
    } | null;
    /** 这段文本分出来的所有句子（宿主算「屏幕上第一句是第几句」用）。没 start 过 = 空。 */
    sentences(): readonly SentenceSpan[];
    on<K extends keyof ReadAloudEvents>(ev: K, cb: ReadAloudEvents[K]): () => void;
}

export declare interface ReadAloudDeps {
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

export declare interface ReadAloudEvents {
    /** 开始读这一句（宿主拿去高亮 / 滚动）。index = 第几句。 */
    sentence: (span: SentenceSpan, index: number) => void;
    state: (s: ReadAloudState) => void;
    /** 这段文本读完了（once 读完那一句不算）。 */
    end: () => void;
    /** 合成或播放出错；控制器已回到 idle。 */
    error: (e: Error) => void;
}

/**
 * steadiness = 实验念法，0（原样，默认）… 1（平稳：采样噪声小 + 稍慢），中间连续可调；后端支持才生效，sherpa 忽略。
 * steady: true = steadiness 1（0.1.9 的开关，留着兼容）。
 * whole = 整句合成（默认开；user 2026-10-02「加一个整句合成的选项，默认开，可以开关」）：中文 / 英语一句里同一种语言的几个小句
 *   一次交给模型，小句之间放模型自己认得的停顿记号、再补静音到该有的长度；false = 每个小句单独合成再接起来（0.1.12 及以前的做法）。
 *   日语本来就整句；后端支持才生效，sherpa 忽略。
 * preset = 预设（家族约定，user 2026-10-02「我们统一加一个预设的约定，onnx可以实现可以不实现，输入就是一个用户键盘输入的signed int，
 *   然后模型随便解释」）：用户敲的带符号整数，原样交给模型；模型声明了 `preset` 输入才喂，没声明 = 忽略。
 *   不给 = 模型自己的默认（piper-plus：config.json 的 "preset_default"，按每一段的语言取，没写的语言 = 0）。
 */
export declare interface ReadAloudOptions {
    /** 整段文本都按这种语言念；不给 = 每句自己判。 */
    lang?: SpeechLang;
    /** 每句自己判时可用的语言（宿主装进引擎的）；不给 = 中日英都可以。 */
    langs?: SpeechLang[];
    speaker?: number;
    speed?: number;
    steadiness?: number;
    steady?: boolean;
    whole?: boolean;
    preset?: number;
    once?: boolean;
}

export declare type ReadAloudState = "idle" | "loading" | "playing" | "paused";

/**
 * 给引擎配置里的包内文件名补上挂载目录。files = 后端看到的文件名（已去 `.gz`）。规则：配置里任何字符串值，按逗号拆开后**每一段都是包里的文件名或目录名**，就整段补目录；别的字符串原样。
 * （所以 "cpu"、"ja" 这种不会被误伤；"a.fst,b.fst" 这种逗号表会逐项补。）返回新对象，不改入参。
 */
export declare function resolvePackPaths<T>(config: T, dir: string, files: readonly string[]): T;

/** offset 落在哪一句：在句内 → 那一句；在两句之间 → 后面那一句；过了最后一句 → 最后一句；没有句子 → -1。 */
export declare function sentenceAt(spans: readonly SentenceSpan[], offset: number): number;

/** 原文里的一句：[start, end)。 */
export declare interface SentenceSpan {
    start: number;
    end: number;
}

/** 朗读包在 engineConfig 里的约定（sherpa-onnx 离线 TTS）。文件名都是包内相对名。 */
export declare interface SherpaTtsEngineConfig {
    kind: "sherpa-offline-tts";
    /** 直接交给 sherpa `OfflineTts` 的配置；其中出现的包内文件名由本库补上挂载目录。 */
    config: Record<string, unknown>;
    /** 每次合成附带的固定参数（如 Supertonic 的 numSteps）。 */
    generate?: {
        numSteps?: number;
        silenceScale?: number;
    };
    /** true = 合成时把语言码传给模型（多语模型需要）。 */
    passLang?: boolean;
    /** 能念的语言。 */
    langs: SpeechLang[];
    /** 音色：id = 引擎里的说话人编号。 */
    voices: {
        id: number;
        name: string;
    }[];
    /** 建好引擎后可以从内存盘删掉的大文件（权重已经读进引擎了）；不写 = 一个都不删。 */
    unlinkAfterLoad?: string[];
}

export declare interface SpeechEngine extends Synthesizer {
    /**
     * override = 本地模型会换掉的文件名（同 load 的 override 的键）：文件全被换掉的包算「有了」——比如 `.onnx` + `.json` 换掉了整个权重包，
     * 没下官方权重也能念（user 2026-10-02「没有下载官方模型的时候，本地模型加载了还是没法启用语音」）。
     */
    status(voice: string, opts?: {
        override?: readonly string[];
    }): Promise<VoiceStatus>;
    /**
     * 从 base（模型源，如 https://…/pwa-models）下载并逐片校验。可续传；已经有的包（别的音色、同源的兄弟 app 下过的）不重下。
     * langs = 只下这几种语言要的包；不给 = 这个音色的全部语言。进度按「这次要的所有包」的总字节报。
     */
    download(voice: string, base: string, opts?: {
        langs?: readonly SpeechLang[];
        override?: readonly string[];
        onProgress?: (p: PackProgress) => void;
    }): Promise<VoiceStatus>;
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
    load(voice: string, opts?: {
        langs?: readonly SpeechLang[];
        override?: Readonly<Record<string, Blob>>;
    }): Promise<LoadResult>;
    /** 现在装着哪个音色、哪几种语言、换了哪些本地文件；没有 = null。 */
    loaded(): {
        voice: string;
        langs: SpeechLang[];
        override: string[];
        preset: boolean;
    } | null;
    /** 最近一次 status / download / import / delete 的结论（同步问「能不能念」用）：给 lang = 那种语言能不能念；不给 = 有没有任何一种能念。没问过 = undefined。 */
    isKnownReady(voice: string, lang?: SpeechLang): boolean | undefined;
    /** 关掉所有 worker，归还内存（WASM 堆只涨不缩，这是唯一的归还办法）。之后再用会重新起。 */
    dispose(): void;
}

export declare interface SpeechEngineDeps {
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

/** 朗读用的语言。 */
export declare type SpeechLang = "ja" | "zh" | "en";

export declare function splitSentences(text: string): SentenceSpan[];

/** 控制器向引擎要的唯一一件事。 */
/** speaker = 一个模型里有几个说话人时的编号（缺省 0）。没有可念的内容（只有标点）→ 长度 0 的一段，控制器跳过这一句。 */
export declare interface Synthesizer {
    synth(text: string, opts: {
        lang: SpeechLang;
        speaker?: number;
        speed?: number;
        steadiness?: number;
        whole?: boolean;
        preset?: number;
    }): Promise<Clip>;
}

/**
 * 一个音色 = 一份音色定义：它由哪几个包组成、谁来跑、能念什么、要显示什么署名。
 * 模型仓 `voices/<id>.json` 就是这个形状；宿主 build 时把它和它点名的每个包的清单一起内嵌。
 * 拆成几个包是为了让别的音色、别的 app 能共用其中一些（运行时、某种语言的词典），也为了只下用得上的语言。
 */
export declare interface VoiceDef {
    v: number;
    id: string;
    /** 给人看的名字（宿主可以用自己的文案盖掉）。 */
    name: string;
    /** 哪个后端来跑：门面按它找 worker（"piper-plus" / "sherpa-onnx" …）。 */
    engine: string;
    /** 一定要有的包（权重、运行时）。 */
    packs: string[];
    /** 每种语言另外要的包。**键 = 这个音色能念的语言**；不需要额外包的语言写空数组。 */
    langPacks: Partial<Record<SpeechLang, string[]>>;
    /** 每个包的 packId（模型仓那头写的，宿主 build 时拿来对账；运行时的信任根是内嵌清单自己的 packId）。 */
    packIds?: Record<string, string>;
    /** 说话人：id = 引擎里的编号。不写 = 只有 0 号。 */
    speakers?: {
        id: number;
        name: string;
    }[];
    /** 必须显示在界面上的署名（原文，库不翻译）。 */
    credit?: string;
    /** 必须让用户看到的使用条款（原文）。 */
    terms?: string;
    termsUrl?: string;
    /** 其余出处（一行一条）。 */
    attribution?: string[];
    notes?: string;
    /** 打包时写的出处（哪天、谁打的）。 */
    createdAt?: string;
    createdBy?: string;
}

/** 这个音色能念的语言。 */
export declare function voiceLangs(v: VoiceDef): SpeechLang[];

/** 这个音色要用到的包（去重，顺序稳定）：必装的 + 点名那几种语言的；不点名 = 全部语言。 */
export declare function voicePacks(v: VoiceDef, langs?: readonly SpeechLang[]): string[];

/** 一个音色的状态（门面把它那几个包的状态合起来）。 */
export declare interface VoiceStatus {
    voice: string;
    /** 这个音色所有语言的包都齐了。 */
    ready: boolean;
    /** 现在就能念的语言（必装包齐 + 那种语言的包齐）。 */
    langs: SpeechLang[];
    bytesCached: number;
    bytesTotal: number;
    packs: PackStatus[];
}

export declare interface WebAudioSink extends AudioSink {
    /** 在用户手势里同步调用：建 / 恢复 AudioContext。重复调用无害。 */
    unlock(): void;
    /** 放掉 AudioContext（宿主退出朗读时调；之后再 unlock 会重建）。 */
    close(): void;
}

/** 一个 worker 脚本：url 由宿主 build 注入（带 hash）；type 缺省 classic。 */
export declare interface WorkerSpec {
    url: string;
    type?: "classic" | "module";
}

export { }
