import { strict as assert } from 'node:assert';
import { buildReport, moveReportPeriod } from '../src/lib/report';
import { toDateKey } from '../src/lib/date';
import type { FocusRecord, Task, TaskList } from '../src/types';
let count = 0;
const test = (label: string, run: () => void) => { run(); count++; console.log(`PASS ${label}`); };
const time = (day: number, hour = 9) => new Date(2026, 9, day, hour).getTime();
const now = new Date(2026, 9, 30, 12);
const record = (id: string, day: number, minutes: number, patch: Partial<FocusRecord> = {}): FocusRecord => ({ id, task_id: 'task', list_id: 'list', start_at: time(day), end_at: time(day) + minutes * 60000, duration_min: minutes, phase: 'focus', created_at: time(day), ...patch });
const records = [record('mon', 26, 60), record('thu', 29, 30), record('fri', 30, 45), record('previous', 25, 20),
  record('future', 30, 90, { start_at: time(30, 13) }), record('break', 28, 100, { phase: 'break' }),
  record('negative', 28, -10), record('nan', 28, NaN), record('next', 31, 10)];
const tasks = [ { id: 'task', title: 'Read', completed: 1, completed_at: time(30), due_date: '2025-01-01' },
  { id: 'older', title: 'Older', completed: 1, completed_at: time(25), due_date: '2026-10-30' },
  { id: 'pending', title: 'Pending', completed: 0, completed_at: time(30) },
] as Task[];
const lists = [{ id: 'list', name: 'Work' }] as TaskList[];
const ds = { records, tasks, lists };
const week = buildReport(ds, 'week', now, 40, now);
test('周一至周日，以本地时区为界', () => { assert.equal(toDateKey(week.from), '2026-10-26'); assert.equal(toDateKey(week.to), '2026-11-01'); assert.equal(week.days.length, 7); });
test('排除休息、非法时长和未来记录', () => { assert.equal(week.totalMin, 135); assert.equal(week.sessions, 3); });
test('日均包含已过零记录日，不把未来天数当分母', () => { assert.equal(week.elapsedDays, 5); assert.equal(week.dailyAverage, 27); });
test('按专注日计算目标达标率', () => { assert.equal(week.activeDays, 3); assert.equal(week.goalDays, 2); assert.equal(week.goalRate, 67); });
test('本期最长连续天数', () => assert.equal(week.longestStreak, 2));
test('完成任务按 completed_at，不按 due_date 或旧状态计数', () => assert.equal(week.completedTasks, 1));
test('最佳日、平均与最长单次', () => { assert.equal(week.bestDay?.key, '2026-10-26'); assert.equal(week.averageSession, 45); assert.equal(week.longestSession, 60); });
test('图表、任务、清单、小时、星期与网格合计一致', () => {
  for (const items of [week.series, week.taskDurations, week.distribution, week.hours, week.weekdays, week.grid]) assert.equal(items.reduce((n, item) => n + item.minutes, 0), week.totalMin);
  assert.equal(week.grid.reduce((n, item) => n + item.count, 0), week.sessions);
});
test('日视图固定 24 小时', () => { const day = buildReport(ds, 'day', now, 40, now); assert.equal(day.totalMin, 45); assert.equal(day.series.length, 24); assert.equal(day.series[9].minutes, 45); });
test('月视图补齐零记录日', () => { const month = buildReport(ds, 'month', now, 40, now); assert.equal(month.days.length, 31); assert.equal(month.series.length, 31); assert.equal(month.series[1].minutes, 0); assert.equal(month.elapsedDays, 30); });
test('年视图按 12 月聚合，合计不变', () => { const year = buildReport(ds, 'year', now, 40, now); assert.equal(year.series.length, 12); assert.equal(year.series[9].minutes, year.totalMin); });
test('空数据与未设置目标无 NaN/Infinity', () => { const empty = buildReport({ ...ds, records: [] }, 'day', now, 0, now); assert.equal(empty.goalRate, 0); assert.equal(empty.averageSession, 0); assert.equal(empty.dailyAverage, 0); assert.equal(empty.bestDay, null); });
test('未来周期不产生已过天数', () => { const future = buildReport(ds, 'year', new Date(2027, 0, 1), 40, now); assert.equal(future.elapsedDays, 0); assert.equal(future.dailyAverage, 0); });
test('月底导航不溢出到隔月', () => { assert.equal(toDateKey(moveReportPeriod('month', new Date(2026, 0, 31), 1)), '2026-02-01'); assert.equal(toDateKey(moveReportPeriod('month', new Date(2026, 2, 31), -1)), '2026-02-01'); });
test('闰日跨年导航与闰年日期数', () => { assert.equal(toDateKey(moveReportPeriod('year', new Date(2024, 1, 29), 1)), '2025-01-01'); assert.equal(buildReport({ ...ds, records: [] }, 'year', new Date(2024, 6, 1), 40, now).days.length, 366); });
test('跨年周保持正确七天范围', () => { const range = buildReport({ ...ds, records: [] }, 'week', new Date(2027, 0, 1), 40, now); assert.equal(range.days[0], '2026-12-28'); assert.equal(range.days[6], '2027-01-03'); });
test('未指定/已删除任务与清单不丢失记录', () => {
  const x = buildReport({ tasks: [], lists: [], records: [record('orphan', 30, 20), record('none', 30, 10, { task_id: null, list_id: null })] }, 'day', now, 40, now);
  assert.equal(x.totalMin, 30); assert.equal(x.taskDurations.length, 2); assert.equal(x.distribution.length, 2); assert.equal(x.taskDurations[0].title, null);
});
test('归档按开始日期，跨午夜完整记录不重复切分', () => {
  const x = buildReport({ ...ds, records: [record('late', 29, 120, { start_at: time(29, 23), end_at: time(30, 1) })] }, 'day', new Date(2026, 9, 29), 40, now);
  assert.equal(x.totalMin, 120); assert.equal(x.hours[23].minutes, 120);
});
test('夏令时月份仍包含全部自然日', () => {
  const range = buildReport({ ...ds, records: [] }, 'month', new Date(2026, 2, 15), 40, now);
  assert.equal(range.days.length, 31); assert.equal(new Set(range.days).size, 31); assert.equal(range.days.at(-1), '2026-03-31');
});
console.log(`${count} report checks passed`);
