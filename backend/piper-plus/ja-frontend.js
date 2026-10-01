// ja-frontend.js — Japanese text frontend for the browser that reproduces the reference runtime's G2P:
//   pyopenjtalk-plus 0.4.1.post9 (OpenJTalk fork + its dictionary + its Python rule passes)  ->  piper_plus_g2p/japanese.py tokens.
// created 2026-10-01 by Claude Fable 5.1
//
// Why: the piper-plus Rust WASM uses jpreprocess + NAIST-JDIC, whose accent phrasing differs from pyopenjtalk-plus (the frontend the
// model was trained with). Here the *same C code and the same dictionary* run in WebAssembly (vendor/ojt/ojt.mjs + ojt.wasm, built from
// the pyopenjtalk-plus sdist), and the Python-side rule passes are ported 1:1 below.
//
// Ported from pyopenjtalk-plus 0.4.1.post9 (MIT/BSD, tsukumijima):
//   openjtalk.pyx  apply_original_rule_before_chaining
//   __init__.py    modify_filler_accent, apply_postprocessing (order of passes)
//   utils.py       predict_nani_reading (rule part only), suppress_unnatural_auxiliary_u_long_vowel, retreat_acc_nuc,
//                  modify_acc_after_chaining, process_odori_features (+ split_kana_mora, detect_odori_unit)
// NOT ported (needs data that cannot reasonably ship to a browser) — the two known gaps versus the reference:
//   modify_kanji_yomi   Sudachi-based reading choice for stand-alone single-kanji morphemes in MULTI_READ_KANJI_LIST (風 方 上 下 人 …)
//   predict_nani_reading's ONNX random-forest for 何 (ナニ/ナン) when the rules do not decide
// Ported from piper-plus (MIT): piper_plus_g2p/japanese.py _phonemize_core, _apply_n_phoneme_rules, _get_question_type.

const FIELDS = ["string", "pos", "pos_group1", "pos_group2", "pos_group3", "ctype", "cform", "orig", "read", "pron", "acc", "mora_size", "chain_rule", "chain_flag"];
const INT_FIELDS = new Set(["acc", "mora_size", "chain_flag"]);
const cps = (s) => Array.from(s);
const isKanji = (c) => { const o = c.codePointAt(0); return o >= 0x4e00 && o <= 0x9fff; };

function parseNjd(tsv) {
  const out = [];
  for (const line of tsv.split("\n")) {
    if (!line) continue;
    const f = line.split("\t"), o = {};
    FIELDS.forEach((k, i) => { o[k] = INT_FIELDS.has(k) ? parseInt(f[i], 10) : (f[i] ?? ""); });
    out.push(o);
  }
  return out;
}
const dumpNjd = (features) => features.map((o) => FIELDS.map((k) => String(o[k]).replace(/[\t\n\0]/g, "")).join("\t")).join("\n") + (features.length ? "\n" : "");

