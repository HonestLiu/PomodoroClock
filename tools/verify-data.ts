// 验收校验：确认 §6.3 截图数据经 §7.2 口径计算后与 S1/S2/S4 一致。
import { initDB, getDB } from '@/db/idb';
import {
  computeStats, categoryFocusMinutes, categoryTaskCount, completedGroups,
  pomodoroGrid, taskDurations, listDistribution, dailyFocusMap, todayPendingTasks,
  tasksForCategory,
} from '@/db/queries';
import {
  completedTaskGroups, computeTaskCards, isOverdue,
  focusByHour, focusByWeekday, reportInsights, taskOverview, upcomingTasks,
} from '@/lib/derive';
import type { FocusRecord, Task } from '@/types';
import { nextOccurrence } from '@/lib/recurrence';
import { leadMs, dueTimestamp, taskRemindAt, shouldRemind } from '@/lib/taskRemind';
import { formatMinutes, setDateLocale, toDateKey } from '@/lib/date';

// 本脚本断言的是 PRD §7.2 的中文口径字符串，必须与运行环境语言无关：
// i18n/store 在模块加载时会按 detectLang() 初始化（Node 里 navigator.language 通常是 en-US），
// 会把 date 层的格式化切成 "8h 59m"，导致断言假失败，故在此显式固定中文。
setDateLocale('zh');

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

await initDB();
const db = getDB();
console.log(`seed: tasks=${db.tasks.length} records=${db.focus_records.length} lists=${db.lists.length} notifs=${db.notifications.length}\n`);

const s = computeStats();
console.log('--- S1/S4 统计卡片 (§7.2) ---');
check('总专注时间', formatMinutes(s.total_focus_min), '8小时59分钟');
// 「本周 = 本周一 00:00 起」（PRD §7.2）。种子按「今天/-1/-2」生成：
// 今天是周一/周二时，更早的种子日会落到上一周，本周**合法地**小于总时长。
// 故期望值在此按日历独立算一遍（与 db/queries 的 startOfWeek 各自实现同一口径），
// 不能硬编码 '8小时59分钟'（那只有周三~周日成立）。
function independentWeekStart(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 回到本周一（0=周日）
  return x.getTime();
}
const dowNow = new Date().getDay();
const crossesWeek = dowNow === 1 || dowNow === 2; // 周一/周二：种子跨上一周
const weekExpected = db.focus_records
  .filter((r) => r.start_at >= independentWeekStart(new Date()))
  .reduce((a, r) => a + r.duration_min, 0);
check('本周专注时间(独立周一窗口)', formatMinutes(s.week_focus_min), formatMinutes(weekExpected));
check(
  `本周=总${crossesWeek ? '（今天是周一/周二，跨周日应为 false）' : '（种子三天同周，应为 true）'}`,
  s.week_focus_min === s.total_focus_min,
  !crossesWeek,
);
check('今日专注时间', formatMinutes(s.today_focus_min), '20分钟');
check('总完成任务', s.total_done_tasks, 0);
check('本周完成任务', s.week_done_tasks, 0);
check('今日完成任务', s.today_done_tasks, 0);
check('专注天数', s.focus_days, 3);
check('完成目标天数', s.goal_days, 2);
check('每日目标', formatMinutes(s.daily_target_min), '3小时');

console.log('\n--- S1 侧边栏角标 ---');
check('任务 分类任务数', categoryTaskCount('tasks'), 3);
// §7.2「分类已专注时长 = 该分类任务关联记录的总时长」：未指定任务的记录不计入
check('任务 分类已专注(仅任务关联)', formatMinutes(categoryFocusMinutes('tasks')), '8小时49分钟');
check('今天 分类已专注(今日口径)', formatMinutes(categoryFocusMinutes('today')), '20分钟');

console.log('\n--- S2 记录视图分组（专注归档，原「已完成」） ---');
const groups = completedGroups();
check('分组数', groups.length, 3);
for (const g of groups) {
  const total = g.records.reduce((a, r) => a + r.duration_min, 0);
  console.log(`      ${g.dateKey}  ${g.records.length} 条  ${total}min`);
}
// 日期键必须用本地时区（toDateKey），不能用 toISOString()：那是 UTC，
// 本地 00:00–08:00（UTC+8）之间会取到昨天的键，断言必错。
check('今天组条数', groups.find((g) => g.dateKey === toDateKey(new Date()))?.records.length ?? -1, 1);

