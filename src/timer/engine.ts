// 计时引擎 —— PRD §7.1 状态机 + §8.8-1 计时可靠性。
//
// 关键约定：剩余时间一律由绝对时间戳推导（remaining = end_at - now），
// 禁止 setInterval 累加计数，因此跨休眠 / CPU 阻塞 / 进程重启均不漂移。

import type { TimerMode, TimerPhase, TimerState } from '@/types';

export function phaseDurationMs(
  phase: TimerPhase,
  mode: TimerMode,
  focusMin: number,
  breakMin: number,
  longBreakMin: number,
  completedPomodoros: number,
  longBreakEvery: number,
): number {
  if (mode === 'stopwatch') return 0;
  if (phase === 'focus') return Math.round(focusMin * 60_000);
  const isLong = longBreakEvery > 0 && completedPomodoros > 0 && completedPomodoros % longBreakEvery === 0;
  return Math.round((isLong ? longBreakMin : breakMin) * 60_000);
}

/** 当前剩余毫秒；正计时模式返回已用毫秒 */
export function remainingMs(state: TimerState, now: number): number {
  if (state.mode === 'stopwatch') {
    // 暂停中必须返回已冻结的已用时（paused_remaining_ms），否则暂停后仍随 now 增长
    if (state.running) return state.start_at ? Math.max(0, now - state.start_at) : 0;
    return state.paused_remaining_ms ?? 0;
  }
  if (state.running && state.end_at !== null) return Math.max(0, state.end_at - now);
  if (state.paused_remaining_ms !== null) return state.paused_remaining_ms;
  return 0;
}

export function isExpired(state: TimerState, now: number): boolean {
  if (!state.running || state.mode === 'stopwatch') return false;
  return state.end_at !== null && now >= state.end_at;
}

/** 开始 / 继续 */
export function startState(state: TimerState, durationMs: number, now: number): TimerState {
  const remaining = state.paused_remaining_ms ?? durationMs;
  if (state.mode === 'stopwatch') {
    // 正计时恢复：把已冻结的已用时折算回 start_at，否则暂停期间会被算进专注时长
    const startAt = state.start_at === null ? now : now - (state.paused_remaining_ms ?? 0);
    return { ...state, running: true, start_at: startAt, end_at: null, paused_remaining_ms: null };
  }
  return {
    ...state,
    running: true,
    start_at: state.start_at ?? now,
    end_at: now + remaining,
    paused_remaining_ms: null,
  };
}

export function pauseState(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  return {
    ...state,
    running: false,
    end_at: null,
    paused_remaining_ms: remainingMs(state, now),
  };
}

/** 切换到新阶段（未开始） */
export function idlePhase(state: TimerState, phase: TimerPhase, durationMs: number): TimerState {
  return {
    ...state,
    phase,
    running: false,
    start_at: null,
    end_at: null,
    paused_remaining_ms: durationMs,
  };
}

/** 格式化 MM:SS（正计时显示已用时间） */
export function displayMs(state: TimerState, now: number, fallbackMs: number): number {
  if (state.mode === 'stopwatch') {
    if (state.running) return state.start_at ? Math.max(0, now - state.start_at) : 0;
    // 暂停中：显示冻结的已用时，而不是随 now 继续增长
    return state.paused_remaining_ms ?? 0;
  }
  // ⚠️ 原先这里只有 `phase === 'idle' && paused_remaining_ms === null` 才回退
  // 到 fallback，但 setMode() 把 idle 的 paused_remaining_ms 设成了 focus_len_min，
  // 所以切换模式后显示的永远是「番茄钟 25:00」而不是目标的 00:00。
  // 修：phase === 'idle' 一律回退（计时还没启动，显示目标时长才有意义）。
  if (state.phase === 'idle' && !state.running) return fallbackMs;
  return remainingMs(state, now);
}
