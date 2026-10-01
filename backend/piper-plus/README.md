# piper-plus つくよみちゃん — read-aloud backend for a module Web Worker

> created 2026-10-01 by Claude Fable 5.1
> as-of: piper-plus `82ee4e7`, `onnxruntime-web@1.30.0`, pyopenjtalk-plus `0.4.1.post9`, model `ayousanz/piper-plus-tsukuyomi-chan`
> (sha256 `5289e9b6…`). Background and evidence for *why* the inputs look the way they do: `../work/NOTES.md`.

> **This copy lives in `@internal/read-aloud`** (copied 2026-10-01). The files it mentions that are not here — `../work/NOTES.md`,
> `pack-layout.json`, `make-pack.mjs`, `build-packs.mjs`, `test/` — are in the investigation folder
> `~/jupyter/third-party/piper-plus/backend/`. Change the algorithm there first (the parity tests against the Python reference live there), then copy.

Bytes in, audio out. No network, no DOM, no storage. One sentence per call.

## Interface (as implemented)

```js
import { createPiperPlusBackend } from "./backend/index.js";   // the only export

const backend = createPiperPlusBackend();
const { sampleRate, voices, langs } = await backend.load({ files });   // files: Map<string, Uint8Array>
files.clear();                                                           // nothing is retained by the backend
const { samples, sampleRate } = await backend.synth("これはテストです。", { lang: "ja", voice: 0, speed: 1 });
await backend.unload();
```

| call | details |
|---|---|
| `load({ files })` | Needs `model.onnx`, `config.json`, `ort-wasm-simd-threaded.wasm`. A language is offered only if **all** of its files are in the Map (table below). Resolves to `{ sampleRate: 22050, voices: 1, langs }`, `langs` ⊆ `["ja","en","zh"]`. Throws if already loaded or a core file is missing. Accepts `Uint8Array` or `ArrayBuffer` values. Does not modify the Map. |
| `synth(text, { lang, voice, speed })` | One sentence in → `{ samples: Float32Array, sampleRate }` (mono, peak-normalised). `voice` must be `0` or omitted. `speed` → `length_scale = 1.5 / speed`, clamped to 0.25 … 4, default 1. Unavailable language → `Error('… language "x" is not available (loaded: …)')`. Text with nothing pronounceable → zero-length `samples`. Calls are queued internally (one inference at a time). |
| `unload()` | Releases the ONNX session and drops the OpenJTalk instance and dictionaries (collected by GC: verified, the 160 MB heap disappears). onnxruntime-web keeps its WASM runtime as a module singleton (its heap stays allocated and is reused by the next `load`). |

Test-only extension: `synth(text, { …, __debug: true })` adds `debug: [{ text, ids, pros, lid, scales, embDim, mask }]`, the exact model
inputs of every piece. The proof tests use it; production callers should not.

| group | names in `ctx.files` |
|---|---|
| core | `model.onnx` `config.json` `ort-wasm-simd-threaded.wasm` |
| ja | `ja/sys.dic` `ja/matrix.bin` `ja/char.bin` `ja/unk.dic` `ja/ojt.wasm` `ja/nani-model.json` |
| en | `en/cmudict_data.json` `en/homographs.json` |
| zh | `zh/pinyin_single.tone3.json` `zh/pinyin_phrases.tone3.json` |

Sources, sizes, hashes and licences of these 13 files: `pack-layout.json` (made by `make-pack.mjs`, which also stages them as
symlinks under `pack/`). What must ship next to them: `LICENSES.md`.

## What `synth` does

1. **Pieces.** `ja`: the sentence as is. `en`, `zh`: cut after `, ; : ， ； ： 、 —` (`text.js` `splitClauses`, pieces shorter than
   20 / 5 characters are glued to a neighbour; a comma or colon between digits is not a cut) and joined with **250 ms** of silence.
   The caller splits sentences and inserts the inter-sentence silence (600 ms in all samples made so far).
2. **G2P → ids + prosody rows**, laid out as the Python reference encoder lays them out.
   - `ja` `ja-frontend.js`: OpenJTalk of pyopenjtalk-plus in WASM + its dictionary + ports of its rule passes. Latin-letter runs go
     to the English G2P when English is loaded (as in the reference); otherwise they are skipped. Kanji always count as Japanese.
   - `en` `en-g2p.js`: CMUdict + homograph table + suffix / letter fallbacks, numbers written out.
   - `zh` `zh-g2p.js`: JS port of the piper-plus Rust G2P — **no 60 MB WASM**. Digits are first written out in hanzi (`text.js`
     `normalizeZhNumbers`); the reference would drop them silently.
3. **Inference** (`vits.js`): scales `[0.667, 1.5 / speed, 0.5]`, `lid`, zero speaker embedding of the declared size (256) with mask
   `[[0]]`, short-text strategies, EOS trim, per-piece peak normalisation — all as in the reference runtime.

