// encode.js — phoneme tokens -> model input ids + prosody rows, a port of the reference encoder
// (upstream src/python/g2p/piper_plus_g2p/encode/encoder.py PiperEncoder + encode/pua.py map_token).
// created 2026-10-01 by Claude Fable 5.1
import { TOKEN2CHAR } from "./pua-map.js";

/**
 * Layout: BOS, pad, then every known id followed by a pad — except after an id that IS the pad/pause id (0) — then EOS "$".
 * Multi-character tokens ("ch", "N_n", "?!" …) are first mapped to their private-use codepoint; symbols the model has no id for
 * (space , . ! ; : in this model) are dropped.
 *
 * quirk=true (default) reproduces the reference bit-for-bit: `_tokens_to_raw_ids` drops unknown symbols, but `_convert_prosody`
 * does NOT drop their prosody entries, so the k-th kept id receives the prosody entry of the k-th token of the UNFILTERED list
 * (everything after a dropped space/comma is shifted by one). Training preprocessing (piper_train/preprocess.py) calls the same
 * encoder, so the shifted layout is what the model saw. Japanese is unaffected (every token it emits has an id).
 *
 * pauseAt (experiment, NOT reference behaviour): a Set of dropped symbols to turn into the pause id instead of dropping them.
 */
export function encodeTokens(tokens, prosody, phonemeIdMap, { quirk = true, pauseAt = null } = {}) {
  const pad = phonemeIdMap["_"][0], ids = [phonemeIdMap["^"][0], pad], pros = [[0, 0, 0], [0, 0, 0]];
  let k = 0;
  tokens.forEach((tok, i) => {
    const mapped = TOKEN2CHAR[tok] ?? tok;
    for (const ch of mapped) {
      const m = phonemeIdMap[ch];
      if (!m) { if (pauseAt && pauseAt.has(ch) && ids.length > 2 && i < tokens.length - 1) { ids.push(pad); pros.push([0, 0, 0]); } continue; }
      for (const id of m) { ids.push(id); pros.push((quirk ? prosody[k] : prosody[i]) || [0, 0, 0]); k++; if (id !== pad) { ids.push(pad); pros.push([0, 0, 0]); } }
    }
  });
  ids.push(phonemeIdMap["$"][0]); pros.push([0, 0, 0]);
  return { ids, pros };
}

// ---- language segmentation: port of piper_plus_g2p/multilingual.py UnicodeLanguageDetector + _segment_text_multilingual ----
const inR = (c, a, b) => c >= a && c <= b;
export function hasKana(text) { for (const ch of text) { const c = ch.codePointAt(0); if (inR(c, 0x3040, 0x30ff) || inR(c, 0x31f0, 0x31ff)) return true; } return false; }
/** language of one character, or null for neutral (digits, whitespace, ASCII punctuation …). langs: Set of model languages. */
export function detectChar(ch, kana, langs, latin = "en") {
  const c = ch.codePointAt(0), ja = langs.has("ja"), zh = langs.has("zh"), ko = langs.has("ko"), lat = langs.has(latin) ? latin : null;
  const cjk = () => (ja && zh ? (kana ? "ja" : "zh") : ja ? "ja" : zh ? "zh" : null);
  if (inR(c, 0x3130, 0x318f)) return ko ? "ko" : null;
  if (inR(c, 0x3040, 0x31ff)) return c <= 0x30ff || c >= 0x31f0 ? (ja ? "ja" : null) : null;
  if (inR(c, 0x1100, 0x11ff)) return ko ? "ko" : null;
  if (inR(c, 0x3400, 0x4dbf) || inR(c, 0x4e00, 0x9fff) || inR(c, 0xf900, 0xfaff)) return cjk();
  if (inR(c, 0xac00, 0xd7af)) return ko ? "ko" : null;
  if (inR(c, 0x3000, 0x303f)) return ja ? "ja" : null;
  if (inR(c, 0xff00, 0xffef)) return inR(c, 0xff21, 0xff3a) || inR(c, 0xff41, 0xff5a) ? lat : ja ? "ja" : null;
  if (inR(c, 0x41, 0x5a) || inR(c, 0x61, 0x7a)) return lat;
  if (inR(c, 0xc0, 0xd6) || inR(c, 0xd8, 0xf6) || inR(c, 0xf8, 0xff)) return lat;
  return null;
}
/** -> [[lang, text], …]; neutral characters are absorbed into the preceding segment (leading ones into the first). */
export function segmentText(text, langs, { kana = hasKana(text), latin = "en" } = {}) {
  if (!text.trim()) return [];
  const segs = []; let cur = null, buf = "";
  for (const ch of text) {
    const l = detectChar(ch, kana, langs, latin);
    if (l !== null && l !== cur && cur !== null) { segs.push([cur, buf]); buf = ""; }
    if (l !== null) cur = l;
    buf += ch;
  }
  if (buf && cur !== null) segs.push([cur, buf]);
  if (!segs.length) segs.push([latin, text]);
  return segs;
}
