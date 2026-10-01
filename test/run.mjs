// @internal/read-aloud 测试入口（runner 抄 internal-store）。
import { run } from "./runner.mjs";
import "./sentences.test.mjs";
import "./read-aloud.test.mjs";
import "./packs.test.mjs";
import "./clauses.test.mjs";
import "./redline-guard.test.mjs";
run();
