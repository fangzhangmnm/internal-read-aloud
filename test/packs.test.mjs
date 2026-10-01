// 语音包纯函数 + SHA-256 的规格测试。created 2026-10-01 by Claude Fable 5.1
import { createHash } from "node:crypto";
import { describe, it, eq, assert } from "./runner.mjs";
import { assembleFiles, resolvePackPaths } from "../src/packs.ts";
import { Sha256, sha256Hex } from "../src/sha256.ts";

/** 造一个小包：三个文件拼起来按 chunkBytes 切。 */
function fakePack(sizes, chunkBytes) {
  const files = []; let offset = 0; const all = [];
  sizes.forEach((n, i) => { const b = new Uint8Array(n).map((_, k) => (i * 37 + k * 11) & 255); files.push({ path: i === 2 ? `sub/dir/f${i}.bin` : `f${i}.bin`, bytes: n, offset, sha256: "" }); all.push(...b); offset += n; });
  const whole = Uint8Array.from(all); const chunks = [], chunkMeta = [];
  for (let o = 0, k = 0; o < whole.length; o += chunkBytes, k++) { const c = whole.slice(o, o + chunkBytes); chunks.push(c); chunkMeta.push({ name: `chunk-${String(k).padStart(3, "0")}`, bytes: c.length, sha256: "" }); }
  return { manifest: { v: 1, slug: "fake", name: "fake", task: "tts", lang: ["ja"], engine: "sherpa-onnx", engineConfig: {}, files, chunkBytes, chunks: chunkMeta, totalBytes: whole.length, sha256: "", license: { name: "", file: "", sha256: "", attribution: "" } }, chunks, whole };
}

describe("packs/assembleFiles", () => {
  it("分片横跨文件、文件横跨分片都拼得回去", () => {
    const { manifest, chunks, whole } = fakePack([10, 25, 7], 8);
    const files = assembleFiles(manifest, chunks);
    eq(files.length, 3);
    manifest.files.forEach((f, i) => eq(Buffer.from(files[i]).toString("hex"), Buffer.from(whole.slice(f.offset, f.offset + f.bytes)).toString("hex"), f.path));
  });
  it("分片数不对 / 尺寸不对 / 总量不对 → 抛错，不出半截文件", () => {
    const { manifest, chunks } = fakePack([10, 25, 7], 8);
    let threw = 0;
    try { assembleFiles(manifest, chunks.slice(1)); } catch { threw++; }
    try { assembleFiles(manifest, [chunks[0].slice(1), ...chunks.slice(1)]); } catch { threw++; }
    try { assembleFiles({ ...manifest, totalBytes: manifest.totalBytes + 1 }, chunks); } catch { threw++; }
    eq(threw, 3);
  });
});

describe("packs/resolvePackPaths", () => {
  const files = [{ path: "model.onnx" }, { path: "a.fst" }, { path: "b.fst" }, { path: "espeak-ng-data/lang/ja" }].map((f) => ({ ...f, bytes: 1, offset: 0, sha256: "" }));
  it("包里的文件名 / 目录名补目录；逗号表逐项补；别的字符串不动；不改入参", () => {
    const cfg = { m: { model: "model.onnx", dataDir: "espeak-ng-data", provider: "cpu", numThreads: 1, lang: "ja", empty: "" }, ruleFsts: "a.fst, b.fst", mixed: "a.fst,nope.fst" };
    const out = resolvePackPaths(cfg, "/packs/x", files);
    eq(out.m.model, "/packs/x/model.onnx");
    eq(out.m.dataDir, "/packs/x/espeak-ng-data");
    eq(out.m.provider, "cpu"); eq(out.m.lang, "ja"); eq(out.m.numThreads, 1); eq(out.m.empty, "");
    eq(out.ruleFsts, "/packs/x/a.fst,/packs/x/b.fst");
    eq(out.mixed, "a.fst,nope.fst", "partly-unknown list is left alone");
    eq(cfg.m.model, "model.onnx", "input untouched");
  });
});

describe("sha256", () => {
  it("已知向量 + 流式分片喂 == node crypto", () => {
    const enc = new TextEncoder();
    eq(sha256Hex(enc.encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const buf = new Uint8Array(300_000); for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761 + 12345) >>> 24;
    const h = new Sha256(); for (let i = 0; i < buf.length; i += 4097) h.update(buf.subarray(i, Math.min(i + 4097, buf.length)));
    eq(h.hex(), createHash("sha256").update(buf).digest("hex"));
  });
});