// ---- openjtalk.pyx: apply_original_rule_before_chaining ---------------------------------------------------------
function applyOriginalRuleBeforeChaining(F) {
  for (let i = 0; i < F.length - 1; i++) {
    const njd = F[i], next = F[i + 1];
    if (njd.pos === "名詞" && next.string === "不足" && next.pron === "フソク") { next.read = "ブソク"; next.pron = "ブソク"; }
    let isFractionDenominator = false;
    if (i + 2 < F.length && next.string === "の") isFractionDenominator = F[i + 2].pos_group1 === "数";
    if (isFractionDenominator && njd.string.endsWith("分")) {
      if (njd.pron.endsWith("フン") || njd.pron.endsWith("プン")) { njd.read = cps(njd.read).slice(0, -2).join("") + "ブン"; njd.pron = cps(njd.pron).slice(0, -2).join("") + "ブン"; }
      else if (njd.pron.endsWith("ブ")) { njd.read += "ン"; njd.pron += "ン"; }
    }
    if (i > 0 && i + 2 < F.length && njd.string === "分" && F[i - 1].pos_group1 === "数" && next.string === "の" && F[i + 2].pos_group1 === "数") { njd.read = "ブン"; njd.pron = "ブン"; }
    if (njd.string === "〇" && next.string === "〇") for (const p of [njd, next]) { p.pos_group1 = "一般"; p.read = "マル"; p.pron = "マル"; p.acc = 1; p.mora_size = 2; }
    if (next.string === "球" && next.pos === "名詞" && next.pos_group1 === "接尾" && next.pron === "キュー" &&
        cps(njd.string).some((c) => c >= "一" && c <= "鿿") && cps(njd.string).some((c) => c >= "ぁ" && c <= "ゖ")) {
      next.read = "ダマ"; next.pron = "ダマ"; next.acc = 1; next.mora_size = 2; next.chain_rule = "C4";
    }
    if ((["サ変接続", "格助詞", "接続助詞"].includes(njd.pos_group1) || (njd.pos === "名詞" && njd.pos_group1 === "一般") || njd.pos === "副詞") && next.ctype === "サ変・スル") next.chain_flag = 1;
    if (["お", "御", "ご"].includes(njd.string) && njd.chain_rule === "P1") {
      if (next.acc === 0 || next.acc === next.mora_size) { next.chain_rule = "C4"; next.acc = 0; } else next.chain_rule = "C1";
    }
    if (njd.pos === "動詞" && next.pos === "動詞") next.chain_rule = next.acc !== 0 ? "C1" : "C4";
    if (["連用形", "連用タ接続", "連用ゴザイ接続", "連用テ接続"].includes(njd.cform) && njd.acc === njd.mora_size && njd.mora_size > 1) njd.acc -= 1;
    if (["れる", "られる", "せる", "させる", "ちゃう"].includes(njd.orig) && next.string === "た") next.chain_rule = "F2@1";
    if (njd.pos === "形容詞" && ["なる", "する"].includes(next.orig)) next.chain_flag = 1;
  }
  return F;
}

// ---- __init__.py / utils.py rule passes ----------------------------------------------------------------------------
function modifyFillerAccent(F) {
  let after = false;
  for (const f of F) {
    if (f.pos === "フィラー") { if (f.acc > f.mora_size) f.acc = 0; after = true; }
    else if (after) { if (f.pos === "名詞") f.chain_flag = 0; after = false; }
  }
  return F;
}
/** 何 classifier of pyopenjtalk-plus (yomi_model/nani_model.onnx, a random forest over one-hot features of the NEXT morpheme), evaluated in JS.
 *  model = fixed/assets/ja-nani-model.json (made by ojt/export_nani.py). returns 1 for ナン, 0 for ナニ. */
