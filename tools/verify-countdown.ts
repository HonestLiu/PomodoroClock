// 倒数纪念日口径校验 —— docs/05-modules/countdown.md
// 断言自然日差 / 每年重复(含闰年 2/29 → 平年 2/28) / 每月 / 自定义间隔 / 已过·未来文案 / 提醒去重。

import {
  isLeapYear, daysBetween, addDaysKey, nextDateKey, daysUntil,
  yearlyOccurrenceOn, yearlyYears, compareCountdown, isFuture, shouldRemindFor, remindTargetDate,
} from '@/lib/countdown';
import { countdownBigText, countdownSubText } from '@/lib/countdownText';
import type { Countdown } from '@/types';

let failures = 0;
function check<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

const tf = (k: string, p: Record<string, number> | undefined) => (p ? `${k}:${JSON.stringify(p)}` : k);
const mk = (p: Partial<Countdown>): Countdown => ({
  id: 'c1', title: 't', date: '2026-01-01', kind: 'days_left', repeat: 'once',
  interval_days: null, note: '', color: '', icon: '', pinned: 0,
  remind_enabled: 0, remind_days: 0, reminded_at: null, sort_order: 0,
  created_at: 1, updated_at: 1, ...p,
});

console.log('--- 闰年 ---');
check('isLeapYear 2024', isLeapYear(2024), true);
check('isLeapYear 2025', isLeapYear(2025), false);
check('isLeapYear 2000', isLeapYear(2000), true);
check('isLeapYear 1900', isLeapYear(1900), false);

console.log('\n--- 自然日差（UTC 归一，规避 24h/DST） ---');
check('daysBetween +1', daysBetween('2026-10-21', '2026-10-22'), 1);
check('daysBetween -1', daysBetween('2026-10-22', '2026-10-21'), -1);
check('daysBetween 0', daysBetween('2026-10-21', '2026-10-21'), 0);
check('daysBetween 跨年', daysBetween('2026-12-31', '2027-01-01'), 1);
check('addDaysKey 跨月', addDaysKey('2026-02-27', 3), '2026-03-02');

console.log('\n--- 每年重复（含 2/29 → 平年 2/28） ---');
check('yearly 今年未到→今年', nextDateKey(mk({ repeat: 'yearly', date: '2025-03-10' }), '2026-03-09'), '2026-03-10');
check('yearly 今年已过→明年', nextDateKey(mk({ repeat: 'yearly', date: '2025-03-10' }), '2026-03-11'), '2027-03-10');
check('yearly 恰逢今天', nextDateKey(mk({ repeat: 'yearly', date: '2025-03-10' }), '2026-03-10'), '2026-03-10');
check('2/29 平年→2/28', nextDateKey(mk({ repeat: 'yearly', date: '2024-02-29' }), '2025-03-01'), '2026-02-28');
check('2/29 闰年保持', yearlyOccurrenceOn('2024-02-29', 2024), '2024-02-29');
check('回归: 倒数日+每年 也自动翻年', nextDateKey(mk({ kind: 'days_left', repeat: 'yearly', date: '2025-03-10' }), '2026-03-11'), '2027-03-10');
check('回归: 倒数日+每月 也推进', nextDateKey(mk({ kind: 'days_left', repeat: 'monthly', date: '2026-01-31' }), '2026-02-10'), '2026-02-28');
check('yearlyYears 已过周年', yearlyYears('2020-10-21', '2026-10-21'), 6);
check('yearlyYears 未到周年', yearlyYears('2020-10-21', '2026-10-20'), 5);
check('yearlyYears 首年未到', yearlyYears('2020-10-21', '2021-01-01'), 0);