// 侧边栏两个「完成」入口的口径必须分开：记录=专注归档，已完成=任务归档
console.log('\n--- 侧边栏「已完成 / 记录」角标口径 ---');
check('记录 分类数(=已完成番茄数)', categoryTaskCount('records'), db.focus_records.length);
check('记录 分类数≠任务数', categoryTaskCount('records') === categoryTaskCount('tasks'), false);
check('记录 分类已专注(全部记录)', formatMinutes(categoryFocusMinutes('records')), '8小时59分钟');
check('已完成 分类任务数', categoryTaskCount('completed'), db.tasks.filter((t) => t.completed === 1).length);
check('已完成 分类已专注(仅已完成任务)', formatMinutes(categoryFocusMinutes('completed')), '0分钟');
// 已完成视图的任务归档分组（种子 0 条已完成 → 空分组，页面走空态）
check('已完成视图任务分组数', completedTaskGroups({
  tasks: db.tasks, lists: db.lists, records: db.focus_records,
}).length, 0);

// ── 逾期留驻 + 自定义清单任务归入时间视图（用户需求 2026-10-19）──
console.log('\n--- 时间视图：逾期留驻 / 自定义清单归入 ---');
// 种子 3 个任务到期日 = 昨天 → 今天=3（全部逾期）、明天=0、本周=3（今天含逾期⊂本周）
check('今天 含全部逾期任务', tasksForCategory('today').length, 3);
check('明天 严格=明天', tasksForCategory('tomorrow').length, 0);
check('本周 含逾期+本周', tasksForCategory('week').length, 3);
check('已计划 仍含全部有到期日任务', tasksForCategory('scheduled').length, 3);
check('逾期任务置顶（今天首个为到期最早的）', tasksForCategory('today')[0]?.due_date, db.tasks[0].due_date);
// isOverdue：未完成且到期日早于今天
check('种子任务全部逾期', db.tasks.every((t) => isOverdue(t)), true);
check('无到期日任务不逾期', isOverdue({ ...db.tasks[0], due_date: null }), false);
check('已完成任务不逾期', isOverdue({ ...db.tasks[0], completed: 1 }), false);

// 合成：自定义清单任务按到期日落入对应时间视图，并带来源归属（UI 侧 TaskItem 标注）
const nowTs = Date.now();
const dk = (off: number) => {
  const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + off);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const synList = { id: 'l_syn_src', name: '来源清单', sort_order: 9, is_smart: 0,
  icon_type: 'dot' as const, icon_color: '#E85D3F', icon_glyph: '', folder_id: null,
  created_at: nowTs, updated_at: nowTs };
const mkT = (id: string, due: string | null, completed = 0) => ({
  id, list_id: 'l_syn_src', title: id, notes: '', est_pomodoros: 0, due_date: due,
  completed, completed_at: null, sort_order: 0, created_at: nowTs, updated_at: nowTs,
});
const synDs = {
  lists: [...db.lists, synList],
  tasks: [mkT('st_overdue', dk(-2)), mkT('st_today', dk(0)), mkT('st_tomorrow', dk(1)),
    mkT('st_week', dk(3)), mkT('st_future', dk(10)), mkT('st_nodate', null)],
  records: db.focus_records,
};
const derive = await import('@/lib/derive');
check('合成 今天=逾期+今天(2)', derive.tasksForCategory(synDs, 'today').map((t) => t.id).sort(), ['st_overdue', 'st_today']);
check('合成 明天=1', derive.tasksForCategory(synDs, 'tomorrow').map((t) => t.id), ['st_tomorrow']);
check('合成 本周=逾期+今天+明天+本周(4)', derive.tasksForCategory(synDs, 'week').map((t) => t.id).sort(),
  ['st_overdue', 'st_today', 'st_tomorrow', 'st_week']);
