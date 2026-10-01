// en-g2p.js — English G2P for piper-plus models in the browser, pure JS.
// created 2026-10-01 by Claude Fable 5.1
//
// Why this exists: the piper-plus Rust WASM (npm piper-plus@0.7.0, same at upstream HEAD 82ee4e7) has NO English phonemizer —
// `create_phonemizer("en")` returns PassthroughPhonemizer, i.e. raw letters are fed to the model as if they were phonemes —
// and the JS fallback in @piper-plus/g2p only knows a few hundred built-in words and emits no prosody features.
//
// This is a port of the reference: upstream src/python/g2p/piper_plus_g2p/english.py (phonemize_english_with_prosody),
// with g2p-en replaced by: CMUdict lookup (upstream src/rust/piper-plus-g2p/data/cmudict_data.json, 123,455 words)
//   -> optional homograph table (g2p-en homographs.en) with a crude verb/non-verb guess (g2p-en uses a POS tagger)
//   -> contractions/possessives -> suffix stripping (port of Rust try_morphological_fallback) -> letter rules (upstream JS tables).
// Output tokens/prosody follow the Python reference: stress marks ˈ ˌ before stressed vowels, one token per IPA char,
// prosody a1=0, a2=2/1/0 (primary/secondary/none), a3=IPA chars in the word; function words lose their stress.

const ARPA2IPA = { AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔː", AW: "aʊ", AY: "aɪ", B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "ɛ", ER: "ɚ", EY: "eɪ", F: "f", G: "ɡ", HH: "h", IH: "ɪ", IY: "iː", JH: "dʒ",
  K: "k", L: "l", M: "m", N: "n", NG: "ŋ", OW: "oʊ", OY: "ɔɪ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "uː", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };
const FUNCTION_WORDS = new Set(("a an the i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves they them their theirs themselves " +
  "am is are was were be been being have has had having do does did will would shall should can could may might must at by for from in of on to with about after before between into through under " +
  "and but or nor so yet if that than when while as because since not no").split(" "));
const PUNCT = new Set([",", ".", ";", ":", "!", "?"]);
const VERB_CUES = new Set(("to i you we they he she it who will would shall should can could may might must not don't didn't doesn't won't wouldn't can't couldn't let's please").split(" "));
const PAST_CUES = new Set("have has had having was were been be is are am got get 've 'd".split(" "));
// CMUdict's first pronunciation is the rare reading for these (the Python reference has the same flaw; g2p-en takes cmu[word][0])
const OVERRIDES = { live: "L IH1 V", lives: "L IH1 V Z", lead: "L IY1 D", leads: "L IY1 D Z", wind: "W IH1 N D", winds: "W IH1 N D Z", tear: "T IH1 R", tears: "T IH1 R Z" };
const DIGRAPH_RULES = [["igh", ["AY1"]], ["th", ["TH"]], ["sh", ["SH"]], ["ch", ["CH"]], ["ph", ["F"]], ["wh", ["W"]], ["ck", ["K"]], ["ng", ["NG"]], ["qu", ["K", "W"]], ["oo", ["UW1"]], ["ee", ["IY1"]], ["ea", ["IY1"]],
  ["ai", ["EY1"]], ["ay", ["EY1"]], ["oi", ["OY1"]], ["oy", ["OY1"]], ["ou", ["AW1"]], ["ow", ["OW1"]], ["aw", ["AO1"]], ["au", ["AO1"]]];
const LETTER_RULES = { a: ["AE1"], b: ["B"], c: ["K"], d: ["D"], e: ["EH1"], f: ["F"], g: ["G"], h: ["HH"], i: ["IH1"], j: ["JH"], k: ["K"], l: ["L"], m: ["M"], n: ["N"], o: ["AA1"], p: ["P"], q: ["K"], r: ["R"],
  s: ["S"], t: ["T"], u: ["AH1"], v: ["V"], w: ["W"], x: ["K", "S"], y: ["Y"], z: ["Z"] };

// ---- numbers -> words (subset of g2p-en's expand.py: cardinals, 4-digit years, decimals, ordinals 1st/2nd/3rd/Nth) ----
const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
function cardinal(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + cardinal(n % 100) : "");
  for (const [v, w] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) if (n >= v) return cardinal(Math.floor(n / v)) + " " + w + (n % v ? " " + cardinal(n % v) : "");
  return String(n);
}
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function ordinal(n) { const w = cardinal(n).split(" "), l = w.pop(); w.push(ORD[l] || (l.endsWith("y") ? l.slice(0, -1) + "ieth" : l + "th")); return w.join(" "); }
function expandNumbers(text) {
  return text.replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, d) => ordinal(+d))
    .replace(/\b(\d+)\.(\d+)\b/g, (_, a, b) => cardinal(+a) + " point " + Array.from(b, (c) => ONES[+c]).join(" "))
    .replace(/\b\d+\b/g, (d) => {
      const n = +d;
      if (n > 1000 && n < 3000 && d.length === 4) {   // year-style reading, as g2p-en does
        if (n === 2000) return "two thousand"; if (n > 2000 && n < 2010) return "two thousand " + ONES[n % 100];
        if (n % 100 === 0) return cardinal(n / 100) + " hundred"; if (n % 100 < 10) return cardinal(Math.floor(n / 100)) + " oh " + ONES[n % 100];
        return cardinal(Math.floor(n / 100)) + " " + cardinal(n % 100);
      }
      return n < 1e12 ? cardinal(n) : Array.from(d, (c) => ONES[+c]).join(" ");
    });
}

