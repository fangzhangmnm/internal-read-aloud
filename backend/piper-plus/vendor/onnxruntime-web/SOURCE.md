# onnxruntime-web (vendored)

> vendored 2026-10-01 by Claude Fable 5.1

- `ort.wasm.bundle.min.mjs` — unmodified copy of `dist/ort.wasm.bundle.min.mjs` from npm `onnxruntime-web@1.30.0`
  (sha256 in `../../pack-layout.json` is for the matching `ort-wasm-simd-threaded.wasm`, which is NOT vendored here: it arrives as bytes).
- Why this flavour: WASM backend only (no WebGPU / WebGL code), and the Emscripten glue is embedded, so with
  `env.wasm.wasmBinary` set and one thread it needs neither a second script nor a fetch.
- Licence: MIT, see `LICENSE` (https://github.com/microsoft/onnxruntime, tag v1.30.0).
