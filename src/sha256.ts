// 流式 SHA-256。**逐字拷贝自 WebXiaoHeiWu src/asr/sha256.ts**（2026-10-01，Claude Fable 5.1）：语音包分片到手先验再入缓存。
// 两份并存到 WXHW 的识别也改吃本库为止（记账：本库 CLAUDE.md）。改这里的算法 = 两边一起改。原文件头注释如下。
// 流式 SHA-256（纯 TS，字节进十六进制出；update() 可分片喂，O(1) 内存）。
// 用途：模型分片到手先验再入缓存/挂载——对手是「被黑的镜像站」，所以必须是密码学哈希；不用 crypto.subtle.digest
// 是因为它非流式（要整块在内存）且会把「切片大小」绑在内存上（user 2026-09-03 追问后定）。probe/asr/sha256.js 是同一实现的 JS 版。
// created 2026-09-03 by Claude Fable 5.1
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private total = 0;
  private w = new Uint32Array(64);
  private done = false;

  update(bytes: Uint8Array): this {
    if (this.done) throw new Error("Sha256: update after hex()");
    let i = 0; this.total += bytes.length;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, bytes.length);
      this.buf.set(bytes.subarray(0, take), this.bufLen); this.bufLen += take; i = take;
      if (this.bufLen === 64) { this.block(this.buf, 0); this.bufLen = 0; }
    }
    for (; i + 64 <= bytes.length; i += 64) this.block(bytes, i);
    if (i < bytes.length) { this.buf.set(bytes.subarray(i), 0); this.bufLen = bytes.length - i; }
    return this;
  }
  private block(p: Uint8Array, o: number): void {
    const w = this.w, H = this.h;
    for (let t = 0; t < 16; t++, o += 4) w[t] = (p[o]! << 24) | (p[o + 1]! << 16) | (p[o + 2]! << 8) | p[o + 3]!;
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]!, y = w[t - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t]! + w[t]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0]! += a; H[1]! += b; H[2]! += c; H[3]! += d; H[4]! += e; H[5]! += f; H[6]! += g; H[7]! += h;
  }
  hex(): string {
    if (this.done) throw new Error("Sha256: hex() twice");
    const total = this.total;
    const padLen = (this.bufLen < 56 ? 56 - this.bufLen : 120 - this.bufLen) + 8;
    const pad = new Uint8Array(padLen); pad[0] = 0x80;
    const bits = total * 8, hi = Math.floor(bits / 4294967296), lo = bits >>> 0, n = padLen;
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
    this.total -= padLen; this.update(pad); this.done = true;
    return Array.from(this.h, (x) => x.toString(16).padStart(8, "0")).join("");
  }
}

export function sha256Hex(bytes: Uint8Array): string { return new Sha256().update(bytes).hex(); }