export function naniPredict(model, next) {
  if (!next) return 0;
  const x = [];
  for (const oh of model.onehot) { const v = next[model.x_cols[oh.col]]; for (const c of oh.cats) x.push(c === v ? 1 : 0); }
  const score = [0, 0];
  for (const tree of model.trees) {
    let n = 0;
    for (;;) {
      const [mode, feat, val, tn, fn] = tree.nodes[n];
      if (mode === "LEAF") { const w = tree.leaves[n]; if (w) { score[0] += w[0]; score[1] += w[1]; } break; }
      n = x[feat] <= val ? tn : fn;   // BRANCH_LEQ
    }
  }
  return score[1] > score[0] ? 1 : 0;   // np.argmax: first max wins on ties
}
function predictNaniReading(F, model) {   // == utils.predict_nani_reading; without `model` only the rule part runs
  F.forEach((cur, i) => {
    if (cur.orig !== "何") return;
    const next = i + 1 < F.length ? F[i + 1] : null;
    const high = next !== null && (["を", "が", "に", "も", "より"].includes(next.orig) || next.orig === "する" || (next.string === "で" && next.pos === "助動詞" && next.ctype === "特殊・ダ"));
    const keepNan = next !== null && next.orig === "で" && next.pos === "助詞" && next.pos_group1 === "格助詞";
    let isNan;
    if (high) isNan = 0; else if (keepNan) isNan = 1; else if (model) isNan = naniPredict(model, next); else return;
    cur.pron = cur.read = isNan === 1 ? "ナン" : "ナニ";
  });
  return F;
}
// modify_kanji_yomi() in the reference asks Sudachi for the reading of stand-alone single-kanji morphemes of this list and overwrites
// pron/read with it. Sudachi (70 MB dictionary) cannot ship to a browser. What CAN be reproduced is the pass's most frequent effect:
// when Sudachi agrees with OpenJTalk's reading (the usual case) the overwrite still replaces `pron` by the plain reading, which drops
// OpenJTalk's devoicing marks (ヒ’ト -> ヒト) and long-vowel spelling. Emulating exactly that raises sentence-level identity with the
// reference from 96.1 % to 99.3 % on the 1048-sentence test corpus (with the two refinements below); the rest are sentences where Sudachi really picks another reading
// (下: シタ->モト, 方: ホウ->カタ …) or where its token alignment fails and the reference skips the pass.
const MULTI_READ_KANJI = new Set(("風観方出時上下君手嫌表対色人前後角金頭筆水間棚床入来塗怒包被開弾捻潜支抱行降種訳糞空性体等生止堪捩家縁労中高低気要退面色主術直片緒小大値").split(""));
function emulateKanjiYomiPass(F) {
  // The reference aborts the whole pass when Sudachi's list of target-kanji tokens (matched by SURFACE) does not line up one-to-one
  // with OpenJTalk's (matched by LEMMA `orig`). Part of that is predictable without Sudachi: a verb stem written with a target kanji
  // (来 in 来た, 出 in 出て …) is a Sudachi hit but not an OpenJTalk one (orig = 来る), so the counts differ and the pass is skipped.
  const hits = F.filter((f) => MULTI_READ_KANJI.has(f.orig)), surfaceHits = F.filter((f) => MULTI_READ_KANJI.has(f.string));
  if (!hits.length || surfaceHits.length !== hits.length) return F;
  // 接頭詞 (小狐, 大歓迎 …) are left alone: Sudachi usually keeps prefix+noun as one token (heuristic; 5 of 5 in the test corpus).
  for (const f of hits) if (f.pos_group1 !== "接尾" && f.pos !== "接頭詞") { const y = f.orig === "方" && f.read === "ホウ" ? "ホオ" : f.read; f.pron = y; f.read = y; }
  return F;
}
const DAN = {}; for (const [d, s] of [["a", "アカサタナハマヤラワガザダバパァ"], ["i", "イキシチニヒミリギジヂビピィ"], ["u", "ウクスツヌフムユルグズヅブプヴゥ"], ["e", "エケセテネヘメレゲゼデベペェ"], ["o", "オコソトノホモヨロヲゴゾドボポォ"]]) for (const c of s) DAN[c] = d;
function suppressUnnaturalAuxiliaryULongVowel(F) {
  for (let i = 0; i < F.length - 1; i++) {
    const cur = F[i], next = F[i + 1];
    if (next.pron !== "ー" || next.read !== "ウ") continue;
    const p = cps(cur.pron.replace(/’+$/u, "")); if (!p.length) continue;
    if (["a", "i", "e"].includes(DAN[p[p.length - 1]])) next.pron = "ウ";
  }
  return F;
}
const YOUON = new Set("ャュョァィゥェォ");
function retreatAccNuc(F) {
  if (!F.length) return F;
  let acc = 0, head = F[0];
  for (const njd of F) {
    if (njd.chain_flag === 0 || njd.chain_flag === -1) { head = njd; acc = njd.acc; }
    let pron = cps(njd.pron).filter((c) => !YOUON.has(c)); if (pron.length === 0) pron = cps(njd.pron);
    if (acc > 0) {
      if (acc <= njd.mora_size) {
        const nuc = acc - 1 < pron.length ? pron[acc - 1] : pron[0];
        if (["ー", "ッ", "ン"].includes(nuc)) head.acc += -1;
        acc = -1;
      } else acc = acc - njd.mora_size;
    }
  }
  return F;
}
function modifyAccAfterChaining(F) {
  if (!F.length) return F;
  let acc = 0, isAfterNuc = false, phaseLen = 0, head = F[0];
  for (const njd of F) {
    if (njd.chain_flag === 0 || njd.chain_flag === -1) { isAfterNuc = false; head = njd; acc = njd.acc; phaseLen = 0; }
    if (acc === 0) continue;
    else if (isAfterNuc) {
      if (njd.ctype === "特殊・マス") head.acc = njd.cform !== "未然形" ? phaseLen + 1 : phaseLen + 2;
      else if (njd.ctype === "特殊・ナイ") head.acc = phaseLen;
      else if (["れる", "られる", "すぎる", "せる", "させる"].includes(njd.orig)) head.acc = phaseLen + njd.acc;
      else { isAfterNuc = false; acc = 0; }
      phaseLen += njd.mora_size;
    } else {
      phaseLen += njd.mora_size;
      if (acc <= njd.mora_size) isAfterNuc = true; else acc = acc - njd.mora_size;
    }
  }
  return F;
}
const SEION = {}; { const d = "がぎぐげござじずぜぞだぢづでどばびぶべぼガギグゲゴザジズゼゾダヂヅデドバビブベボヴ", s = "かきくけこさしすせそたちつてとはひふへほカキクケコサシスセソタチツテトハヒフヘホウ"; cps(d).forEach((c, i) => { SEION[c] = cps(s)[i]; }); }
function splitKanaMora(text) { const ch = cps(text), out = []; for (let i = 0; i < ch.length;) { if (i + 1 < ch.length && YOUON.has(ch[i + 1])) { out.push(ch[i] + ch[i + 1]); i += 2; } else { out.push(ch[i]); i++; } } return out; }
function detectOdoriUnit(read) {
  const m = splitKanaMora(cps(read).map((c) => SEION[c] ?? c).join("")), n = m.length;
  if (n < 2) return null;
  for (let p = 1; p <= Math.floor(n / 2); p++) if (m.slice(n - p * 2, n - p).join("|") === m.slice(n - p).join("|")) return p;
  return null;
}
const DAKU = {}; {
  const a = "カキクケコサシスセソタチツテトハヒフヘホかきくけこさしすせそたちつてとはひふへほ", b = "ガギグゲゴザジズゼゾダヂヅデドバビブベボがぎぐげござじずぜぞだぢづでどばびぶべぼ";
  cps(a).forEach((c, i) => { DAKU[c] = cps(b)[i]; });
  for (const [x, y] of [["キ", "ギ"], ["シ", "ジ"], ["チ", "ヂ"], ["ヒ", "ビ"], ["き", "ぎ"], ["し", "じ"], ["ち", "ぢ"], ["ひ", "び"]]) for (const s of (x < "ァ" ? "ゃゅょ" : "ャュョ")) DAKU[x + s] = y + s;
}
const DAKU_REV = Object.fromEntries(Object.entries(DAKU).map(([k, v]) => [v, k]));
const asNoun = (f) => { f.pos = "名詞"; f.pos_group1 = "一般"; f.pos_group2 = "*"; f.pos_group3 = "*"; f.ctype = "*"; f.cform = "*"; };
function processOdoriFeatures(F, cFrontend) {
  const isDancing = (orig) => orig.length > 0 && cps(orig).every((c) => c === "々");
  const isOdoriji = (orig) => cps(orig).every((c) => "ゝゞヽヾ".includes(c));   // NB: Python `set("") <= {...}` is True for "" too
  const countOdori = (orig) => cps(orig).filter((c) => c === "々").length;
  const isKanjiToken = (t) => t.pos !== "記号" && cps(t.orig).some(isKanji);
  const isSingleKanjiToken = (t) => isKanjiToken(t) && cps(t.orig).length === 1 && isKanji(cps(t.orig)[0]);
  const needsReanalysis = (od, prev, next) => {
    if (countOdori(od.orig) !== 1 || !isKanjiToken(prev)) return [false, "", null];
    const po = cps(prev.orig);
    if (po.length > 1 && isKanji(po[po.length - 1])) return [true, po[po.length - 1], next && isSingleKanjiToken(next) ? next.orig : null];
    return [false, "", null];
  };
  const processOdoriji = (od, prev) => {
    const readChars = splitKanaMora(prev.read); let src = prev.pron.replace(/’/g, ""); if (src === "") src = prev.read;
    const pronChars = splitKanaMora(src), moraPerChar = prev.mora_size / readChars.length;
    const pRead = readChars[readChars.length - 1], pPron = pronChars[pronChars.length - 1];
    let forced = false; for (const c of cps(od.orig)) { if (c === "ゞ" || c === "ヾ") { forced = true; break; } if (c === "ゝ" || c === "ヽ") break; }
    const single = !cps(pRead).some((c) => YOUON.has(c));
    if (forced) { od.read = DAKU[pRead] || pRead; od.pron = DAKU[pPron] || pPron; }
    else if (single) { od.read = DAKU_REV[pRead] || pRead; od.pron = DAKU_REV[pPron] || pPron; }
    else { od.read = pRead; od.pron = pPron; }
    od.mora_size = Math.trunc(moraPerChar);
    if (od.pos === "記号") asNoun(od);
    return od;
  };
  let i = 0;
  while (i < F.length) {
    if (isDancing(F[i].orig)) {
      if (i > 0 && cFrontend) {
        const [need, target, nextKanji] = needsReanalysis(F[i], F[i - 1], i + 1 < F.length ? F[i + 1] : null);
        if (need) {
          if (nextKanji !== null) { const an = cFrontend(target + nextKanji); if (an.length > 0) an[0].chain_flag = 1; F.splice(i, 2, ...an); i += an.length; continue; }
          const an = cFrontend(target); F[i] = an[0]; F[i].chain_flag = 1; asNoun(F[i]); i += 1; continue;
        }
      }
      const start = i; let end = i, total = 0;
      while (end < F.length && isDancing(F[end].orig)) { total += countOdori(F[end].orig); end++; }
      if (i > 0 && F[i - 1].orig.endsWith("々")) {
        const prev = F[i - 1], period = detectOdoriUnit(prev.read);
        if (period !== null) {
          const rm = splitKanaMora(prev.read), pm = splitKanaMora(prev.pron);
          if (rm.length >= period && rm.length > 0) {
            const cur = F[i], n = countOdori(cur.orig), unitMora = Math.floor(prev.mora_size / rm.length) * period;
            cur.read = rm.slice(rm.length - period).join("").repeat(n); cur.pron = pm.slice(pm.length - period).join("").repeat(n);
            cur.mora_size = unitMora * n; cur.acc = prev.acc; cur.chain_flag = 1; if (cur.pos === "記号") asNoun(cur);
            i += 1; continue;
          }
        }
      }
      const normal = []; let j = start - 1, collected = 0; const needed = Math.min(total, 8);
      while (j >= 0) {
        const t = F[j];
        if (["記号", "フィラー", "感動詞"].includes(t.pos)) break;
        if (isKanjiToken(t)) { normal.push(t); collected += cps(t.orig).length; if (collected >= needed) break; } else break;
        j--;
      }
      normal.reverse();
      if (!normal.length) { i = end; continue; }
      const singleKanji = normal.length === 1 && cps(normal[0].orig).length === 1;
      const baseRead = singleKanji ? normal[0].read : normal.map((x) => x.read).join(""), basePron = singleKanji ? normal[0].pron : normal.map((x) => x.pron).join("");
      const baseMora = singleKanji ? normal[0].mora_size : normal.reduce((a, x) => a + x.mora_size, 0), baseAcc = normal[0].acc;
      for (let k = start; k < end; k++) {
        const n = countOdori(F[k].orig);
        if (singleKanji) { F[k].read = baseRead.repeat(n); F[k].pron = basePron.repeat(n); F[k].mora_size = baseMora * n; }
        else { F[k].read = baseRead; F[k].pron = basePron; F[k].mora_size = baseMora; }
        F[k].acc = baseAcc; F[k].chain_flag = 1; if (F[k].pos === "記号") asNoun(F[k]);
      }
      i = end;
    } else if (isOdoriji(F[i].orig)) {
      if (i > 0 && F[i - 1].pos !== "記号") {
        let p = i - 1; while (p >= 0) { if (F[p].pos !== "記号" && F[p].mora_size > 0) break; p--; }
        if (p >= 0) F[i] = processOdoriji(F[i], F[p]);
      }
      i += 1;
    } else i += 1;
  }
  return F;
}