function morphFallback(word, cmu) {   // port of Rust try_morphological_fallback (== C++ tryMorphologicalFallback)
  const n = word.length, tryBase = (b, suf) => (cmu[b] ? cmu[b] + " " + suf : null), dbl = (b) => b.length >= 2 && b[b.length - 1] === b[b.length - 2];
  let r;
  if (n > 4 && word.endsWith("ing")) { const b = word.slice(0, -3); if ((r = tryBase(b, "IH0 NG")) || (dbl(b) && (r = tryBase(b.slice(0, -1), "IH0 NG"))) || (r = tryBase(b + "e", "IH0 NG"))) return r; }
  if (n > 3 && word.endsWith("ed")) { const b = word.slice(0, -2); if ((r = tryBase(b, "D")) || (dbl(b) && (r = tryBase(b.slice(0, -1), "D"))) || (r = tryBase(word.slice(0, -1), "D"))) return r; }
  if (n > 2 && word.endsWith("s")) {
    if (n > 4 && word.endsWith("ies") && (r = tryBase(word.slice(0, -3) + "y", "Z"))) return r;
    if (n > 3 && word.endsWith("es") && (r = tryBase(word.slice(0, -2), "IH0 Z"))) return r;
    if ((r = tryBase(word.slice(0, -1), "Z"))) return r;
  }
  if (n > 3 && word.endsWith("er")) { const b = word.slice(0, -2); if ((r = tryBase(b, "ER0")) || (dbl(b) && (r = tryBase(b.slice(0, -1), "ER0")))) return r; }
  if (n > 3 && word.endsWith("ly")) { if ((r = tryBase(word.slice(0, -2), "L IY0")) || (n > 4 && word[n - 3] === "i" && (r = tryBase(word.slice(0, -3) + "y", "L IY0")))) return r; }
  if (n > 4 && word.endsWith("est") && (r = tryBase(word.slice(0, -3), "AH0 S T"))) return r;
  return null;
}
function letterRules(word) {
  const out = [];
  for (let i = 0; i < word.length;) {
    const hit = DIGRAPH_RULES.find(([p]) => word.startsWith(p, i));
    if (hit) { out.push(...hit[1]); i += hit[0].length; } else { const a = LETTER_RULES[word[i]]; if (a) out.push(...a); i++; }
  }
  return out;
}
const SIBILANT = new Set(["S", "Z", "SH", "ZH", "CH", "JH"]), VOICELESS = new Set(["P", "T", "K", "F", "TH"]);

/**
 * @param {{cmudict: Record<string,string>, homographs?: Record<string,[string,string,string]>}} data
 *   cmudict: word -> "HH AH0 L OW1";  homographs: word -> [pronIfPos, pronOtherwise, posPrefix] (from g2p-en homographs.en)
 */
