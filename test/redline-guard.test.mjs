// 红线守卫：本库只在一个文件里联网、只在一个文件里碰 Cache Storage；别处一律不许。永不用系统 / 云端的语音服务。
// created 2026-10-01 by Claude Fable 5.1（形状抄 internal-reference-window）
// 依据：家族 CLAUDE.md「黄线区」（外接服务白名单）、硬规则 #8 的精神（语音只准本机算）、「云同步 store 库」节（持久化全走宿主）。
// 只扫代码行：注释先剥掉，免得说明文字误伤。
import { describe, it, eq } from "./runner.mjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
function walk(dir) { const out = []; for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) out.push(...walk(p)); else if (p.endsWith(".ts")) out.push(p); } return out; }
function codeOnly(text) { return text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n"); }

/** 整个库都不许出现的。 */
const FORBIDDEN = [
  [/\blocalStorage\b/, "localStorage"], [/\bsessionStorage\b/, "sessionStorage"], [/\bindexedDB\b/, "indexedDB"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"], [/\bWebSocket\b/, "WebSocket"], [/\bEventSource\b/, "EventSource"], [/\bsendBeacon\b/, "sendBeacon"],
  [/\bspeechSynthesis\b/, "speechSynthesis（系统朗读：桌面浏览器会把文字发到服务器）"], [/\bSpeechSynthesisUtterance\b/, "SpeechSynthesisUtterance"],
  [/\bSpeechRecognition\b/, "SpeechRecognition"], [/\bgetUserMedia\b/, "getUserMedia（本库不碰麦克风）"],
];
/** 只准出现在 src/worker/index.ts 的。 */
const WORKER_ONLY = [[/\bfetch\s*\(/, "fetch("], [/\bcaches\s*\./, "caches.（Cache Storage）"]];
const ALLOWED = "worker/index.ts";

describe("红线守卫", () => {
  it("零本地存储 / 零系统语音 / 零别的外发通道", () => {
    const hits = [];
    for (const p of walk(SRC)) { const code = codeOnly(readFileSync(p, "utf8")); for (const [re, why] of FORBIDDEN) if (re.test(code)) hits.push(`${relative(SRC, p)}: ${why}`); }
    eq(hits.join("\n"), "");
  });
  it("联网与 Cache Storage 只在 src/worker/index.ts（下载语音包分片：只读 GET，到手先验）", () => {
    const hits = [];
    for (const p of walk(SRC)) { const rel = relative(SRC, p).replace(/\\/g, "/"); if (rel === ALLOWED) continue; const code = codeOnly(readFileSync(p, "utf8")); for (const [re, why] of WORKER_ONLY) if (re.test(code)) hits.push(`${rel}: ${why}`); }
    eq(hits.join("\n"), "");
  });
  it("分句与连读控制器零 DOM（node 能直接跑）", () => {
    const hits = [];
    for (const f of ["sentences.ts", "read-aloud.ts", "packs.ts", "sha256.ts"]) { const code = codeOnly(readFileSync(join(SRC, f), "utf8")); for (const re of [/\bdocument\b/, /\bwindow\b/, /\bnavigator\b/, /\bAudioContext\b/]) if (re.test(code)) hits.push(`${f}: ${re}`); }
    eq(hits.join("\n"), "");
  });
});