// ---- piper_plus_g2p/japanese.py ---------------------------------------------------------------------------------------
function questionType(text) {
  const s = text.trim(), e = (...xs) => xs.some((x) => s.endsWith(x));
  if (e("?!", "！？", "？！")) return "?!";
  if (e("?.", "。？", "？。")) return "?.";
  if (e("?~", "～？", "？～")) return "?~";
  if (e("?", "？")) return "?";
  return "$";
}
const SKIP = new Set(["_", "#", "[", "]", "^", "$", "?", "?!", "?.", "?~"]);
function applyNRules(tokens) {
  const r = tokens.slice(); let next = null;
  for (let i = r.length - 1; i >= 0; i--) {
    const t = r[i];
    if (!SKIP.has(t) && t !== "N") next = t;
    else if (t === "N") {
      if (next === null) r[i] = "N_uvular";
      else if (["m", "my", "b", "by", "p", "py"].includes(next)) r[i] = "N_m";
      else if (["n", "ny", "t", "ty", "d", "dy", "ts", "ch"].includes(next)) r[i] = "N_n";
      else if (["k", "ky", "kw", "g", "gy", "gw"].includes(next)) r[i] = "N_ng";
      else r[i] = "N_uvular";
      next = r[i];
    }
  }
  return r;
}
const RE_PH = /-([^+]+)\+/, RE_PROS = /\/A:([\d-]+)\+([0-9]+)\+([0-9]+)\//;
export function labelsToTokens(labels, text) {
  const tokens = [], prosody = [], q = questionType(text);
  labels.forEach((label, idx) => {
    const m = RE_PH.exec(label); if (!m) return;
    const ph = m[1];
    if (ph === "sil") { if (idx !== 0 && idx === labels.length - 1 && q !== "$") { tokens.push(q); prosody.push(null); } return; }
    if (ph === "pau") { tokens.push("_"); prosody.push(null); return; }
    tokens.push(ph);
    const p = RE_PROS.exec(label);
    if (!p) { prosody.push(null); return; }
    const a1 = parseInt(p[1], 10), a2 = parseInt(p[2], 10), a3 = parseInt(p[3], 10);
    prosody.push([a1, a2, a3]);
    let a2next = -1;
    if (idx < labels.length - 1) { const n = RE_PROS.exec(labels[idx + 1]); a2next = n ? parseInt(n[2], 10) : -1; }
    if (a1 === 0 && a2next === a2 + 1) { tokens.push("]"); prosody.push(null); }
    if (a2 === a3 && a2next === 1) { tokens.push("#"); prosody.push(null); }
    if (a2 === 1 && a2next === 2) { tokens.push("["); prosody.push(null); }
  });
  return { tokens: applyNRules(tokens), prosody };
}