check('合成 已计划=5（含远期，不含无日期）', derive.tasksForCategory(synDs, 'scheduled').length, 5);
check('合成 逾期任务来自自定义清单', derive.tasksForCategory(synDs, 'today')[0].list_id, 'l_syn_src');
check('合成 逾期置顶顺序（逾期在前、按到期日升序）', derive.tasksForCategory(synDs, 'today').map((t) => t.id),
  ['st_overdue', 'st_today']);

// ── 清单视图统计卡（回归：曾因 key 被压成 'tasks' 而恒等于总专注时间）──
// 纯函数回归用例：构造「自定义清单 + 关联任务 + 两条专注记录」，
// 断言该清单的「已专注时间」只算本清单任务的记录，而不是全部记录。
console.log('\n--- 清单视图统计卡（lib/derive::computeTaskCards 回归） ---');
const synIds = new Set(db.tasks.filter((t) => t.list_id === 'list_default').map((t) => t.id));
const synRecordMin = db.focus_records
  .filter((r) => r.task_id && synIds.has(r.task_id))
  .reduce((a, r) => a + r.duration_min, 0);
const synCards = computeTaskCards(
  { tasks: db.tasks, lists: db.lists, records: db.focus_records },
  'tasks', 25, computeStats(), 'list_default',
);
check('内置清单 已专注=该清单任务记录', synCards.focus_min, synRecordMin);
check('内置清单 已专注=529(排除10min未指定任务)', synCards.focus_min, 529);
check('内置清单 已专注≠总专注(539)', synCards.focus_min === 539, false);
check('内置清单 待完成=3', synCards.pending, 3);

const customList = { id: 'l_custom_test', name: '自定义清单', sort_order: 1, is_smart: 0,
  icon_type: 'dot' as const, icon_color: '', icon_glyph: '', folder_id: null,
  created_at: Date.now(), updated_at: Date.now() };
const tCustom = { id: 't_custom_1', list_id: 'l_custom_test', title: '自定义任务', notes: '',
  est_pomodoros: 2, due_date: null, completed: 0, completed_at: null, sort_order: 0,
  created_at: Date.now(), updated_at: Date.now() };
const rCustom = { id: 'fr_custom_1', task_id: 't_custom_1', list_id: 'l_custom_test',
  start_at: Date.now() - 3_600_000, end_at: Date.now() - 3_600_000 + 1_800_000,
  duration_min: 30, phase: 'focus', created_at: Date.now() };
const customDs = {
  tasks: [...db.tasks, tCustom],
  lists: [...db.lists, customList],
  records: [...db.focus_records, rCustom],
};
const customCards = computeTaskCards(customDs, 'tasks', 25, computeStats(), 'l_custom_test');
check('自定义清单 已专注=本清单记录(30)', customCards.focus_min, 30);
check('自定义清单 已专注≠总专注(569)', customCards.focus_min === 569, false);
check('自定义清单 预计时间=待办预估×25(50)', customCards.est_min, 50);
check('自定义清单 待完成=1', customCards.pending, 1);
check('自定义清单 已完成=0', customCards.done, 0);
// 不污染：任务智能分类仍是全部口径
const allCards = computeTaskCards(customDs, 'tasks', 25, computeStats());
check('智能「任务」视图仍为全局口径(待完成=4)', allCards.pending, 4);

// ── 提醒事项：重复推进 / 到时提醒（纯函数，日期与时区无关，用固定锚点）──
console.log('\n--- 提醒事项：重复 / 到时提醒（lib/recurrence.ts + lib/taskRemind.ts） ---');
// 锚点：2026-10-16 是周五（dow=5），17 六、18 日、19 一
const anchor = new Date(2026, 9, 16, 12, 0, 0);
check('daily +1天', nextOccurrence({ date: '2026-10-16', time: '09:30' }, 'daily', anchor),
  { date: '2026-10-17', time: '09:30' });
check('weekly +7天(跨月)', nextOccurrence({ date: '2026-10-16', time: '09:30' }, 'weekly', anchor),
  { date: '2026-10-23', time: '09:30' });
