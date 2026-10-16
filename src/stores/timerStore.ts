// 番茄钟状态机 —— PRD §7.1 / §8.8。
// 计时基于绝对时间戳（end_at），前端仅负责渲染 remaining = end_at - now。

import { create } from 'zustand';
import { api, isTauri, subscribe } from '@/api';
import { useUiStore } from '@/stores/uiStore';
import { emit } from '@/api/events';
import { ensureSystemPermission, systemNotify } from '@/lib/systemNotify';
import { primeBell, playBell } from '@/lib/bell';
import { tStatic } from '@/i18n';
import type { Settings, TimerMode, TimerPhase, TimerState } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import {
  displayMs, idlePhase, isExpired, pauseState, phaseDurationMs, remainingMs, startState,
} from '@/timer/engine';

interface TimerStoreState {
  settings: Settings;
  state: TimerState;
  now: number;
  completedPomodoros: number; // 本轮会话内已完成的专注数（决定长休息）
  screenOpen: boolean;
  /** 启动时是否存在未完成/已结算的上一次会话（触发恢复提示，timer.md ★1） */
  wasRestored: boolean;
  /** 阶段结束的短暂反馈文案（timer.md ★2，展示后自动清除） */
  feedback: string | null;
  /** Tauri 运行时由 Rust `timer://tick` 提供的权威剩余毫秒（PRD §8.5） */
  rustRemaining: number | null;

  init(): Promise<void>;
  setSettings(s: Settings): void;
  openScreen(v: boolean): void;
  clearRestored(): void;
  setFeedback(f: string | null): void;

  start(): void;
  pause(): void;
  resume(): void;
  toggleRun(): void;
  skip(): void;
  reset(): void;

  setTask(taskId: string | null): void;
  setMode(mode: TimerMode): void;

  /** 由 tick 调用：检查阶段是否结束 */
  checkExpiry(): Promise<void>;
  durationFor(phase: TimerPhase): number;
  displayMs(): number;
  remainingMs(): number;
}

let tickHandle: ReturnType<typeof setInterval> | null = null;
let persistCounter = 0;