/**
 * Put the MeCab dictionary (four files, given as bytes) into the module's in-memory file system. No network.
 * sys.dic (103 MB) is copied ONCE into the WASM heap and the MEMFS node is pointed at that heap region, so MeCab's
 * mmap(MAP_SHARED) of it is zero-copy: the OpenJTalk heap stays at its initial 160 MB. (Peak while loading = the caller's
 * 103 MB buffer + that heap.) The small files are copied into MEMFS; no reference to any input buffer is kept.
 * Call createJaFrontend() right after this — before anything else could grow the heap and detach the view.
 * @param {object} Module  instantiated Emscripten module (vendor/ojt/ojt.mjs)
 * @param {{sys: Uint8Array, matrix: Uint8Array, char: Uint8Array, unk: Uint8Array}} dict  sys.dic, matrix.bin, char.bin, unk.dic
 * @param {string} [dicDir]
 */
export function mountDictionaryBytes(Module, dict, dicDir = "/dic") {
  Module.FS.mkdir(dicDir);
  for (const [name, bytes] of [["char.bin", dict.char], ["matrix.bin", dict.matrix], ["unk.dic", dict.unk]]) Module.FS.writeFile(`${dicDir}/${name}`, bytes);   // MEMFS copies
  const len = dict.sys.length, ptr = Module._malloc(len);
  if (!ptr) throw new Error("out of memory while loading the Japanese dictionary");
  Module.HEAPU8.set(dict.sys, ptr);
  // FS.createDataFile(..., canOwn) refuses to keep a heap-backed view when memory growth is enabled, so the node is pointed at it directly.
  Module.FS.writeFile(`${dicDir}/sys.dic`, new Uint8Array(0));
  const node = Module.FS.lookupPath(`${dicDir}/sys.dic`).node;
  node.contents = Module.HEAPU8.subarray(ptr, ptr + len); node.usedBytes = len;
  Module.__ojtHeapAtMount = Module.HEAPU8.buffer;
}