check('hourly +1小时(时间进位)', nextOccurrence({ date: '2026-10-16', time: '23:30' }, 'hourly', anchor),
  { date: '2026-10-17', time: '00:30' });
check('hourly 无时间退化为 daily', nextOccurrence({ date: '2026-10-16', time: null }, 'hourly', anchor),
  { date: '2026-10-17', time: null });
check('工作日 周五→下周一', nextOccurrence({ date: '2026-10-16', time: '08:00' }, 'weekdays', anchor),
  { date: '2026-10-19', time: '08:00' });
check('工作日 周一→周二', nextOccurrence({ date: '2026-10-19', time: '08:00' }, 'weekdays', anchor),
  { date: '2026-10-20', time: '08:00' });
check('周末 周五→本周六', nextOccurrence({ date: '2026-10-16', time: null }, 'weekends', anchor),
  { date: '2026-10-17', time: null });
check('周末 周日→下周六', nextOccurrence({ date: '2026-10-18', time: null }, 'weekends', anchor),
  { date: '2026-10-24', time: null });
check('永不不推进', nextOccurrence({ date: '2026-10-16', time: '09:30' }, 'none', anchor), null);
check('无到期日以今天为基准', (() => {
  const o = nextOccurrence({ date: null, time: null }, 'daily', anchor);
  return o !== null && o.date === '2026-10-17';
})(), true);

check('lead 提前量 none/1d/2d/1w', [leadMs('none'), leadMs('1d'), leadMs('2d'), leadMs('1w')],
  [0, 86400000, 172800000, 604800000]);
check('dueTimestamp 无时间返回 null', dueTimestamp('2026-10-16', null), null);
check('dueTimestamp 拼出当日 09:30', toDateKey(dueTimestamp('2026-10-16', '09:30') ?? 0), '2026-10-16');

// taskRemindAt / shouldRemind：仅 due_time 存在才触发；提前量生效；去重
const base = {
  id: 'tr1', list_id: null, title: '提醒任务', notes: '', est_pomodoros: 0,
  due_date: '2026-10-16', due_time: '09:30', url: '', urgent: 0, repeat: 'none',
  lead_remind: 'none', tags: [], flag: 0, priority: 'none', reminded_at: null,
  completed: 0, completed_at: null, sort_order: 0, created_at: 0, updated_at: 0,
};
check('taskRemindAt = 到期时刻(无提前)', toDateKey(taskRemindAt({ ...base }) ?? 0), '2026-10-16');
check('taskRemindAt 无时间=null', taskRemindAt({ ...base, due_time: null }), null);
check('taskRemindAt 提前1天跨到前一天', toDateKey(taskRemindAt({ ...base, lead_remind: '1d' }) ?? 0), '2026-10-15');
check('shouldRemind 未到点=false', shouldRemind({ ...base }, dueTimestamp('2026-10-16', '09:00')!), false);
check('shouldRemind 已到点=true', shouldRemind({ ...base }, dueTimestamp('2026-10-16', '09:40')!), true);
check('shouldRemind 已完成=false', shouldRemind({ ...base, completed: 1 }, dueTimestamp('2026-10-16', '09:40')!), false);
check('shouldRemind 已去重=false', shouldRemind({ ...base, reminded_at: dueTimestamp('2026-10-16', '09:40')! },
  dueTimestamp('2026-10-16', '09:50')!), false);
check('shouldRemind 改时间后重新武装=true',
  shouldRemind({ ...base, reminded_at: dueTimestamp('2026-10-16', '09:40')!, due_time: '11:00' },
    dueTimestamp('2026-10-16', '11:05')!), true);

