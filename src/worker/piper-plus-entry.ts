// 朗读 worker 入口（piper-plus 引擎）。宿主把本文件单独打成一个 **module** worker 脚本（esbuild --bundle --format=esm）——
// onnxruntime-web 的胶水是 ES module。门面那头 workers 里写 { url, type: "module" }。created 2026-10-01 by Claude Fable 5.1
import { startWorker } from "./runtime.ts";
import { createPiperPlusBackendAdapter } from "./piper-plus.ts";

startWorker({ "piper-plus": createPiperPlusBackendAdapter });
