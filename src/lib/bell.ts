// 番茄/休息结束铃声 —— PRD §5.7
// 播放打包的铃声音频；播放失败时静默降级（§8.8-5）。
//
// WKWebView / 移动端自动播放限制：首次 play() 必须在用户手势内触发，
// 后续 play() 同一 Audio 元素则不受此限制。
// 因此 `primeBell()` 在计时器 start/resume 的手势内调用以"解锁"，
// `playBell()` 在倒计时结束时调用（此时同一元素可重播）。

import bellUrl from '@/assets/bell.mp3';

let bell: HTMLAudioElement | null = null;
let primed = false;

function getBell(): HTMLAudioElement {
  if (!bell) {
    bell = new Audio(bellUrl);
    bell.preload = 'auto';
  }
  return bell;
}

/**
 * 在用户手势内预加载铃声（解锁自动播放）。
 * 在计时器 start / resume 时调用一次即可。
 */
export function primeBell(): void {
  if (primed) return;
  try {
    const el = getBell();
    // 立即播放后暂停，在 WKWebView 中"解锁"此元素的自动播放权限
    const p = el.play();
    if (p) {
      p.then(() => {
        el.pause();
        el.currentTime = 0;
        primed = true;
      }).catch(() => {
        // 预加载失败 — 静默忽略，playBell 仍将尝试播放
        primed = true;
      });
    } else {
      primed = true;
    }
  } catch { primed = true; }
}

/** 播放结束铃声（可重复调用，自动打断上一次） */
export function playBell(): void {
  try {
    const el = getBell();
    el.currentTime = 0;
    const p = el.play();
    if (p) p.catch(() => { /* 自动播放被拦阻，静默降级 */ });
  } catch { /* 静默降级 */ }
}