// scanTaskReminders：命中即写通知 + 置 reminded_at；再次扫描不重复触发（注入 deps，确定性）
{
  const { scanTaskReminders } = await import('@/lib/remindScan');
  const fired: string[] = [];
  const store = new Map<string, number>();
  const now = dueTimestamp('2026-10-16', '09:40')!;
  const dueTask = { ...base, id: 'scan1', title: '到点任务' };
  const futureTask = { ...base, id: 'scan2', title: '未到点', due_time: '23:00' };
  const deps = {
    createNotification: async (args: { title: string }) => { fired.push(args.title); },
    markReminded: async (taskId: string, at: number) => { store.set(taskId, at); },
  };
  const snapshot = () => [dueTask, futureTask].map((t) => ({ ...t, reminded_at: store.get(t.id) ?? null }));
  const settings = { notify_enabled: false, system_notify: false }; // 关系统通知，避免真实弹窗
  const pass1 = await scanTaskReminders(snapshot(), settings, deps, now);
  check('扫描1 只触发到点任务', pass1, ['到点任务']);
  check('扫描1 写通知数=1', fired.length, 1);
  check('扫描1 置 reminded_at', store.has('scan1'), true);
  const pass2 = await scanTaskReminders(snapshot(), settings, deps, now);
  check('扫描2 已去重不重复触发', pass2, []);
  check('扫描2 通知数仍=1', fired.length, 1);
}

console.log('\n--- S4 番茄记录图 (FR-R3) ---');
const grid = pomodoroGrid(14);
check('日期轴长度', grid.dates.length, 14);
check('网格单元数', grid.cells.length > 0, true);
const hours = [...new Set(grid.cells.map((c) => c.hour))].sort((a, b) => a - b);
console.log(`      覆盖小时: ${hours.join(',')}`);

console.log('\n--- S4 专注时间详情 / 清单分布 (FR-R4/R5) ---');
const td = taskDurations('day', new Date());
check('今日任务明细', td.items.map((i) => `${i.title}:${i.minutes}`), ['数学真题:20']);
check('今日总计', td.total, 20);
const ld = listDistribution('day', new Date());
check('今日清单分布', ld.items.map((i) => `${i.name}:${i.minutes}:${i.percent}%`), ['任务:20:100%']);

console.log('\n--- S4 每日目标日历 (FR-R6) ---');
check('专注天数映射', dailyFocusMap().size, 3);

console.log('\n--- S3 今日面板 ---');
check('今日待完成列表', todayPendingTasks().map((t) => t.title), ['数学真题', '408真题', '单词']);

// 报表增强（2026-10-29）：跟随真实「今天」，用相对日期构造，断言与运行日无关
console.log('\n--- 报表洞察 / 时段分布 / 任务概览（纯函数） ---');
const mkTask = (over: Partial<Task>): Task => ({
  id: 't', list_id: null, title: 'x', notes: '', est_pomodoros: 0,
  due_date: null, due_time: null, url: '', urgent: 0, repeat: 'none',
  lead_remind: 'none', tags: [], flag: 0, priority: 'none', reminded_at: null,
  completed: 0, completed_at: null, sort_order: 0, created_at: 0, updated_at: 0,
  actual_minutes: null, parent_id: null, ...over,
});
const N_DAYS_AGO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d;
};
const mkRec = (start: Date, min: number, hourShift = 0, over: Partial<FocusRecord> = {}): FocusRecord => {
  const s = new Date(start);
  s.setHours(s.getHours() + hourShift);
  return {
    id: `r${s.getTime()}-${min}`, task_id: null, list_id: null,
    start_at: s.getTime(), end_at: s.getTime() + min * 60_000,
    duration_min: min, phase: 'focus', created_at: s.getTime(), ...over,
  };
};
const insRecs = [
  mkRec(N_DAYS_AGO(0), 25, 1),   // 今天 10:00
  mkRec(N_DAYS_AGO(0), 35, 5),   // 今天 14:00
  mkRec(N_DAYS_AGO(1), 20),      // 昨天 09:00
  mkRec(N_DAYS_AGO(2), 10),      // 前天 09:00
  mkRec(N_DAYS_AGO(4), 15),      // 4 天前 09:00（第 3 天断层）
];
const ins = reportInsights({ tasks: [], lists: [], records: insRecs });
check('洞察 专注次数', ins.sessions, 5);
check('洞察 今日次数', ins.todaySessions, 2);
check('洞察 总时长', ins.totalMin, 105);
check('洞察 平均单次', ins.avgSessionMin, 21);
check('洞察 最长单次', ins.longestSessionMin, 35);
check('洞察 活跃天数', ins.activeDays, 4);
check('洞察 活跃日日均', ins.avgActiveDayMin, 26);
check('洞察 当前连续(3)', ins.currentStreak, 3);
check('洞察 最长连续(3)', ins.longestStreak, 3);
check('洞察 最佳单日', ins.bestDay ? [ins.bestDay.dateKey, ins.bestDay.minutes] : null, [toDateKey(new Date()), 60]);
check('洞察 高峰小时', ins.peakHour, 9);
check('洞察 高峰时长', ins.peakHourMin, 45);

