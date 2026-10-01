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

export declare function createReadAloud(deps: ReadAloudDeps): ReadAloud;

export declare function createSpeechEngine(deps: SpeechEngineDeps): SpeechEngine;

export declare function createWebAudioSink(): WebAudioSink;

/** 这段文字用哪种语言念：有假名 = 日语；有汉字没假名 = 中文；都没有 = 英语。只看前 4000 个码元（整本书不用全扫）。 */
export declare function detectLang(text: string): SpeechLang;

/** 宿主内嵌进 bundle 的一个包：packId 是信任根。 */
export declare interface EmbeddedPack {
    packId: string;
    manifest: PackManifest;
}

export declare interface LoadResult {
    slug: string;
    alreadyLoaded: boolean;
    createMs: number;
    sampleRate: number;
    voices: number;
}

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
    /** 哪个后端来跑：现在只有 "sherpa-onnx"。 */
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
    /** 同一段里两句之间的停顿，毫秒（默认 600）。 */
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

export declare interface ReadAloudOptions {
    lang?: SpeechLang;
    voice?: number;
    speed?: number;
    once?: boolean;
}

export declare type ReadAloudState = "idle" | "loading" | "playing" | "paused";

/**
 * 给引擎配置里的包内文件名补上挂载目录。规则：配置里任何字符串值，按逗号拆开后**每一段都是包里的文件名或目录名**，就整段补目录；别的字符串原样。
 * （所以 "cpu"、"ja" 这种不会被误伤；"a.fst,b.fst" 这种逗号表会逐项补。）返回新对象，不改入参。
 */
export declare function resolvePackPaths<T>(config: T, dir: string, files: readonly PackFile[]): T;

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

export declare interface SpeechEngineDeps {
    /** worker 脚本的 URL（宿主把本库的 ./worker 入口单独打成一个文件，build 时注入带 hash 的路径）。 */
    workerUrl: string;
    /** 引擎文件（WASM + 胶水）所在目录，相对页面或绝对都行；宿主 vendor 它。 */
    engineBase: string;
    /** 宿主内嵌的语音包清单（信任根）。 */
    packs: Record<string, EmbeddedPack>;
    /** 语音包缓存名；默认家族共享的 "pwa-models"（同源兄弟 app 下过的包直接能用）。 */
    cacheName?: string;
}

/** 朗读用的语言。 */
export declare type SpeechLang = "ja" | "zh" | "en";

export declare function splitSentences(text: string): SentenceSpan[];

/** 控制器向引擎要的唯一一件事。 */
export declare interface Synthesizer {
    synth(text: string, opts: {
        lang: SpeechLang;
        voice?: number;
        speed?: number;
    }): Promise<Clip>;
}

export declare interface WebAudioSink extends AudioSink {
    /** 在用户手势里同步调用：建 / 恢复 AudioContext。重复调用无害。 */
    unlock(): void;
    /** 放掉 AudioContext（宿主退出朗读时调；之后再 unlock 会重建）。 */
    close(): void;
}

export { }
