import { activeAttempt, isQuestBinding } from '@/lib/quests/model';
import { useQuestStore } from '@/stores/questStore';
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
  /** 正在结算记录，临时禁止冲突的计时操作。 */
  settling: boolean;
  /** 启动时是否存在未完成/已结算的上一次会话（触发恢复提示，timer.md ★1） */
  wasRestored: boolean;
  /** 阶段结束的短暂反馈文案（timer.md ★2，展示后自动清除） */
  feedback: string | null;
  /** Tauri 运行时由 Rust `timer://tick` 提供的权威剩余毫秒（PRD §8.5） */
  rustRemaining: number | null;

  /**
   * @param opts.openScreen 启动后是否展开专注界面。省略 = 恢复既有会话时自动展开；
   *   传 false = 启动页选了某个侧边栏页面，不覆盖该页面。
   */
  init(opts?: { openScreen?: boolean }): Promise<void>;
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
  stop(): void;

  finishQuestSession(binding: string): Promise<void>;
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
// 结算单属主锁：阶段到期的归档 + 切段必须严格一次。tick 每 250ms 触发，
// 而归档要走 IDB / Tauri IPC 往返，若不加锁，第二次 tick 会在首次 await 未完成时
// 再次判定 isExpired → 重复写 focus_record（PRD §7.1 / 架构文档"单属主归档"）。
let expiryBusy = false;
// init 幂等：React StrictMode 下 effect 会双跑，重复 init 会在恢复路径重复归档。
let inited = false;