export const useTimerStore = create<TimerStoreState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  state: {
    phase: 'idle', mode: 'pomodoro', task_id: null, running: false,
    start_at: null, end_at: null, paused_remaining_ms: null,
  },
  now: Date.now(),
  completedPomodoros: 0,
  screenOpen: false,
  wasRestored: false,
  feedback: null,
  rustRemaining: null,

  async init() {
    const [settings, saved] = await Promise.all([api.get_settings(), api.get_timer_state()]);
    const now = Date.now();

    // §7.1 退出/重启恢复：仍在计时则继续；若在关闭期间已到期则结算该阶段
    let restored: TimerState = saved;
    if (saved.running && saved.mode !== 'stopwatch' && saved.end_at !== null) {
      if (saved.end_at <= now) {
        if (saved.phase === 'focus') {
          await finalizeFocus(saved, settings);
          restored = idlePhase(saved, 'break', phaseDurationMs('break', saved.mode, settings.focus_len_min, settings.break_len_min, settings.long_break_len_min, 1, settings.long_break_every));
          emit('timer://finished', { phase: 'focus', taskId: saved.task_id });
          playBell(); // 应用启动时若已到期则补播铃声（被自动播放策略拦阻则静默跳过）
        } else {
          restored = idlePhase(saved, 'focus', phaseDurationMs('focus', saved.mode, settings.focus_len_min, settings.break_len_min, settings.long_break_len_min, 0, settings.long_break_every));
        }
        await api.set_timer_state(restored);
      }
    }

    set({
      settings,
      state: restored,
      now,
      completedPomodoros: 0,
      screenOpen: restored.running || restored.phase !== 'idle',
      wasRestored: saved.running || saved.phase !== 'idle',
    });
    // 恢复计时后重新显示悬浮小窗
    if (restored.running || restored.phase !== 'idle') {
      useUiStore.getState().setFloatVisible(true);
    }
    // 若系统通知已开启，尽力获取授权（运行一次）
    if (settings.notify_enabled && settings.system_notify) void ensureSystemPermission();

    // 时钟源：Tauri 下由 Rust timer_engine 广播 `timer://tick`（PRD §8.5）；
    // 浏览器下使用本地 250ms 脉冲。两者都只提供"当前时间"，阶段切换仍由前端
    // 状态机单属主执行，避免重复归档。
    if (!tickHandle) {
      let trayCounter = 0;
      const updateTray = () => {
        // 节流：每 4 次 tick（约 1 秒）更新一次菜单栏倒计时
        if (trayCounter++ % 4 !== 0) return;
        const { state } = get();
        const s = get().settings;
        const ms = displayMs(state, Date.now(), s.focus_len_min * 60_000);
        const running = state.running && state.phase !== 'idle';
        // 固定宽度 MM:SS 格式（零填充），避免菜单栏宽度跳动
        const mins = String(Math.floor(ms / 60000)).padStart(2, '0');
        const secs = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
        const label = running ? `${mins}:${secs}` : '';
        void api.update_tray_title(label);
        // 图标颜色：红=专注 蓝=休息
        void api.set_tray_phase(state.phase === 'break' ? 'break' : 'focus');
      };
      if (isTauri()) {
        tickHandle = subscribe('timer://tick', (payload) => {
          const p = payload as { phase?: string; running?: boolean; remaining_ms?: number } | null;
          if (!p) return;
          set({ now: Date.now(), rustRemaining: p.remaining_ms ?? null });
          void get().checkExpiry();
          updateTray();
        }) as unknown as ReturnType<typeof setInterval>;
      } else {
        tickHandle = setInterval(() => {
          set({ now: Date.now(), rustRemaining: null });
          void get().checkExpiry();
          updateTray();
        }, 250);
      }
    }
  },

  setSettings(settings) { set({ settings }); },
  openScreen: (screenOpen) => set({ screenOpen }),
  clearRestored: () => set({ wasRestored: false }),
  setFeedback: (feedback) => set({ feedback }),

  start() {
    const { state } = get();
    const dur = get().durationFor(state.phase === 'idle' ? 'focus' : state.phase);
    const next: TimerState = {
      ...startState(state, dur, Date.now()),
      phase: state.phase === 'idle' ? 'focus' : state.phase,
    };
    set({ state: next, now: Date.now(), screenOpen: true });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
    primeBell();  // 在用户手势内解锁铃声，确保结束后可播放
    useUiStore.getState().setFloatVisible(true);
  },

  pause() {
    const next = pauseState(get().state, Date.now());
    set({ state: next });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
  },

  resume() {
    const { state } = get();
    if (state.running) return;
    const next = startState(state, get().durationFor(state.phase), Date.now());
    set({ state: next, now: Date.now() });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
    primeBell();
    useUiStore.getState().setFloatVisible(true);
  },

  toggleRun() {
    const { state } = get();
    if (state.running) get().pause();
    else if (state.phase === 'idle') get().start();
    else get().resume();
  },

  /** 跳过：不写记录，直接切换阶段（PRD §7.1） */
  skip() {
    const { state, settings } = get();
    const nextPhase: TimerPhase = state.phase === 'focus' ? 'break' : 'focus';
    const next = idlePhase(state, nextPhase, phaseDurationMs(
      nextPhase, state.mode, settings.focus_len_min, settings.break_len_min,
      settings.long_break_len_min, get().completedPomodoros, settings.long_break_every,
    ));
    set({ state: next });
    void api.set_timer_state(next);
  },

  reset() {
    const { state, settings } = get();
    const next = idlePhase({ ...state, phase: 'idle' }, 'focus', Math.round(settings.focus_len_min * 60_000));
    set({ state: next });
    void api.set_timer_state(next);
  },

  setTask(taskId) {
    const next = { ...get().state, task_id: taskId };
    set({ state: next });
    void api.set_timer_state(next);
  },

  setMode(mode) {
    const { settings } = get();
    const next = idlePhase({ ...get().state, mode }, 'idle', Math.round(settings.focus_len_min * 60_000));
    set({ state: next });
    void api.set_timer_state(next);
  },

  async checkExpiry() {
    const { state } = get();
    const now = Date.now();
    if (!isExpired(state, now)) {
      // 运行中定期落盘，保证崩溃/强退后可恢复（PRD §8.8-1）
      if (state.running && ++persistCounter % 40 === 0) void api.set_timer_state(state);
      return;
    }
    persistCounter = 0;
    const { settings } = get();

    if (state.phase === 'focus') {
      await finalizeFocus(state, settings);
      const done = get().completedPomodoros + 1;
      set({ completedPomodoros: done, feedback: tStatic('timer.feedback.focusDone') });
      const breakDur = phaseDurationMs('break', state.mode, settings.focus_len_min, settings.break_len_min, settings.long_break_len_min, done, settings.long_break_every);
      const next = settings.auto_start_next
        ? startState(idlePhase(state, 'break', breakDur), breakDur, Date.now())
        : idlePhase(state, 'break', breakDur);
      set({ state: next });
      await api.set_timer_state(next);
      emit('timer://finished', { phase: 'focus', taskId: state.task_id });
      void notify('focus_done', tStatic('notif.focusDoneTitle'), tStatic('notif.focusDoneBody'), settings);
      playBell();
      useUiStore.getState().setFloatVisible(true);
    } else if (state.phase === 'break') {
      set({ feedback: tStatic('timer.feedback.breakDone') });
      const focusDur = phaseDurationMs('focus', state.mode, settings.focus_len_min, settings.break_len_min, settings.long_break_len_min, 0, settings.long_break_every);
      const next = settings.auto_start_next
        ? startState(idlePhase(state, 'focus', focusDur), focusDur, Date.now())
        : idlePhase(state, 'focus', focusDur);
      set({ state: next });
      await api.set_timer_state(next);
      emit('timer://finished', { phase: 'break', taskId: state.task_id });
      void notify('break_done', tStatic('notif.breakDoneTitle'), tStatic('notif.breakDoneBody'), settings);
      playBell();
      useUiStore.getState().setFloatVisible(true);
    }
  },

  durationFor(phase) {
    const s = get().settings;
    return phaseDurationMs(phase, get().state.mode, s.focus_len_min, s.break_len_min, s.long_break_len_min, get().completedPomodoros, s.long_break_every);
  },

  displayMs() {
    const { state, now, rustRemaining } = get();
    // Tauri 下优先采用 Rust 侧计算的剩余毫秒（跨进程一致）
    if (isTauri() && rustRemaining !== null && state.running && state.mode !== 'stopwatch') {
      return rustRemaining;
    }
    const fallback = get().durationFor(state.phase === 'idle' ? 'focus' : state.phase);
    return displayMs(state, now, fallback);
  },

  remainingMs() { return remainingMs(get().state, get().now); },
}));

/** FOCUS 倒计时结束 → 写入 focus_record（PRD §7.1 / FR-P5） */
async function finalizeFocus(state: TimerState, settings: Settings) {
  const endAt = state.end_at ?? Date.now();
  const startAt = state.start_at ?? endAt - settings.focus_len_min * 60_000;
  const durationMin = Math.max(1, Math.round((endAt - startAt) / 60_000));
  await api.create_focus_record({
    taskId: state.task_id,
    startAt,
    endAt,
    durationMin,
  });
}

async function notify(type: string, title: string, body: string, settings: Settings) {
  await api.create_notification({ type, title, body });
  if (!settings.notify_enabled || !settings.system_notify) return;
  if (await ensureSystemPermission()) systemNotify(title, body);
}
