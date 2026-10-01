# OpenJTalk text frontend, WebAssembly glue (vendored)

> vendored 2026-10-01 by Claude Fable 5.1

- `ojt.mjs` — Emscripten 6.0.10 glue, built by `build.sh` from `ojt_wasm.c` + the OpenJTalk sources inside the
  pyopenjtalk-plus 0.4.1.post9 sdist (PyPI, sha256 cdcb0746659857554c6dad23956cad77e21f76c9f3dfa000ea2f8d4f0ba11d99).
  Flavour: `-sENVIRONMENT=web,worker` (no node imports), `-sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr`,
  160 MB initial heap. The matching `ojt.wasm` (sha256 5fb514244d16f4d5aa0027c742e45445f266cf3d955658e2f9dd50d737c0cce6) is not
  vendored: it arrives as bytes (`ja/ojt.wasm`).
- `ojt_wasm.c`, `build.sh` — copies of the wrapper source and build script (originals in `../../../ojt/wasm/`).
- Licences: `COPYING.open_jtalk` (Modified BSD), `COPYING.mecab` (BSD), `LICENSE.pyopenjtalk-plus.md` (MIT).