export const useTimerStore = create<TimerStoreState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  state: {
    phase: 'idle', mode: 'pomodoro', task_id: null, running: false,
    start_at: null, end_at: null, paused_remaining_ms: null,
  },
  now: Date.now(),
  completedPomodoros: 0,
  screenOpen: false,
  settling: false,
  wasRestored: false,
  feedback: null,
  rustRemaining: null,

  async init(opts?: { openScreen?: boolean }) {
    if (inited) return;
    inited = true;
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
      // 启动页为某个侧边栏页面时不自动展开专注界面；否则恢复既有会话时展开。
      // 非 running 且非 idle 的「已结算待开始」状态仍展开（那是 §7.1 的恢复提示）。
      screenOpen: opts?.openScreen === false
        ? false
        : restored.running || restored.phase !== 'idle',
      // 仅在"已结算并停在下一个未开始阶段"时提示恢复。若会话仍在自己跑，提示条上的
      // 「继续下一阶段」会 skip 掉正在进行的专注（不写记录），是破坏性误导。
      wasRestored: !restored.running && restored.phase !== 'idle',
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

  setSettings(settings) {
    const previous = get().settings;
    set({ settings });
    // 专注/休息时长被改动后，未开始的会话要按新时长重算剩余，否则 start() 会用
    // 旧 paused_remaining_ms（旧时长）启动，设置里的时长改动不生效（PRD FR-S4）。
    const { state } = get();
    if (!expiryBusy && !state.running && state.phase === 'idle'
      && idleDurationFor(state.mode, previous) !== idleDurationFor(state.mode, settings)) {
      const next = idlePhase(state, 'focus', idleDurationFor(state.mode, settings));
      set({ state: next });
      void api.set_timer_state(next);
      emit('timer://state-changed', next);
    }
  },
  openScreen: (screenOpen) => set({ screenOpen }),
  clearRestored: () => set({ wasRestored: false }),
  setFeedback: (feedback) => set({ feedback }),

  start() {
    if (expiryBusy) return;
    const { state } = get();
    if (isQuestBinding(state.task_id) && !activeAttempt(useQuestStore.getState().data, state.task_id, Date.now())) return;
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
    if (expiryBusy) return;
    const next = pauseState(get().state, Date.now());
    set({ state: next });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
  },

  resume() {
    if (expiryBusy) return;
    const { state } = get();
    if (state.running) return;
    if (isQuestBinding(state.task_id) && !activeAttempt(useQuestStore.getState().data, state.task_id, Date.now())) return;
    const next = startState(state, get().durationFor(state.phase), Date.now());
    set({ state: next, now: Date.now() });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
    primeBell();
    useUiStore.getState().setFloatVisible(true);
  },

  toggleRun() {
    if (expiryBusy) return;
    const { state } = get();
    if (state.running) get().pause();
    else if (state.phase === 'idle') get().start();
    else get().resume();
  },

  /** 跳过：写已专注时长并切换阶段（PRD §7.1）。
   *  正计时（stopwatch）没有「休息」概念，skip 退化为重置到未开始；
   *  倒计时（countdown）同理 —— 到期由 checkExpiry 自动处理，skip 只负责手动收尾。
   *  番茄钟「专注中跳过」：仍把**已经实际专注的时长**（now − start_at，暂停段已排除）
   *  记为 focus_record，即便不满一个番茄钟 —— 这是用户需求（2026-10-29）。不足 1 分钟丢弃。 */
  async skip() {
    if (expiryBusy) return;
    expiryBusy = true;
    set({ settling: true });
    try {
      const { state, settings } = get();
      // 只有番茄钟有「专注 → 休息」循环；倒计时与正计时跳过 = 重置到未开始
      if (state.mode !== 'pomodoro') {
        const next = idlePhase(state, 'idle', idleDurationFor(state.mode, settings));
        set({ state: next });
        void api.set_timer_state(next);
        emit('timer://state-changed', next);
        return;
      }
      // 专注中（或已开始）跳过：先把已专注时长落库，再进休息
      if (state.phase === 'focus' && state.start_at !== null) {
        await recordSkippedFocus(state);
      }
      const nextPhase: TimerPhase = state.phase === 'focus' ? 'break' : 'focus';
      const next = idlePhase(state, nextPhase, phaseDurationMs(
        nextPhase, state.mode, settings.focus_len_min, settings.break_len_min,
        settings.long_break_len_min, get().completedPomodoros, settings.long_break_every,
      ));
      set({ state: next });
      void api.set_timer_state(next);
      emit('timer://state-changed', next);  // 托盘「开始/暂停」文案依赖此事件
      // 跳过落库后刷新一次今日专注/任务列表（与 stop() 一致），否则侧边栏/今日面板要等外部刷新
      try { const { useDataStore } = await import('@/stores/dataStore'); useDataStore.getState().reload(); } catch { /* noop */ }
    } finally { expiryBusy = false; set({ settling: false }); }
  },

  /** 正计时停止：保存实际已用时（含暂停后结束），再回到 idle。
   *  番茄钟/倒计时不调这里（由 checkExpiry 自动结算）。 */
  async stop() {
    if (expiryBusy) return;
    const { state, settings } = get();
    if (state.mode !== 'stopwatch' || state.phase !== 'focus' || state.start_at === null) {
      get().reset(); return;
    }
    expiryBusy = true;
    set({ settling: true });
    try {
      const recorded = await recordSkippedFocus(state);
      const next = idlePhase(state, 'idle', idleDurationFor('stopwatch', settings));
      set({ state: next, feedback: tStatic(recorded ? 'timer.feedback.focusDone' : 'timer.feedback.tooShort') });
      await api.set_timer_state(next);
      emit('timer://state-changed', next);
      playBell();
      try { const { useDataStore } = await import('@/stores/dataStore'); void useDataStore.getState().reload(); } catch { /* noop */ }
    } finally { expiryBusy = false; set({ settling: false }); }
  },

  reset() {
    if (expiryBusy) return;
    const { state, settings } = get();
    const next = idlePhase({ ...state, phase: 'idle' }, 'focus', idleDurationFor(state.mode, settings));
    set({ state: next });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
  },

  async finishQuestSession(binding) {
    if (get().state.task_id !== binding) return;
    if (expiryBusy) throw new Error('quest.timerBusy');
    expiryBusy = true;
    set({ settling: true });
    try {
      const { state, settings } = get();
      if (state.phase === 'focus' && state.start_at !== null) await recordSkippedFocus(state);
      const next = idlePhase({ ...state, task_id: null }, 'idle', idleDurationFor(state.mode, settings));
      set({ state: next });
      await api.set_timer_state(next);
      emit('timer://state-changed', next);
    } finally { expiryBusy = false; set({ settling: false }); }
  },

  setTask(taskId) {
    if (expiryBusy) return;
    const current = get().state;
    if (current.task_id !== taskId && isQuestBinding(current.task_id) && current.start_at !== null) return;
    const next = { ...get().state, task_id: taskId };
    set({ state: next });
    void api.set_timer_state(next);
  },

  setMode(mode) {
    if (expiryBusy) return;
    const { settings } = get();
    const next = idlePhase({ ...get().state, mode }, 'idle', idleDurationFor(mode, settings));
    set({ state: next });
    void api.set_timer_state(next);
    emit('timer://state-changed', next);
  },

  async checkExpiry() {
    // 单属主：结算过程中的 tick 必须直接返回，不能在 await 未完成时二次归档
    if (expiryBusy) return;
    const { state } = get();
    const now = Date.now();
    if (isQuestBinding(state.task_id) && !activeAttempt(useQuestStore.getState().data, state.task_id, now)) {
      const next = idlePhase({ ...state, task_id: null }, 'idle', idleDurationFor(state.mode, get().settings));
      set({ state: next });
      await api.set_timer_state(next);
      emit('timer://state-changed', next);
      return;
    }
    if (!isExpired(state, now)) {
      // 运行中定期落盘，保证崩溃/强退后可恢复（PRD §8.8-1）
      if (state.running && ++persistCounter % 40 === 0) void api.set_timer_state(state);
      return;
    }
    persistCounter = 0;
    expiryBusy = true;
    set({ settling: true });
    try {
      const { settings } = get();

      // 倒计时模式（countdown）到期后即停止，不写 focus_record、不自动进入休息，
      // 这是用户明确要求的两种模式之一（25:00 → 00:00）；正计时（stopwatch）
      // 天然不会到期（isExpired 恒为 false），这里不需要处理。
      if (state.mode === 'countdown') {
        set({ feedback: tStatic('timer.feedback.countdownDone') });
        const next = idlePhase(state, 'idle', idleDurationFor('countdown', settings));
        set({ state: next });
        await api.set_timer_state(next);
        emit('timer://finished', { phase: 'focus', taskId: state.task_id, mode: 'countdown' });
        void notify('countdown_done', tStatic('notif.countdownDoneTitle'), tStatic('notif.countdownDoneBody'), settings);
        playBell();
        useUiStore.getState().setFloatVisible(true);
        return;
      }

      // 只有番茄钟模式（phase === 'focus' 且非 countdown/stopwatch）才写记录进休息循环。
      // countdown 上面已 return，stopwatch 的 isExpired 恒为 false（不会走到这里），
      // 由「停止」按钮单独写记录。
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
    } finally {
      // 归档/切段失败时释放锁，下一 tick 重试，但绝不并发两次。
      expiryBusy = false;
      set({ settling: false });
    }
  },

  durationFor(phase) {
    const { state, settings } = get();
    // ⚠️ 原先这里没有处理 countdown（倒计时），phaseDurationMs 的 countdown 分支
    // 只 return focus_len_min，导致切到「倒计时」后 start() 还是按 25 分钟起表，
    // 和「番茄钟」毫无区别。修：countdown 走 focus_len_min 且不参与番茄钟自动休息；
    // 正计时（stopwatch）返回 0（无限，不需要休息循环）。
    if (state.mode === 'countdown') {
      return phaseDurationMs(
        'focus', 'countdown',
        settings.focus_len_min, settings.break_len_min, settings.long_break_len_min,
        get().completedPomodoros, settings.long_break_every,
      );
    }
    return phaseDurationMs(phase, state.mode, settings.focus_len_min, settings.break_len_min, settings.long_break_len_min, get().completedPomodoros, settings.long_break_every);
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

/** 切换到「未开始」时应写入的目标时长：正计时 0（00:00 起）、倒计时与番茄钟为专注时长 */
function idleDurationFor(mode: TimerMode, settings: Settings): number {
  return phaseDurationMs(
    'focus', mode, settings.focus_len_min, settings.break_len_min,
    settings.long_break_len_min, 0, settings.long_break_every,
  );
}

/** FOCUS 结束 → 写入 focus_record（PRD §7.1 / FR-P5）。
 *  返回是否真的落库：正计时由用户随时停止，若不足 1 分钟就按 1 分钟记会把
 *  「点错了马上停」污染成真实专注数据，所以不足 1 分钟直接放弃（PRD 记录粒度是分钟）。 */
async function finalizeFocus(state: TimerState, settings: Settings): Promise<boolean> {
  const endAt = state.end_at ?? Date.now();
  const startAt = state.start_at ?? endAt - settings.focus_len_min * 60_000;
  const durationMin = Math.round((endAt - startAt) / 60_000);
  if (durationMin < 1) return false;
  await saveFocusRecord({
    taskId: state.task_id,
    startAt,
    endAt,
    durationMin,
  });
  return true;
}

/** 专注中途「跳过」时，把已经实际专注的时长落库（PRD §7.1 补充，2026-10-29）。
 *  运行中：时长 = now − start_at（start_at 已按暂停修复把暂停段折算出去，即真实运行时长）；
 *  暂停中：已用时 = 原始阶段时长(end_at−start_at) − paused_remaining_ms。
 *  不足 1 分钟同样丢弃（点错马上跳过不污染数据）。 */
async function recordSkippedFocus(state: TimerState): Promise<boolean> {
  const now = Date.now();
  let activeMs: number;
  if (state.mode === 'stopwatch' && !state.running) {
    activeMs = state.paused_remaining_ms ?? 0;
  } else if (state.running) {
    activeMs = now - (state.start_at ?? now);
  } else if (state.start_at !== null && state.end_at !== null) {
    activeMs = (state.end_at - state.start_at) - (state.paused_remaining_ms ?? 0);
  } else {
    return false; // 从未真正开始（idle 预置态）
  }
  const durationMin = Math.round(activeMs / 60_000);
  if (durationMin < 1) return false;
  const endAt = state.running ? now : (state.start_at as number) + activeMs;
  await saveFocusRecord({
    taskId: state.task_id,
    startAt: state.start_at as number,
    endAt,
    durationMin,
  });
  return true;
}

async function notify(type: string, title: string, body: string, settings: Settings) {
  await api.create_notification({ type, title, body });
  if (!settings.notify_enabled || !settings.system_notify) return;
  if (await ensureSystemPermission()) systemNotify(title, body);
}


async function saveFocusRecord(args: { taskId: string | null; startAt: number; endAt: number; durationMin: number }): Promise<void> {
  if (isQuestBinding(args.taskId)) {
    // Stable segment identity survives tick/restart retries. Never create a dangling ordinary record.
    await useQuestStore.getState().stage(args.taskId!, {
      id: `${args.taskId}:${args.startAt}:${args.endAt}`,
      startAt: args.startAt, endAt: args.endAt, durationMin: args.durationMin,
    });
    return;
  }
  await api.create_focus_record(args);
}
