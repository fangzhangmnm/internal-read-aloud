// whole.js — whole-sentence synthesis for zh / en: the clause pieces of one language run are fed to the model in ONE pass with the
// model's own pause token at every junction, and the pause is then made long enough with silence. Pure functions, no model here.
// created 2026-10-02 by Claude Opus 5.5
//
// Why (owner 2026-10-02): the shipped way cuts a sentence at every punctuation cluster and synthesizes each piece alone, so every
// piece is planned as a separate utterance; a sample read line by line sounded「稍微好一点点」, and the owner then asked for
// 「合成，然后用不同的符号来fake不同的停顿。以后就只有切换语言的时候和句子级别要断句」.
//   - The only pause symbol this model knows is "_" (id 0, also the pad between ids): the Japanese frontend writes 、 as one extra 0
//     (`… a _ _ X …`). joinPieces() does the same at each junction.
//   - The model decides how long it pauses there (it varies a lot from take to take), so padSilence() adds silence up to the
//     junction's pause length (text.js PAUSE_MS, divided by the speed).
//   - The sound lags the frame alignment: the tail of the previous syllable runs into the pause token's frames and the real silence
//     comes 20–300 ms later (measured 2026-10-02; padding at the token's midpoint chopped the tail of a syllable). So the silence goes
//     at the quietest point from the token's start to 250 ms (÷ speed) after its end, and only what is missing there is added.
//     No fallback to cutting when no quiet point exists (the owner withdrew that variant).

const PAD = 0;

/**
 * Join the encoded pieces of one language run into one id sequence, one extra pad at each junction.
 * Each piece must have the reference layout [BOS, pad, …, pad, EOS]; anything else -> null (caller synthesizes piece by piece).
 * @param {{ids: number[], pros: number[][], pauseMs: number}[]} parts   pauseMs = pause after that piece
 * @returns {null | {ids: number[], pros: number[][], marks: {index: number, pauseMs: number}[]}}  marks: index of each junction's pause id
 */
export function joinPieces(parts) {
  if (!parts.length) return null;
  for (const p of parts) if (p.ids.length < 4 || p.ids[1] !== PAD || p.ids[p.ids.length - 2] !== PAD || p.pros.length !== p.ids.length) return null;
  const first = parts[0], last = parts[parts.length - 1];
  const ids = [first.ids[0]], pros = [first.pros[0]], marks = [];
  parts.forEach((p, k) => {
    if (k === 0) { ids.push(...p.ids.slice(1, -1)); pros.push(...p.pros.slice(1, -1)); return; }
    marks.push({ index: ids.length, pauseMs: parts[k - 1].pauseMs });
    ids.push(PAD); pros.push([0, 0, 0]);                                          // the pause: "… x _ _ y …"
    ids.push(...p.ids.slice(2, -1)); pros.push(...p.pros.slice(2, -1));          // this piece's body without its leading pad
  });
  ids.push(last.ids[last.ids.length - 1]); pros.push(last.pros[last.pros.length - 1]);
  return { ids, pros, marks };
}

const QUIET_DB = -50, WIN_S = 0.01, STEP_S = 0.005, FADE_S = 0.005, LAG_S = 0.25;

/**
 * Add silence at each junction so that the pause there is at least its target length.
 * @param {Float32Array} samples  peak-normalised clip of the joined sequence
 * @param {number} sr
 * @param {{start: number, end: number, pauseMs: number}[]} marks  sample span of each junction's pause id in `samples`
 * @param {number} speed          pauses and the search window scale with 1 / speed
 * @returns {{samples: Float32Array, padded: {at: number, added: number, quiet: number}[]}}  added / quiet in samples
 */
export function padSilence(samples, sr, marks, speed = 1) {
  const w = Math.max(1, Math.round(sr * WIN_S)), step = Math.max(1, Math.round(sr * STEP_S)), fade = Math.round(sr * FADE_S);
  const level = (j) => {   // dBFS of the 2·w samples around j
    const a = Math.max(0, j - w), b = Math.min(samples.length, j + w); if (b <= a) return -200;
    let s = 0; for (let i = a; i < b; i++) s += samples[i] * samples[i];
    return 10 * Math.log10(Math.max(1e-20, s / (b - a)));
  };
  const plan = [];
  for (const m of marks) {
    const target = Math.round((m.pauseMs / speed / 1000) * sr);
    const lo = Math.max(w, Math.min(m.start, samples.length - w)), hi = Math.min(samples.length - w, m.end + Math.round((LAG_S / speed) * sr));
    let at = lo, best = Infinity;
    for (let j = lo; j <= Math.max(lo, hi); j += step) { const v = level(j); if (v < best) { best = v; at = j; } }
    let l = at, r = at;   // how long is it already quiet around that point: window centres l…r are quiet, so l−w … r+w is
    while (l - step > 0 && level(l - step) < QUIET_DB) l -= step;
    while (r + step < samples.length && level(r + step) < QUIET_DB) r += step;
    const quiet = best < QUIET_DB ? r - l + 2 * w : 0;
    plan.push({ at, added: Math.max(0, target - quiet), quiet });
  }
  const total = plan.reduce((a, p) => a + p.added, 0);
  if (!total) return { samples, padded: plan };
  const out = new Float32Array(samples.length + total), src = samples.slice();
  for (const p of plan) if (p.added) {   // short fades on both sides of the cut so it never clicks
    for (let i = 1; i <= fade && p.at - i >= 0; i++) src[p.at - i] *= (i - 1) / fade;
    for (let i = 0; i < fade && p.at + i < src.length; i++) src[p.at + i] *= i / fade;
  }
  const order = plan.map((p, k) => k).sort((x, y) => plan[x].at - plan[y].at);
  let from = 0, off = 0;
  for (const k of order) { const p = plan[k]; out.set(src.subarray(from, p.at), off); off += p.at - from + p.added; from = p.at; }
  out.set(src.subarray(from), off);
  return { samples: out, padded: plan };
}
