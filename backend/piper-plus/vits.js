// vits.js — phoneme ids -> audio: builds exactly the ONNX feeds the reference runtime builds (piper_train.infer_onnx /
// piper_plus.voice) and applies the same post-processing. No text handling here.
// created 2026-10-01 by Claude Fable 5.1
//
// Reference behaviour kept 1:1:
//   scales [noise_scale, length_scale, noise_w]; lid; prosody_features [1, n, 3]
//   speaker_embedding = zeros of the size the model declares (256 for this export) with speaker_embedding_mask [[0]]  -> trained voice
//   short-text contract (upstream issue #356): Strategy B scales the noise down below 15 ids, Strategy A pads to 15 ids and the
//     padding is cut out again using the model's `durations` output
//   EOS frames are dropped (issue #499: they sound like a doubled last syllable)
//   per-utterance peak normalisation (audio_float_to_int16: audio * 32767 / max(0.01, max|audio|))

const MIN_PHONEME_IDS = 15, MIN_BODY_FOR_STRATEGY_A = 3, HOP = 256;

function padShort(ids, pros) {
  const n = ids.length;
  if (n - 2 < MIN_BODY_FOR_STRATEGY_A || n >= MIN_PHONEME_IDS) return { ids, pros, front: 0, back: 0 };
  const total = MIN_PHONEME_IDS - n, front = Math.floor(total / 2), back = total - front, z = (k) => new Array(k).fill(0), zp = (k) => Array.from({ length: k }, () => [0, 0, 0]);
  return { ids: [ids[0], ...z(front), ...ids.slice(1, -1), ...z(back), ids[n - 1]], pros: [pros[0], ...zp(front), ...pros.slice(1, -1), ...zp(back), pros[n - 1]], front, back };
}
function trimEos(audio, d) {
  if (!d || !d.length) return audio;
  const cut = Math.trunc(Math.max(0, Math.ceil(d[d.length - 1])) * HOP);
  return cut <= 0 || cut >= audio.length ? audio : audio.subarray(0, audio.length - cut);
}
function trimByDurations(audio, d, front, back) {
  if (front <= 0 && back <= 0) return trimEos(audio, d);
  if (!d || d.length < 2 + front + back) return audio;
  let fs = 0; for (let i = 0; i < 1 + front; i++) fs += d[i];
  let bs = 0; for (let i = d.length - 1 - back; i < d.length - 1; i++) bs += d[i];
  const start = Math.max(0, Math.trunc(fs * HOP)), end = audio.length - (Math.trunc(bs * HOP) + Math.trunc(Math.max(0, d[d.length - 1]) * HOP));
  return start >= audio.length || end <= start ? audio : audio.subarray(start, end);
}
/**
 * Sample span of ids0[j] in the trimmed audio. The decoder expands every id to ceil(duration) frames of HOP samples (checked:
 * Σ ceil(d) × HOP = output length); trimByDurations cuts trunc(Σ d[0..front] × HOP) off the front when it padded, nothing otherwise.
 */
function markSpans(markAt, d, front, back, rawLen, outLen) {
  if (!d) return markAt.map(() => ({ start: 0, end: 0 }));
  const cum = new Array(d.length + 1); cum[0] = 0;
  for (let i = 0; i < d.length; i++) cum[i + 1] = cum[i] + Math.max(0, Math.ceil(d[i])) * HOP;
  let lead = 0;
  if (front > 0 || back > 0) { let fs = 0; for (let i = 0; i < 1 + front; i++) fs += d[i]; lead = Math.max(0, Math.trunc(fs * HOP)); }
  const clamp = (v) => Math.min(outLen, Math.max(0, v));
  return markAt.map((j) => { const p = j + front; return { start: clamp(cum[p] - lead), end: clamp(cum[p + 1] - lead) }; });
}
function peakNormalize(a) {
  let m = 0.01; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; }
  const g = (32767 / 32768) / m, out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * g;
  return out;
}

/**
 * @param {object} ort      the onnxruntime-web module
 * @param {object} session  ort.InferenceSession of the VITS model
 * @param {object} config   parsed config.json of the model
 */
export function createVits(ort, session, config) {
  const names = new Set(session.inputNames), sampleRate = config.audio?.sample_rate ?? 22050;
  let embDim = 256;
  for (const m of session.inputMetadata || []) if (m && m.name === "speaker_embedding" && Array.isArray(m.shape) && typeof m.shape[1] === "number") embDim = m.shape[1];
  const big = (v) => BigInt(v);

  /**
   * @param {number[]} ids0    phoneme ids incl. BOS / pads / EOS
   * @param {number[][]} pros0 one [a1, a2, a3] row per id
   * @param {string} lang      key of config.language_id_map
   * @param {{noiseScale: number, lengthScale: number, noiseW: number}} scales
   * @param {number[]} [markAt]  indices into ids0 whose sample span in the returned audio is wanted (whole-sentence pauses)
   * @returns {Promise<{samples: Float32Array, inputs: object, marks?: {start: number, end: number}[]}>}
   */
  async function synthIds(ids0, pros0, lang, scales, markAt) {
    let { noiseScale, noiseW } = scales; const { lengthScale } = scales;
    const n0 = ids0.length;
    if (n0 < MIN_PHONEME_IDS) { const ratio = Math.min(1, n0 / MIN_PHONEME_IDS); noiseScale *= Math.max(0.5, ratio); noiseW *= Math.max(0.4, ratio); }
    const { ids, pros, front, back } = padShort(ids0, pros0);
    const n = ids.length, lid = config.language_id_map?.[lang] ?? 0;
    const feeds = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids, big), [1, n]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([big(n)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([noiseScale, lengthScale, noiseW]), [3]),
    };
    if (names.has("lid")) feeds.lid = new ort.Tensor("int64", BigInt64Array.from([big(lid)]), [1]);
    if (names.has("prosody_features")) feeds.prosody_features = new ort.Tensor("int64", BigInt64Array.from(pros.flat(), big), [1, n, 3]);
    if (names.has("speaker_embedding")) feeds.speaker_embedding = new ort.Tensor("float32", new Float32Array(embDim), [1, embDim]);
    if (names.has("speaker_embedding_mask")) feeds.speaker_embedding_mask = new ort.Tensor("int64", BigInt64Array.from([0n]), [1, 1]);
    if (names.has("sid")) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
    const res = await session.run(feeds);
    const raw = new Float32Array(res.output.data), d = res.durations ? new Float32Array(res.durations.data) : null;
    for (const k of Object.keys(res)) res[k].dispose?.();
    const out = { samples: peakNormalize(trimByDurations(raw, d, front, back)),
      inputs: { ids: ids0, pros: pros0, lid, scales: [noiseScale, lengthScale, noiseW], embDim, mask: 0 } };
    if (markAt && markAt.length) out.marks = markSpans(markAt, d, front, back, raw.length, out.samples.length);
    return out;
  }
  return { sampleRate, synthIds };
}
