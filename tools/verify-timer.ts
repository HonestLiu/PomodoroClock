// 计时模式自检 —— 番茄钟 / 倒计时（25:00→00:00）/ 正计时（00:00→∞）
//
// 为什么要它：三种模式共用同一套状态机，差异全在 `phaseDurationMs` / `isExpired` /
// `displayMs` 的分支里，很容易「切了模式但还是按 25 分钟起表」或者「正计时也去
// 判断到期」。这些是纯函数，用断言固定住比截图更快也更准。
//
// 跑法：npx tsx tools/verify-timer.ts

import {
  displayMs, idlePhase, isExpired, pauseState, phaseDurationMs, remainingMs, startState,
} from '../src/timer/engine';
import type { Settings, TimerMode, TimerState } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

const settings: Settings = { ...DEFAULT_SETTINGS, focus_len_min: 25, break_len_min: 5 };
let pass = 0;
const fails: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; return; }
  fails.push(`${name}${detail ? ` —— ${detail}` : ''}`);
}

function idle(mode: TimerMode): TimerState {
  const base: TimerState = {
    phase: 'idle', mode, task_id: null, running: false,
    start_at: null, end_at: null, paused_remaining_ms: null,
  };
  // 与 timerStore.setMode 一致：目标时长 = 该模式的专注时长（正计时 0）
  const dur = phaseDurationMs('focus', mode, settings.focus_len_min, settings.break_len_min, 30, 0, 4);
  return idlePhase(base, 'idle', dur);
}

const MIN = 60_000;

// ── 1. 三种模式「未开始」时的显示值 ──────────────────────────────
{
  const pomo = idle('pomodoro');
  check('番茄钟未开始显示 25:00',
    displayMs(pomo, 0, 25 * MIN) === 25 * MIN, `实际 ${displayMs(pomo, 0, 25 * MIN)}`);

  const cd = idle('countdown');
  check('倒计时未开始显示 25:00',
    displayMs(cd, 0, 25 * MIN) === 25 * MIN, `实际 ${displayMs(cd, 0, 25 * MIN)}`);

  const sw = idle('stopwatch');
  check('正计时未开始显示 00:00',
    displayMs(sw, 0, 0) === 0, `实际 ${displayMs(sw, 0, 0)}`);
}

// ── 2. 倒计时：从设定时长递减，到 0 即到期 ───────────────────────
{
  const t0 = 1_000_000;
  const st = startState(idle('countdown'), 25 * MIN, t0);
  check('倒计时启动后 end_at = 起表 + 25 分钟', st.end_at === t0 + 25 * MIN, `end_at=${st.end_at}`);
  check('倒计时 1 分钟后剩余 24 分钟', displayMs(st, t0 + MIN, 25 * MIN) === 24 * MIN);
  check('倒计时未到点不判到期', !isExpired(st, t0 + 25 * MIN - 1));
  check('倒计时到点判到期', isExpired(st, t0 + 25 * MIN));
}

// ── 3. 正计时：从 00:00 往上走，永不到期 ─────────────────────────
{
  const t0 = 2_000_000;
  const st = startState(idle('stopwatch'), 0, t0);
  check('正计时启动后 end_at 为空（不设终止时刻）', st.end_at === null, `end_at=${st.end_at}`);
  check('正计时 90 秒后显示 00:01:30 的毫秒数', displayMs(st, t0 + 90_000, 0) === 90_000);
  check('正计时多久都不判到期', !isExpired(st, t0 + 24 * 3600_000));
}

// ── 4. 正计时暂停：冻结已用时，恢复后不把暂停时长算进去 ──────────
{
  const t0 = 3_000_000;
  const running = startState(idle('stopwatch'), 0, t0);
  const paused = pauseState(running, t0 + 60_000);
  check('正计时暂停保留已用 60 秒', paused.paused_remaining_ms === 60_000, `实际 ${paused.paused_remaining_ms}`);
  check('暂停期间显示值冻结', displayMs(paused, t0 + 600_000, 0) === 60_000);
  const resumed = startState(paused, 0, t0 + 600_000);
  check('恢复后继续累加（不含暂停的 9 分钟）',
    displayMs(resumed, t0 + 630_000, 0) === 90_000, `实际 ${displayMs(resumed, t0 + 630_000, 0)}`);
  check('恢复后不判到期', !isExpired(resumed, t0 + 630_000));
}

// ── 5. 暂停/恢复对倒计时的语义（剩余时间不因暂停流逝） ───────────
{
  const t0 = 4_000_000;
  const st = startState(idle('countdown'), 25 * MIN, t0);
  const paused = pauseState(st, t0 + 10 * MIN);
  check('倒计时暂停冻结剩余 15 分钟', remainingMs(paused, t0 + 20 * MIN) === 15 * MIN);
  const resumed = startState(paused, 25 * MIN, t0 + 30 * MIN);
  check('倒计时恢复后 end_at 顺延', resumed.end_at === t0 + 45 * MIN, `end_at=${resumed.end_at}`);
  check('倒计时恢复后仍剩 15 分钟', displayMs(resumed, t0 + 30 * MIN, 25 * MIN) === 15 * MIN);
}

// ── 6. 休息阶段只属于番茄钟循环 ──────────────────────────────────
{
  check('番茄钟休息 = 5 分钟',
    phaseDurationMs('break', 'pomodoro', settings.focus_len_min, settings.break_len_min, 30, 0, 4) === 5 * MIN);
  check('番茄钟第 4 个番茄后可长休息 30 分钟',
    phaseDurationMs('break', 'pomodoro', settings.focus_len_min, settings.break_len_min, 30, 4, 4) === 30 * MIN);
  check('正计时没有阶段时长', phaseDurationMs('focus', 'stopwatch', settings.focus_len_min, settings.break_len_min, 30, 0, 4) === 0);
}

console.log(`\n计时模式自检：${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log('全部通过');
