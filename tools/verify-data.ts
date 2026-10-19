// 验收校验：确认 §6.3 截图数据经 §7.2 口径计算后与 S1/S2/S4 一致。
import { initDB, getDB } from '@/db/idb';
import {
  computeStats, categoryFocusMinutes, categoryTaskCount, completedGroups,
  pomodoroGrid, taskDurations, listDistribution, dailyFocusMap, todayPendingTasks,
  tasksForCategory,
} from '@/db/queries';
import { completedTaskGroups, computeTaskCards, isOverdue } from '@/lib/derive';
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

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