console.log('\n--- 每月 / 自定义间隔 ---');
check('monthly 月末截断(31→2/28)', nextDateKey(mk({ repeat: 'monthly', date: '2026-01-31' }), '2026-02-10'), '2026-02-28');
check('monthly 当月未过', nextDateKey(mk({ repeat: 'monthly', date: '2026-01-31' }), '2026-03-29'), '2026-03-31');
check('custom 每7天', nextDateKey(mk({ repeat: 'custom_days', date: '2026-10-01', interval_days: 7 }), '2026-10-17'), '2026-10-22');

console.log('\n--- daysUntil / 未来·已过 ---');
check('days_left 未来', daysUntil(mk({ kind: 'days_left', date: '2026-10-30' }), '2026-10-21'), 9);
check('days_left 今天', daysUntil(mk({ kind: 'days_left', date: '2026-10-21' }), '2026-10-21'), 0);
check('days_left 已过', daysUntil(mk({ kind: 'days_left', date: '2026-10-10' }), '2026-10-21'), -11);
check('days_elapsed 已过', daysUntil(mk({ kind: 'days_elapsed', date: '2026-10-10' }), '2026-10-21'), 11);
check('days_elapsed 未来钳0', daysUntil(mk({ kind: 'days_elapsed', date: '2026-10-30' }), '2026-10-21'), 0);
check('isFuture 已过为假', isFuture(mk({ kind: 'days_left', date: '2026-10-10' }), '2026-10-21'), false);

console.log('\n--- 展示文案（i18n 键/插值不与语言绑定） ---');
check('big 未来', countdownBigText(mk({ date: '2026-10-30' }), '2026-10-21', tf), 'cd.daysLeft:{"n":9}');
check('big 今天', countdownBigText(mk({ date: '2026-10-21' }), '2026-10-21', tf), 'cd.today');
check('big 明天', countdownBigText(mk({ date: '2026-10-22' }), '2026-10-21', tf), 'cd.tomorrow');
check('big 昨天', countdownBigText(mk({ date: '2026-10-20' }), '2026-10-21', tf), 'cd.yesterday');
check('big 已过', countdownBigText(mk({ kind: 'days_elapsed', date: '2026-10-10' }), '2026-10-21', tf), 'cd.daysElapsed:{"n":11}');
check('sub 年度带周年', countdownSubText(mk({ repeat: 'yearly', date: '2020-10-21' }), '2026-10-21', tf), '10/21 · cd.yearN:{"n":6}');

console.log('\n--- 排序 ---');
check('置顶优先', compareCountdown(mk({ id: 'a', pinned: 0, date: '2026-10-22' }), mk({ id: 'b', pinned: 1, date: '2026-10-30' }), '2026-10-21'), 1);
check('未来升序(差值为负)', compareCountdown(mk({ id: 'a', date: '2026-10-22' }), mk({ id: 'b', date: '2026-10-30' }), '2026-10-21'), -8);
check('未来优先于已过', compareCountdown(mk({ id: 'a', date: '2026-10-22' }), mk({ id: 'b', date: '2026-10-10' }), '2026-10-21'), -1);
check('已过降序(最近在前)', compareCountdown(mk({ id: 'a', date: '2026-10-10' }), mk({ id: 'b', date: '2026-10-01' }), '2026-10-21'), -9);

console.log('\n--- 提醒触发日 + 去重 ---');
const remind = mk({ remind_enabled: 1, remind_days: 1, date: '2026-10-22' });
check('提前1天→今天触发', remindTargetDate(remind, '2026-10-21'), '2026-10-21');
check('当天未提醒→true', shouldRemindFor(remind, '2026-10-21', null), true);
// notifiedAt = 今天的 00:00
const todayMs = new Date('2026-10-21T00:00:00').getTime();
check('本周期已提醒→false', shouldRemindFor(remind, '2026-10-21', todayMs), false);
check('未到触发日→false', shouldRemindFor(remind, '2026-10-20', null), false);
check('关闭提醒→false', shouldRemindFor(mk({ remind_enabled: 0, remind_days: 1, date: '2026-10-22' }), '2026-10-21', null), false);

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);