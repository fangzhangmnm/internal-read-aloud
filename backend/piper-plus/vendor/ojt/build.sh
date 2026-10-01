#!/usr/bin/env bash
# build.sh — compile pyopenjtalk-plus 0.4.1.post9's OpenJTalk frontend (C/C++) + ojt_wasm.c to WebAssembly (single-thread, ES module).
# created 2026-10-01 by Claude Fable 5.1.   usage: ./build.sh   (needs ../emsdk installed; no sudo, no GPU)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../pyopenjtalk_plus-0.4.1.post9/lib/open_jtalk/src"
source "$HERE/../../emsdk/emsdk_env.sh" >/dev/null 2>&1
mkdir -p "$HERE/build" "$HERE/dist"
# 1) libopenjtalk.a via the fork's own CMakeLists (generates mecab/src/config.h for the wasm32 target)
emcmake cmake -S "$SRC" -B "$HERE/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_PROGRAMS=OFF -DCMAKE_C_FLAGS="-O2" -DCMAKE_CXX_FLAGS="-O2" >/dev/null
cmake --build "$HERE/build" -j4 2>&1 | tail -3
# 2) link the wrapper
INC=""; for d in jpcommon mecab/src mecab2njd njd njd2jpcommon njd_set_accent_phrase njd_set_accent_type njd_set_digit njd_set_long_vowel njd_set_pronunciation njd_set_unvoiced_vowel text2mecab; do INC="$INC -I$SRC/$d"; done
emcc -O2 $INC -c "$HERE/ojt_wasm.c" -o "$HERE/build/ojt_wasm.o"
# two JS glue flavours around the same code: dist/ (web + worker + node, used by the node parity tests) and
# dist-web/ (web + worker only: no node:* imports, so a bundler can inline it into a worker file)
for flavour in "dist:web,worker,node" "dist-web:web,worker"; do
  out="${flavour%%:*}"; env="${flavour##*:}"; mkdir -p "$HERE/$out"
  em++ -O2 "$HERE/build/ojt_wasm.o" "$HERE/build/libopenjtalk.a" -o "$HERE/$out/ojt.mjs" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=$env -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=167772160 -sMAXIMUM_MEMORY=1073741824 \
    -sFORCE_FILESYSTEM=1 -sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr -sEXPORTED_FUNCTIONS=_ojt_init,_ojt_stage1,_ojt_stage2,_ojt_labels,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=FS,ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8 -sSTACK_SIZE=1048576
done
ls -la "$HERE/dist" "$HERE/dist-web"; sha256sum "$HERE"/dist*/ojt.wasm