ORT is configured with one thread, no proxy worker, WASM backend only, and `graphOptimizationLevel: "disabled"`: with it the ORT heap
is 116.5 MB instead of 201.4 MB and loading is ~0.5 s faster, at ~3 % slower inference; the output is unchanged (noise zeroed,
identical ids: difference to the Python reference ≤ 4.3e-5, i.e. one 16-bit step).

## Parity (what was measured)

| | result |
|---|---|
| ja, 11 test sentences, in the worker (source tree and bundle) | model inputs identical to the Python reference, 11 / 11 |
| ja, 1048 Aozora sentences (`test/ja-parity.mjs`, node) | identical 1037 / 1048; the rest: 7 × Sudachi picks another kanji reading in the reference, 3 × kana-less text (read as Japanese here, as Chinese by the reference), 1 × an unknown English word |
| ja, 30 edge cases (digits, 何, 々, emoji, embedded English, ？) | identical 30 / 30 |
| zh port vs the previous WASM path, 3124 sentences (鲁迅 ×5, 朱自清 ×1; traditional + simplified; plus edge cases) | identical 3124 / 3124 (raw encoder output and final model input) |
| zh port vs the Python reference (pypinyin), same corpus | ids identical 2830 / 3124; 292 of the 294 mismatches are only the encoding of `？` (see below); 2 are rare extension-block characters |
| en vs the Python reference | 5 / 6 test sentences; 172 / 285 on Alice ch. 1–3 (the reference's neural guesses for unknown words and its misplaced stress after `’ - —`) |

`？` in Chinese: the WASM path (and so this port, by default) does not feed `?` as an inline token; the last one seen becomes the EOS
id — this mirrors training preprocessing. The Python *inference* reference keeps it inline with `$` as EOS. `zh-g2p.js`
`encode(text, map, "python")` gives that layout (identical to the Python reference on 3122 / 3124); `index.js` uses the default.

## Numbers (headless Chromium, module Worker, 1 thread, GPU disabled, AMD Ryzen 7 7840U)

| | |
|---|---|
| `load()` all three languages, from bytes | 1.2–1.4 s |
| `load()` Japanese only, second time in the same worker | 0.7–0.8 s |
| RTF (synthesis ms / audio ms), median per language | ja 0.093–0.103, en 0.099–0.113, zh 0.096–0.112 over six runs (max single clip 0.13) |
| G2P share | ≈ 1 ms per sentence |
| WASM heaps after load | ORT 116.5 MB + OpenJTalk 160 MB (fixed size; the 103 MB dictionary is mapped in place, not copied twice) |
| worker JS heap after load | ≈ 22 MB used (CMUdict, pinyin tables) |
| transient during `load()` | + the caller's Map (167 MB raw for all languages) until it is cleared |
| after `unload()` + GC | ORT heap 116.5 MB remains; OpenJTalk heap gone; JS heap ≈ 3 MB |
| bundle (`esbuild backend/index.js --bundle --format=esm`) | 247,181 bytes, 64,516 gzip -9 |

## Tests (`test/`)

```bash
node make-pack.mjs                     # stage pack/ + pack-layout.json
node test/run-test.mjs src             # module Worker importing ../index.js      (writes samples/piperplus-backend-{ja,en,zh}/)
node test/run-test.mjs bundle          # esbuild single file, same checks         (writes samples/piperplus-backendbundle-…/)
node test/blob-check.mjs               # the bundle inside a blob: URL worker
node test/ja-parity.mjs                # Japanese modules vs Python reference, 1048 + 30 sentences (node)
node test/zh-parity.mjs test/corpus/zh-wasm.json      # zh port vs WASM dump (node); dump made by test/zh-wasm-dump.mjs
node test/zh-vs-python.mjs test/corpus/zh-pyref.json  # zh port vs pypinyin reference (information)
```

`run-test.mjs` checks, 18 in total, all passing for both builds: module Worker; `load` result; (1) Japanese inputs identical to the
reference; (2) every sentence synthesizes, then SenseVoice round trip; en / zh inputs equal the node-verified G2P for every piece;
speed mapping; clause cutting only for en / zh; error cases; unload / reload with a language subset; (3) zero requests after the Map
is handed over — server log, browser request events and in-worker counters for fetch / XHR / importScripts / WebSocket / indexedDB /
caches — plus a deliberate control request that all three detectors must see; (4) timings and memory. Results: `test/out/`.

## Not verified

- Nothing was listened to. No real device (iPad / iOS Safari memory behaviour with a 160 MB + 116 MB heap is untested).
- The SenseVoice round trip swings by several points between runs of identical inputs; it shows "intelligible", not "equal".
- `normalizeZhNumbers` and the English number expansion are simple; they are not part of any reference.
- es / fr / pt are not offered by this backend (they would need the piper-plus WASM).
