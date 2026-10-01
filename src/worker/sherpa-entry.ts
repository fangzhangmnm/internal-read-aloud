// 朗读 worker 入口（sherpa-onnx 引擎）。宿主把本文件单独打成一个 **classic** worker 脚本（esbuild --format=iife）——
// sherpa 的 emscripten 胶水要用 importScripts 装。created 2026-10-01 by Claude Fable 5.1
import { startWorker } from "./runtime.ts";
import { createSherpaBackend } from "./sherpa.ts";

startWorker({ "sherpa-onnx": createSherpaBackend });