const byHour = focusByHour({ tasks: [], lists: [], records: insRecs });
check('小时分布 桶数', byHour.length, 24);
check('小时分布 9 点', [byHour[9].minutes, byHour[9].sessions], [45, 3]);
check('小时分布 其余合计', byHour.reduce((a, b) => a + b.minutes, 0) - byHour[9].minutes, 60);
const byWeekday = focusByWeekday({ tasks: [], lists: [], records: insRecs });
check('星期分布 桶数', byWeekday.length, 7);
check('星期分布 合计', byWeekday.reduce((a, b) => a + b.minutes, 0), 105);
check('星期分布 今天的桶≥60', byWeekday[(new Date().getDay() + 6) % 7].minutes >= 60, true);

const yesterdayKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toDateKey(d); })();
const ovTasks = [
  mkTask({ id: 'a', title: '今日', due_date: toDateKey(new Date()), est_pomodoros: 2, priority: 'high', urgent: 1, flag: 1 }),
  mkTask({ id: 'b', title: '逾期', due_date: yesterdayKey, est_pomodoros: 1.5 }),
  mkTask({ id: 'c', title: '完成', completed: 1, completed_at: Date.now(), est_pomodoros: 4 }),
  mkTask({ id: 'd', title: '无日期' }),
];
const ovRecs = [
  mkRec(N_DAYS_AGO(0), 30, 1, { task_id: 'a' }),
  mkRec(N_DAYS_AGO(0), 10, 1, { task_id: 'b' }),
  mkRec(N_DAYS_AGO(0), 40, 1, { task_id: 'c' }), // 已完成任务：不计入「待办已投入」
];
const ov = taskOverview({ tasks: ovTasks, lists: [], records: ovRecs });
check('任务概览 待办/完成/总数', [ov.pending, ov.done, ov.total], [3, 1, 4]);
check('任务概览 完成率', ov.completionRate, 25);
check('任务概览 逾期', ov.overdue, 1);
check('任务概览 今日到期', ov.dueToday, 1);
check('任务概览 高优先级/紧急/旗标', [ov.highPriority, ov.urgent, ov.flagged], [1, 1, 1]);
check('任务概览 预估番茄(待办 2+1.5)', ov.estPomodoros, 3.5);
check('任务概览 已投入(仅待办任务 30+10)', ov.investedMin, 40);

console.log('\n--- 报表 即将到期 ---');
const tomorrowKey = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateKey(d); })();
const todayKeyStr = toDateKey(new Date());
const upTasks = [
  mkTask({ id: 'u1', title: '今天下午', due_date: todayKeyStr, due_time: '15:00' }),
  mkTask({ id: 'u2', title: '今天上午', due_date: todayKeyStr, due_time: '09:00' }),
  mkTask({ id: 'u3', title: '明天', due_date: tomorrowKey }),
  mkTask({ id: 'u4', title: '逾期', due_date: yesterdayKey }),
  mkTask({ id: 'u5', title: '无日期' }),
  mkTask({ id: 'u6', title: '已完成', due_date: yesterdayKey, completed: 1 }),
];
const upDs = { tasks: upTasks, lists: [], records: [] };
check('即将到期 排序(逾期→今天09→今天15→明天)', upcomingTasks(upDs).map((t) => t.id), ['u4', 'u2', 'u1', 'u3']);
check('即将到期 上限 2 条', upcomingTasks(upDs, 2).map((t) => t.id), ['u4', 'u2']);
check('即将到期 无到期日的任务不入选', upcomingTasks({ tasks: [mkTask({ id: 'x' })], lists: [], records: [] }).length, 0);


console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