/**
 * @param {object} Module   an instantiated Emscripten module of ojt.mjs whose FS already holds the dictionary at `dicDir`
 * @param {string} dicDir   MEMFS directory with char.bin matrix.bin sys.dic unk.dic left-id.def right-id.def pos-id.def rewrite.def
 * @param {{naniModel?: object, emulateSudachiPass?: boolean}} [opts]  naniModel = parsed assets/ja-nani-model.json
 */
export function createJaFrontend(Module, dicDir = "/dic", { naniModel = null, emulateSudachiPass = true } = {}) {
  const call = (name, text) => {
    const n = Module.lengthBytesUTF8(text) + 1, p = Module._malloc(n);
    Module.stringToUTF8(text, p, n);
    try { const r = Module[name](p); if (!r) throw new Error(name + " failed (text too long or MeCab error)"); return Module.UTF8ToString(r); } finally { Module._free(p); }
  };
  { const n = Module.lengthBytesUTF8(dicDir) + 1, p = Module._malloc(n); Module.stringToUTF8(dicDir, p, n); const ok = Module._ojt_init(p); Module._free(p); if (ok !== 1) throw new Error("MeCab dictionary load failed: " + dicDir); }
  if (Module.__ojtHeapAtMount && Module.__ojtHeapAtMount !== Module.HEAPU8.buffer) throw new Error("WASM heap grew while MeCab was loading the zero-copy dictionary; rebuild ojt.wasm with a larger INITIAL_MEMORY");
  { const node = Module.FS.lookupPath(`${dicDir}/sys.dic`).node; node.contents = new Uint8Array(0); node.usedBytes = 0; }   // the mapping stays valid; the file view is no longer needed

  /** == OpenJTalk.run_frontend (C level + the pre-chaining rule pass) */
  function cFrontend(text) {
    const s1 = call("_ojt_stage1", text.replace(/[\t\n\r\0]/g, " "));
    if (!s1) return [];
    return parseNjd(call("_ojt_stage2", dumpNjd(applyOriginalRuleBeforeChaining(parseNjd(s1)))));
  }
  /** == pyopenjtalk.run_frontend(text) with default options, minus Sudachi yomi and the 何 model */
  function runFrontend(text, { vanilla = false } = {}) {
    let F = cFrontend(text);
    if (!vanilla) {
      F = modifyFillerAccent(F); F = predictNaniReading(F, naniModel);
      if (emulateSudachiPass) F = emulateKanjiYomiPass(F);
      F = suppressUnnaturalAuxiliaryULongVowel(F); F = retreatAccNuc(F); F = modifyAccAfterChaining(F);
      F = processOdoriFeatures(F, cFrontend);
    }
    return F;
  }
  /** == pyopenjtalk.extract_fullcontext(text) */
  function extractFullcontext(text, opts) {
    const F = runFrontend(text, opts);
    return F.length ? call("_ojt_labels", dumpNjd(F)).split("\n").filter(Boolean) : [];
  }
  /** == piper_plus_g2p.JapanesePhonemizer.phonemize_with_prosody(text): tokens like "k", "ch", "N_n", "_", "[", "]", "#", "?" */
  function phonemize(text, opts) {
    const clean = Array.from(text).filter((ch) => ch >= " " || "\n\t\r".includes(ch)).join("");
    if (!clean) return { tokens: [], prosody: [] };
    return labelsToTokens(extractFullcontext(clean, opts), clean);
  }
  return { cFrontend, runFrontend, extractFullcontext, phonemize };
}