export function createEnglishG2p({ cmudict, homographs = null }) {
  const cmu = cmudict;
  function wordToArpabet(word, prev, next) {
    if (OVERRIDES[word]) return OVERRIDES[word].split(" ");
    if (homographs && homographs[word]) {   // g2p-en picks by POS tag; here: crude cues from the neighbouring words
      const [p1, p2, pos] = homographs[word], verbish = VERB_CUES.has(prev || "");
      const pick = pos === "V" ? (verbish ? p1 : p2) : pos === "VBD" ? (PAST_CUES.has(prev || "") ? p2 : p1) : pos === "VBN" ? (next === "to" ? p2 : p1) : (verbish ? p2 : p1);
      return pick.trim().split(" ");
    }
    if (cmu[word]) return cmu[word].split(" ");
    const m = /^(.+)'(s|ll|d|ve|re)$/.exec(word);
    if (m && cmu[m[1]]) {
      const base = cmu[m[1]].split(" "), last = base[base.length - 1].replace(/\d/, "");
      const suf = m[2] === "s" ? (SIBILANT.has(last) ? ["IH0", "Z"] : VOICELESS.has(last) ? ["S"] : ["Z"]) : { ll: ["AH0", "L"], d: ["D"], ve: ["V"], re: ["ER0"] }[m[2]];
      return [...base, ...suf];
    }
    const bare = word.replace(/'/g, "");
    if (bare !== word && cmu[bare]) return cmu[bare].split(" ");
    const mf = morphFallback(bare, cmu);
    return mf ? mf.split(" ") : letterRules(bare);
  }
  function wordToIpa(arpa) {   // [[ipa, stress]] ; stress -1 for consonants
    const out = [];
    for (let i = 0; i < arpa.length; i++) {
      const m = /^([A-Z]+)(\d)?$/.exec(arpa[i]); if (!m) continue;
      const base = m[1], stress = m[2] === undefined ? -1 : +m[2];
      if (base === "AA" && arpa[i + 1] === "R") { out.push(["ɑːɹ", stress]); i++; continue; }
      if (base === "ER" && stress === 1) { out.push(["ɜː", stress]); continue; }
      if (base === "AH" && stress === 0) { out.push(["ə", stress]); continue; }
      if (ARPA2IPA[base]) out.push([ARPA2IPA[base], stress]);
    }
    return out;
  }
  /** -> { tokens: string[], prosody: ([a1,a2,a3]|null)[] }  (punctuation tokens , . ; : ! ? are emitted like the reference; the encoder drops what the model has no id for) */
  function phonemize(text) {
    let t = expandNumbers(String(text)).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[‘’]/g, "'").replace(/[-‐-―]/g, " ");
    t = t.replace(/[^ a-z'.,?!;:]/g, " ").replace(/i\.e\./g, "that is").replace(/e\.g\./g, "for example");
    const raw = t.match(/[a-z']+|[.,?!;:]/g) || [];
    const tokens = [], prosody = []; let needSpace = false, prev = "";
    for (let ri = 0; ri < raw.length; ri++) {
      let w = raw[ri];
      if (PUNCT.has(w)) { if (w !== ";" && w !== ":") { tokens.push(w); prosody.push([0, 0, 1]); } needSpace = true; continue; }   // reference: punctuation is a 1-phoneme "word"; g2p-en strips ; :
      w = w.replace(/^'+|'+$/g, ""); if (!w) continue;
      if (needSpace) { tokens.push(" "); prosody.push([0, 0, 0]); }
      let ipas = wordToIpa(wordToArpabet(w, prev, raw[ri + 1]));
      if (FUNCTION_WORDS.has(w)) ipas = ipas.map(([ipa, s]) => [ipa, s >= 1 ? 0 : s]);
      const count = ipas.reduce((a, [ipa]) => a + Array.from(ipa).length, 0);
      for (const [ipa, s] of ipas) {
        const a2 = s === 1 ? 2 : s === 2 ? 1 : 0;
        if (s === 1) { tokens.push("ˈ"); prosody.push([0, a2, count]); } else if (s === 2) { tokens.push("ˌ"); prosody.push([0, a2, count]); }
        for (const ch of ipa) { tokens.push(ch); prosody.push([0, a2, count]); }
      }
      needSpace = true; prev = w;
    }
    return { tokens, prosody };
  }
  return { phonemize, wordToArpabet };
}

export { encodeTokens } from "./encode.js";
