import type { TrayMenuSnapshot } from '@/api/types';
import type { Settings, Task, TimerState } from '@/types';
import { displayMs } from '@/timer/engine';
import { formatMinutes } from '@/lib/date';
import type { TFunc } from '@/i18n';

export function canStartTrayTask(state: TimerState, settling = false): boolean {
  return !settling && !state.running && (state.phase === 'idle' || (state.phase === 'focus' && state.start_at === null));
}
/** 压平换行并按 Unicode 字符截断，避免菜单被长任务名撑满或截断 emoji。 */
export function trayLabel(value: string, limit = 28): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : chars.join('');
}
export interface TrayMenuInput {
  state: TimerState;
  settings: Settings;
  now: number;
  taskTitle: string | null;
  candidates: Task[];
  todayMinutes: number;
  todaySessions: number;
  floatVisible: boolean;
  noisePlaying: boolean;
  settling: boolean;
}
export function buildTrayMenu(input: TrayMenuInput, t: TFunc): TrayMenuSnapshot {
  const { state, settings, settling } = input;
  const isBreak = state.phase === 'break';
  const fresh = state.phase === 'idle' || (state.phase === 'focus' && state.start_at === null);
  const type = isBreak ? 'break' : state.mode === 'countdown' ? 'countdown' : state.mode === 'stopwatch' ? 'stopwatch' : 'focus';
  const value = displayMs(state, input.now, settings.focus_len_min * 60_000);
  const clock = `${String(Math.floor(value / 60_000)).padStart(2, '0')}:${String(Math.floor(value % 60_000 / 1000)).padStart(2, '0')}`;
  const task = trayLabel(input.taskTitle ?? t('task.unspecified'));
  const toggle = state.running ? t(`tray.pause.${type}`) : fresh ? t(`tray.start.${type}`, { duration: formatMinutes(settings.focus_len_min) })
    : isBreak && state.start_at === null ? t('tray.start.break', { duration: formatMinutes(Math.round(value / 60_000)) }) : t(`tray.resume.${type}`);
  return {
    status: settling ? t('tray.saving') : fresh ? t('tray.ready', { task }) : t('tray.status', { phase: t(`tray.phase.${type}`), time: clock, paused: state.running ? '' : t('tray.paused'), task: isBreak ? '' : ` · ${task}` }),
    today: t('tray.todaySummary', { duration: formatMinutes(input.todayMinutes), n: input.todaySessions }),
    toggle, finish: t(isBreak ? 'tray.endBreak' : state.mode === 'countdown' ? 'tray.endCountdown' : 'tray.finishFocus'),
    controlsEnabled: !settling,
    finishEnabled: !settling && (isBreak || (state.phase === 'focus' && state.start_at !== null)),
    taskMenuEnabled: canStartTrayTask(state, settling),
    taskMenuTitle: t('tray.chooseTask'), noTaskLabel: t('tray.withoutTask'), noTaskSelected: state.task_id === null,
    taskBrowseLabel: t('tray.allTasks'), tasks: input.candidates.slice(0, 6).map(task => ({ id: task.id, title: trayLabel(task.title), selected: task.id === state.task_id })),
    floatLabel: t('tray.float'), floatChecked: input.floatVisible,
    noiseLabel: t('tray.noise'), noiseChecked: input.noisePlaying,
    openTimerLabel: t('tray.openTimer'), todayLabel: t('tray.todayTasks'), reportLabel: t('tray.report'),
    settingsLabel: t('tray.settings'), quitLabel: t('tray.quit'),
  };
}
