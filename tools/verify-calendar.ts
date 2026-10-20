// 日历组件校验：7 视图模型层（lib/calendar.ts）的纯函数断言。
// 覆盖：任务→事件映射、区间推移、周一起始对齐、重叠布局、区间标题、取色稳定性。
import { setDateLocale, parseDateKey, toDateKey, monthGrid } from '@/lib/date';
import {
  tasksToEvents, layoutTimeColumn, shift, rangeLabel, weekDates, multiDayDates,
  multiWeekDates, listColor, hourTicks, nowLineTop, eventsOfDay, EVENT_TEXT,
  MULTI_DAY_COUNT, MULTI_WEEK_COUNT, type CalEvent,
} from '@/lib/calendar';
import type { Task } from '@/types';

// 断言的是中文口径字符串，固定中文，与运行环境语言无关（同 verify-data.ts）
setDateLocale('zh');

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  ✗ ${label}\n      实际: ${JSON.stringify(actual)}\n      期望: ${JSON.stringify(expected)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function mkTask(p: Partial<Task>): Task {
  return {
    id: p.id ?? 't', list_id: p.list_id ?? 'list_default', title: p.title ?? '任务',
    notes: '', est_pomodoros: 0, due_date: p.due_date ?? null, due_time: p.due_time ?? null,
    url: '', urgent: p.urgent ?? 0, repeat: 'none', lead_remind: 'none',
    tags: [], flag: 0, priority: 'none', reminded_at: null,
    completed: 0, completed_at: null, sort_order: 0, created_at: 0, updated_at: 0,
  } as unknown as Task;
}
function mkEv(p: Partial<CalEvent> & { dateKey: string }): CalEvent {
  return {
    taskId: p.taskId ?? Math.random().toString(36).slice(2),
    title: p.title ?? 'E', dateKey: p.dateKey,
    start: p.start ?? null, end: p.end ?? null, allDay: p.allDay ?? true,
    color: p.color ?? '#BBDEFB', urgent: false,
  };
}
function timed(date: string, hhmm: string, min = 60): CalEvent {
  const [h, m] = hhmm.split(':').map(Number);
  const s = parseDateKey(date); s.setHours(h, m, 0, 0);
  return { ...mkEv({ dateKey: date, allDay: false }), start: s, end: new Date(s.getTime() + min * 60_000) };
}

console.log('\n--- 任务 → 事件映射 ---');
{
  const events = tasksToEvents([
    mkTask({ id: 'a', due_date: '2026-10-20' }),                        // 无时间 → 全天
    mkTask({ id: 'b', due_date: '2026-10-20', due_time: '09:30' }),     // 有时间 → 时段
    mkTask({ id: 'c', due_date: null }),                                // 无到期日 → 不进日历
  ]);
  check('映射条数（有到期日才算）', events.length, 2);
  check('无时间→全天条', events[0].allDay, true);
  check('有时间→非全天', events[1].allDay, false);
  check('时段起点 09:30', [events[1].start!.getHours(), events[1].start!.getMinutes()], [9, 30]);
  check('时段时长 60 分钟', events[1].end!.getTime() - events[1].start!.getTime(), 60 * 60_000);
  check('紧急标记透传', tasksToEvents([mkTask({ urgent: 1, due_date: '2026-10-20' })])[0].urgent, true);
  check('块内文字深色', EVENT_TEXT, '#3A3A3A');
}

console.log('\n--- 区间推移 shift ---');
{
  const a = parseDateKey('2026-10-20');
  check('年视图 ±1 年', [shift('year', a, 1).getFullYear(), shift('year', a, -1).getFullYear()], [2027, 2025]);
  check('月视图 ±1 月（0 基：10月=9 → +1=11月 / −1=9月）',
    [shift('month', a, 1).getMonth(), shift('month', a, -1).getMonth()], [10, 8]);
  check('周视图 ±7 天', toDateKey(shift('week', a, 1)) + '|' + toDateKey(shift('week', a, -1)),
    '2026-10-27|2026-10-13');
  check('日/日程 ±1 天', toDateKey(shift('day', a, -1)), '2026-10-19');
  check('多日 ±4 天', toDateKey(shift('multiday', a, 1)), '2026-10-24');
  check('多周 ±14 天', toDateKey(shift('multiweek', a, -1)), '2026-10-06');
  check('常量：多日 4 天 / 多周 2 周', [MULTI_DAY_COUNT, MULTI_WEEK_COUNT], [4, 2]);
}

console.log('\n--- 周一起始与区间生成 ---');
{
  check('weekDates 首日=周一', weekDates(parseDateKey('2026-10-21'))[0].getDay(), 1); // 周三入参
  check('weekDates 共 7 天', weekDates(new Date()).length, 7);
  check('weekDates 覆盖周六日', weekDates(new Date()).slice(-2).map((d) => d.getDay()), [6, 0]);
  check('multiWeekDates 连续 14 天且周一起始',
    [multiWeekDates(new Date()).length, multiWeekDates(new Date())[0].getDay()], [14, 1]);
  check('multiDayDates 起点=当天', toDateKey(multiDayDates(parseDateKey('2026-10-20'))[0]), '2026-10-20');
  // 月网格与周起点一致：网格首格必属某周一
  check('monthGrid 首格=周一', monthGrid(2026, 9)[0].date.getDay(), 1);
}

console.log('\n--- 重叠布局 layoutTimeColumn ---');
{
  const d = '2026-10-20';
  // 1) 不重叠：先后排列，各自满宽
  const solo = layoutTimeColumn([timed(d, '09:00'), timed(d, '10:00')])
    .map((p) => [p.leftPct, p.widthPct]);
  check('不重叠→各满宽 100%', solo, [[0, 100], [0, 100]]);

  // 2) 两两重叠：平分半宽、错开
  const pair = layoutTimeColumn([timed(d, '09:00'), timed(d, '09:15')])
    .map((p) => [p.leftPct, p.widthPct]);
  check('重叠两件→各 50% 宽错开', pair, [[0, 50], [50, 50]]);

  // 3) 链式重叠 A(0-60) B(30-90) C(60-120)：同一簇，B/C 分列，A/C 可同列
  const chain = layoutTimeColumn([timed(d, '09:00'), timed(d, '09:30'), timed(d, '10:00')])
    .map((p) => [p.leftPct, p.widthPct]);
  check('链式重叠 3 件→2 列各 50%', chain, [[0, 50], [50, 50], [0, 50]]);

  // 4) 深结束时间优先（回归：簇 maxEnd 不能只看最后入簇的事件）
  //   A(09:00-10:30) B(09:15 结束于 09:45) C(10:00-11:00) —— C 起点 600 < A 结束 630 → 同簇
  const tricky = layoutTimeColumn([timed(d, '09:00', 90), timed(d, '09:15', 30), timed(d, '10:00', 60)]);
  check('长事件主导簇宽（3 件 2 列）', tricky.length, 3);
  check('三件均 50% 宽', tricky.every((p) => p.widthPct === 50), true);

  // 5) 全天事件被排除
  check('全天事件不进时段布局', layoutTimeColumn([mkEv({ dateKey: d, allDay: true })]), []);
  // 6) 过短事件保底可点高度 15 分钟
  check('过短事件保底 15min', layoutTimeColumn([timed(d, '09:00', 5)])[0].heightMin, 15);
  // 7) 顺序无关（打乱输入结果一致）
  const sh = [timed(d, '09:00'), timed(d, '09:30'), timed(d, '10:00')].reverse();
  check('输入乱序结果一致',
    layoutTimeColumn(sh).map((p) => [p.topMin, p.leftPct, p.widthPct]),
    layoutTimeColumn([timed(d, '09:00'), timed(d, '09:30'), timed(d, '10:00')])
      .map((p) => [p.topMin, p.leftPct, p.widthPct]));
}

console.log('\n--- 区间标题 rangeLabel（zh）---');
{
  check('年', rangeLabel('year', parseDateKey('2026-10-20')), '2026年');
  check('月', rangeLabel('month', parseDateKey('2026-10-20')), '2026年10月');
  check('日', rangeLabel('day', parseDateKey('2026-10-20')), '2026年10月20日 周二');
  check('周区间（周一起算）', rangeLabel('week', parseDateKey('2026-10-21')), '10月19日 - 10月25日');
  check('多日区间', rangeLabel('multiday', parseDateKey('2026-10-20')), '10月20日 - 10月23日');
  check('多周区间', rangeLabel('multiweek', parseDateKey('2026-10-20')), '10月19日 - 11月1日');
  check('日程', rangeLabel('schedule', parseDateKey('2026-10-20')), '10月20日日程');
}

console.log('\n--- 取色与时间线 ---');
{
  check('同清单取色稳定', listColor('list_default'), listColor('list_default'));
  check('无清单取首色', listColor(null), listColor(undefined));
  check('不同清单可区分', listColor('list_default') !== listColor('list_x'), true);
  check('小时刻度 0..23', [hourTicks().length, hourTicks()[0], hourTicks()[23]], [24, 0, 23]);
  const noon = parseDateKey('2026-10-20'); noon.setHours(12, 0, 0, 0);
  check('当前时间线 12:00 顶部像素', nowLineTop(noon), 12 * 44);
}

console.log('\n--- 按天过滤 eventsOfDay ---');
{
  const e = tasksToEvents([
    mkTask({ id: 'x', due_date: '2026-10-20' }),
    mkTask({ id: 'y', due_date: '2026-10-21' }),
  ]);
  check('取 10-20 的事件', eventsOfDay(e, parseDateKey('2026-10-20')).map((x) => x.taskId), ['x']);
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);