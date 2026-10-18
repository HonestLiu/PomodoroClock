// 验收校验：确认 §6.3 截图数据经 §7.2 口径计算后与 S1/S2/S4 一致。
import { initDB, getDB } from '@/db/idb';
import {
  computeStats, categoryFocusMinutes, categoryTaskCount, completedGroups,
  pomodoroGrid, taskDurations, listDistribution, dailyFocusMap, todayPendingTasks,
} from '@/db/queries';
import { formatMinutes, setDateLocale } from '@/lib/date';

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
check('本周专注时间', formatMinutes(s.week_focus_min), '8小时59分钟');
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

console.log('\n--- S2 已完成视图分组 ---');
const groups = completedGroups();
check('分组数', groups.length, 3);
for (const g of groups) {
  const total = g.records.reduce((a, r) => a + r.duration_min, 0);
  console.log(`      ${g.dateKey}  ${g.records.length} 条  ${total}min`);
}
check('今天组条数', groups.find((g) => g.dateKey === new Date().toISOString().slice(0, 10))?.records.length ?? -1, 1);

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
