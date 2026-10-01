// 喇叭：Web Audio 版（把一段 PCM 播出来）。created 2026-10-01 by Claude Fable 5.1
//
// iOS / Safari 的规矩：AudioContext 必须在用户手势里创建或恢复。合成是异步的，等声音算好再建就晚了——
// 所以宿主要在点击处理函数里**同步**调一次 unlock()，之后 play 随时可以。
// 这是「亮屏朗读」的喇叭：屏幕锁了、页面进后台，浏览器会把 AudioContext 挂起（锁屏连读不在这一版的承诺里）。
import type { AudioSink, Clip, Playback } from "./read-aloud.ts";

export interface WebAudioSink extends AudioSink {
  /** 在用户手势里同步调用：建 / 恢复 AudioContext。重复调用无害。 */
  unlock(): void;
  /** 放掉 AudioContext（宿主退出朗读时调；之后再 unlock 会重建）。 */
  close(): void;
}

export function createWebAudioSink(): WebAudioSink {
  let ctx: AudioContext | null = null;
  const ensure = (): AudioContext => {
    if (!ctx || ctx.state === "closed") {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    return ctx;
  };
  return {
    unlock() { const c = ensure(); if (c.state === "suspended") void c.resume().catch(() => { /* 不在手势里：下次手势再试 */ }); },
    close() { const c = ctx; ctx = null; if (c && c.state !== "closed") void c.close().catch(() => { /* ignore */ }); },
    play(clip: Clip): Playback {
      const c = ensure();
      const buf = c.createBuffer(1, clip.samples.length, clip.sampleRate);
      buf.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
      const src = c.createBufferSource();
      src.buffer = buf; src.connect(c.destination);
      let settle: (ok: boolean) => void = () => {};
      let settled = false;
      const done = new Promise<boolean>((r) => { settle = (ok) => { if (!settled) { settled = true; r(ok); } }; });
      src.onended = () => settle(true);
      if (c.state === "suspended") void c.resume().catch(() => { /* ignore */ });
      src.start();
      return {
        done,
        stop() { settle(false); try { src.onended = null; src.stop(); } catch { /* 已经停了 */ } },
        pause() { void c.suspend().catch(() => { /* ignore */ }); },
        resume() { void c.resume().catch(() => { /* ignore */ }); },
      };
    },
  };
}
