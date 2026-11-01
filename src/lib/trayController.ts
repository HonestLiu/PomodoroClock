import { api, isTauri, subscribe } from '@/api';
import { useTimerStore } from '@/stores/timerStore';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useNoiseStore } from '@/stores/noiseStore';
import { useI18nStore, tStatic } from '@/i18n';
import { timerTaskCandidates } from '@/lib/derive';
import { toDateKey } from '@/lib/date';
import { buildTrayMenu, canStartTrayTask } from '@/lib/trayMenu';
import type { FocusRecord, Task } from '@/types';

/** 菜单操作与原生菜单状态共用当前 store；后台操作不改变专注面板的显隐。 */
export async function handleTrayAction(action: unknown): Promise<void> {
  if (typeof action !== 'string') return;
  const timer = useTimerStore.getState();
  const ui = useUiStore.getState();
  const restoreScreen = timer.screenOpen;
  if (action === 'tray-toggle') {
    timer.toggleRun(); timer.openScreen(restoreScreen); return;
  }
  if (action === 'tray-finish') {
    if (timer.settling) return;
    const before = timer.state;
    if (before.mode === 'stopwatch') await timer.stop();
    else if (before.phase === 'break' || (before.phase === 'focus' && before.start_at !== null)) {
      await timer.skip();
      const next = useTimerStore.getState();
      if (before.phase === 'break' && next.state.phase === 'focus' && !next.state.running) next.resume();
    }
    useTimerStore.getState().openScreen(restoreScreen); return;
  }
  if (action.startsWith('tray-task:')) {
    if (!canStartTrayTask(timer.state, timer.settling)) return;
    const id = action.slice('tray-task:'.length);
    if (id !== 'none' && !useDataStore.getState().tasks.some(task => task.id === id && !task.completed)) return;
    timer.setMode('pomodoro');
    useTimerStore.getState().setTask(id === 'none' ? null : id);
    useTimerStore.getState().start();
    useTimerStore.getState().openScreen(restoreScreen); return;
  }
  switch (action) {
    case 'tray-float': ui.setFloatVisible(!ui.floatVisible); break;
    case 'tray-noise': useNoiseStore.getState().setPlaying(!useNoiseStore.getState().playing); break;
    case 'tray-open-timer': ui.closeAllOverlays(); timer.openScreen(true); break;
    case 'tray-today': ui.closeAllOverlays(); timer.openScreen(false); ui.navigate({ name: 'today' }); break;
    case 'tray-tasks': ui.closeAllOverlays(); timer.openScreen(false); ui.navigate({ name: 'tasks' }); break;
    case 'tray-report': ui.closeAllOverlays(); timer.openScreen(false); ui.openReport(true); break;
    case 'tray-settings': ui.closeAllOverlays(); timer.openScreen(false); ui.openSettings(); break;
  }
}

export function installTrayController(): () => void {
  if (!isTauri()) return () => {};
  let stopped = false;
  let queued = false;
  let sending = false;
  let previous = '';
  let forceNext = false;
  let tasksRef: Task[] | null = null;
  let selectedId: string | null | undefined;
  let candidates: Task[] = [];
  let recordsRef: FocusRecord[] | null = null;
  let todayKey = '';
  let todayMinutes = 0;
  let todaySessions = 0;
  async function sync() {
    if (sending || stopped) return;
    sending = true;
    try {
      while (queued && !stopped) {
        queued = false;
        const force = forceNext; forceNext = false;
        const timer = useTimerStore.getState();
        const data = useDataStore.getState();
        const ui = useUiStore.getState();
        const key = toDateKey(timer.now);
        if (tasksRef !== data.tasks || selectedId !== timer.state.task_id || todayKey !== key) {
          tasksRef = data.tasks; selectedId = timer.state.task_id;
          const sorted = timerTaskCandidates({ tasks: data.tasks, lists: [], records: [] });
          const selected = sorted.find(task => task.id === selectedId);
          candidates = (selected ? [selected, ...sorted.filter(task => task.id !== selectedId)] : sorted).slice(0, 6);
        }
        if (recordsRef !== data.records || todayKey !== key) {
          recordsRef = data.records; todayKey = key; todayMinutes = 0; todaySessions = 0;
          for (const record of data.records) {
            if (record.phase !== 'focus' || toDateKey(record.start_at) !== key || !Number.isFinite(record.duration_min) || record.duration_min <= 0) continue;
            todayMinutes += record.duration_min; todaySessions++;
          }
        }
        const snapshot = buildTrayMenu({ state: timer.state, settings: timer.settings, now: timer.now,
          settling: timer.settling, taskTitle: data.tasks.find(task => task.id === timer.state.task_id)?.title ?? null,
          candidates, todayMinutes, todaySessions, floatVisible: ui.floatVisible,
          noisePlaying: useNoiseStore.getState().playing }, tStatic);
        const signature = JSON.stringify(snapshot);
        if (force || signature !== previous) {
          await api.update_tray_menu(snapshot, force);
          previous = signature;
        }
      }
    } catch (e) {
      forceNext = true;
      console.warn('Tray menu update failed', e);
    } finally { sending = false; }
  }
  const schedule = () => { queued = true; if (!sending) queueMicrotask(() => { void sync(); }); };
  const offAction = subscribe('tray://menu', action => {
    void handleTrayAction(action).catch(e => console.warn('Tray action failed', e)).finally(() => {
      // 原生勾选项可能先自行翻转；即使动作被拒绝，也要恢复 store 的真实状态。
      forceNext = true; schedule();
    });
  });
  const offTimer = useTimerStore.subscribe((next, prev) => {
    if (next.state !== prev.state || next.settings !== prev.settings || next.settling !== prev.settling || Math.floor(next.now / 1000) !== Math.floor(prev.now / 1000)) schedule();
  });
  const offData = useDataStore.subscribe(schedule);
  const offUi = useUiStore.subscribe((next, prev) => { if (next.floatVisible !== prev.floatVisible) schedule(); });
  const offNoise = useNoiseStore.subscribe(schedule);
  const offLang = useI18nStore.subscribe(schedule);
  schedule();
  return () => { stopped = true; offAction(); offTimer(); offData(); offUi(); offNoise(); offLang(); };
}
