// 查询与统计口径 —— PRD §5.2 分类筛选 / §7.2 统计口径 / §7.3 日期分组
//
// 所有指标均由 focus_records / tasks 实时聚合，不做前端缓存（PRD §8.8-3）。

import type {
  FocusRecord, GridCell, ListDistribution, Period, SmartKey, Stats, Task, TaskDuration,
} from '@/types';
import { getDB } from './idb';
import {
  addDays, endOfWeek, periodRange, recentDateKeys, startOfDay, startOfWeek, toDateKey,
} from '@/lib/date';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ── 分类筛选（PRD §5.2） ────────────────────────────────────────────────

export function tasksForCategory(key: SmartKey): Task[] {
  const { tasks } = getDB();
  const today = startOfDay(new Date()).getTime();
  const tomorrow = startOfDay(addDays(new Date(), 1)).getTime();
  const weekEnd = endOfWeek(new Date()).getTime();

  const dueTs = (t: Task) => (t.due_date ? startOfDay(new Date(t.due_date)).getTime() : null);

  const filtered = tasks.filter((t) => {
    const due = dueTs(t);
    switch (key) {
      case 'today':
        return t.completed === 0 && due === today;
      case 'tomorrow':
        return t.completed === 0 && due === tomorrow;
      case 'week':
        return t.completed === 0 && due !== null && due >= today && due <= weekEnd;
      case 'scheduled':
        return t.completed === 0 && due !== null;
      case 'completed':
        return t.completed === 1;
      case 'tasks':
      default:
        return t.completed === 0;
    }
  });

  return filtered.sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

export function tasksInList(listId: string, includeCompleted = false): Task[] {
  return getDB()
    .tasks.filter((t) => t.list_id === listId && (includeCompleted || t.completed === 0))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

export function completedTasksForCategory(key: SmartKey): Task[] {
  if (key === 'tasks' || key === 'today' || key === 'tomorrow' || key === 'week' || key === 'scheduled') {
    // 「显示已完成任务」：该视图口径下已完成的部分
    const { tasks } = getDB();
    if (key === 'tasks') return tasks.filter((t) => t.completed === 1);
    return [];
  }
  return [];
}

export function searchTasks(q: string): Task[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return getDB().tasks.filter((t) => t.title.toLowerCase().includes(needle));
}

export function searchLists(q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return getDB().lists.filter((l) => l.name.toLowerCase().includes(needle));
}

// ── 专注记录 ────────────────────────────────────────────────────────────

export function recordsInRange(from: number, to: number, taskId?: string): FocusRecord[] {
  return getDB()
    .focus_records.filter(
      (r) => r.start_at >= from && r.start_at <= to && (taskId === undefined || r.task_id === taskId),
    )
    .sort((a, b) => a.start_at - b.start_at);
}

export function todayRecords(): FocusRecord[] {
  const s = startOfDay(new Date()).getTime();
  return recordsInRange(s, s + 86_400_000 - 1);
}

/** 已完成视图分组：按记录 end_at 的日期归档（PRD §7.3 / FR-C1） */
export function completedGroups(): Array<{ dateKey: string; records: FocusRecord[] }> {
  const map = new Map<string, FocusRecord[]>();
  for (const r of getDB().focus_records) {
    const k = toDateKey(r.end_at);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // 日期倒序
    .map(([dateKey, records]) => ({
      dateKey,
      records: records.sort((a, b) => a.start_at - b.start_at),
    }));
}

export function taskTitle(taskId: string | null): string {
  if (!taskId) return '未指定任务';
  const t = getDB().tasks.find((x) => x.id === taskId);
  return t ? t.title : '未指定任务';
}

// ── 统计口径（PRD §7.2） ────────────────────────────────────────────────

export function computeStats(): Stats {
  const db = getDB();
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const todayEnd = todayStart + 86_400_000 - 1;
  const weekStart = startOfWeek(now).getTime();
  const goalMin = db.goals[0]?.daily_target_min ?? 180;

  const recs = db.focus_records;
  const totalFocus = sum(recs.map((r) => r.duration_min));
  const weekFocus = sum(recs.filter((r) => r.start_at >= weekStart).map((r) => r.duration_min));
  const todayFocus = sum(
    recs.filter((r) => r.start_at >= todayStart && r.start_at <= todayEnd).map((r) => r.duration_min),
  );

  const doneAt = (t: Task) => t.completed_at ?? 0;
  const totalDone = db.tasks.filter((t) => t.completed === 1).length;
  const weekDone = db.tasks.filter((t) => t.completed === 1 && doneAt(t) >= weekStart).length;
  const todayDone = db.tasks.filter(
    (t) => t.completed === 1 && doneAt(t) >= todayStart && doneAt(t) <= todayEnd,
  ).length;

  // 每日目标日历（FR-R6）：专注天数 / 完成目标天数 / 完成率
  const perDay = new Map<string, number>();
  for (const r of recs) {
    const k = toDateKey(r.start_at);
    perDay.set(k, (perDay.get(k) ?? 0) + r.duration_min);
  }
  const focusDays = perDay.size;
  const goalDays = [...perDay.values()].filter((m) => m >= goalMin).length;
  const goalRate = focusDays === 0 ? 0 : Math.round((goalDays / focusDays) * 100);

  return {
    total_focus_min: totalFocus,
    week_focus_min: weekFocus,
    today_focus_min: todayFocus,
    total_done_tasks: totalDone,
    week_done_tasks: weekDone,
    today_done_tasks: todayDone,
    focus_days: focusDays,
    goal_days: goalDays,
    goal_rate: goalRate,
    daily_target_min: goalMin,
  };
}

/** 任务视图统计卡片（PRD FR-T2） */
export function computeTaskCards(key: SmartKey, focusLenMin: number) {
  const today = startOfDay(new Date()).getTime();
  const tasks = tasksForCategory(key);
  const db = getDB();
  const stats = computeStats();

  const estMin = sum(
    db.tasks
      .filter(
        (t) =>
          t.completed === 0 &&
          t.due_date !== null &&
          startOfDay(new Date(t.due_date)).getTime() === today,
      )
      .map((t) => t.est_pomodoros * focusLenMin),
  );

  return {
    est_min: estMin,
    pending: tasks.length,
    focus_min: stats.total_focus_min,
    done: stats.today_done_tasks,
  };
}

/** 侧边栏每分类的已专注时长（PRD §7.2「分类已专注时长」） */
export function categoryFocusMinutes(key: SmartKey): number {
  const db = getDB();
  if (key === 'today') return computeStats().today_focus_min; // PRD 明确：今天 = 今日记录时长
  if (key === 'completed') {
    const ids = new Set(db.tasks.filter((t) => t.completed === 1).map((t) => t.id));
    return sum(db.focus_records.filter((r) => r.task_id && ids.has(r.task_id)).map((r) => r.duration_min));
  }
  const ids = new Set(tasksForCategory(key).map((t) => t.id));
  return sum(db.focus_records.filter((r) => r.task_id && ids.has(r.task_id)).map((r) => r.duration_min));
}

/** 侧边栏任务数角标 */
export function categoryTaskCount(key: SmartKey): number {
  return tasksForCategory(key).length;
}

// ── 报表数据源 ──────────────────────────────────────────────────────────

/** FR-R3 番茄记录图：时间 × 日期 网格 */
export function pomodoroGrid(days = 14): { dates: string[]; cells: GridCell[] } {
  const dates = recentDateKeys(days);
  const wanted = new Set(dates);
  const acc = new Map<string, { minutes: number; count: number }>();

  for (const r of getDB().focus_records) {
    const dk = toDateKey(r.start_at);
    if (!wanted.has(dk)) continue;
    // 一条记录可能跨小时，按分钟摊到每个小时格
    let cursor = r.start_at;
    const end = r.end_at;
    while (cursor < end) {
      const hour = new Date(cursor).getHours();
      const hourEnd = new Date(cursor);
      hourEnd.setMinutes(59, 59, 999);
      const sliceEnd = Math.min(hourEnd.getTime(), end);
      const mins = Math.max(1, Math.round((sliceEnd - cursor) / 60000));
      const key = `${dk}#${hour}`;
      const cur = acc.get(key) ?? { minutes: 0, count: 0 };
      cur.minutes += mins;
      cur.count += 1;
      acc.set(key, cur);
      cursor = sliceEnd + 1;
    }
  }

  const cells: GridCell[] = [];
  for (const [key, v] of acc) {
    const [date, hour] = key.split('#');
    cells.push({ date, hour: Number(hour), minutes: v.minutes, count: v.count });
  }
  return { dates, cells };
}

/** FR-R4 专注时间详情：周期内按任务聚合时长 */
export function taskDurations(period: Period, anchor: Date): { items: TaskDuration[]; total: number } {
  const [from, to] = periodRange(period, anchor);
  const recs = recordsInRange(from, to);
  const map = new Map<string, number>();
  for (const r of recs) {
    const k = r.task_id ?? '__none__';
    map.set(k, (map.get(k) ?? 0) + r.duration_min);
  }
  const items: TaskDuration[] = [...map.entries()]
    .map(([k, minutes]) => ({
      task_id: k === '__none__' ? null : k,
      title: taskTitle(k === '__none__' ? null : k),
      minutes,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  return { items, total: sum(items.map((i) => i.minutes)) };
}

/** FR-R5 清单时间分布 */
export function listDistribution(period: Period, anchor: Date): { items: ListDistribution[]; total: number } {
  const [from, to] = periodRange(period, anchor);
  const recs = recordsInRange(from, to);
  const db = getDB();
  const map = new Map<string, number>();
  for (const r of recs) {
    const k = r.list_id ?? '__none__';
    map.set(k, (map.get(k) ?? 0) + r.duration_min);
  }
  const total = sum([...map.values()]);
  const items: ListDistribution[] = [...map.entries()]
    .map(([k, minutes]) => {
      const list = db.lists.find((l) => l.id === k);
      return {
        list_id: k === '__none__' ? null : k,
        name: list ? list.name : '未指定任务',
        minutes,
        percent: total === 0 ? 0 : Math.round((minutes / total) * 100),
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
  return { items, total };
}

/** FR-R6 每日专注目标日历 */
export function dailyFocusMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of getDB().focus_records) {
    const k = toDateKey(r.start_at);
    map.set(k, (map.get(k) ?? 0) + r.duration_min);
  }
  return map;
}

/** 今日面板：待完成任务（PRD FR-P2 右侧「今天」列表） */
export function todayPendingTasks(): Task[] {
  const db = getDB();
  const today = startOfDay(new Date()).getTime();
  const weekEnd = endOfWeek(new Date()).getTime();
  const due = (t: Task) => (t.due_date ? startOfDay(new Date(t.due_date)).getTime() : null);
  // 今天到期优先；无今日到期任务时回落到本周/全部未完成，保证面板可用
  const todayDue = db.tasks.filter((t) => t.completed === 0 && due(t) === today);
  if (todayDue.length) return todayDue;
  const weekDue = db.tasks.filter((t) => {
    const d = due(t);
    return t.completed === 0 && d !== null && d >= today && d <= weekEnd;
  });
  if (weekDue.length) return weekDue;
  return db.tasks.filter((t) => t.completed === 0);
}

/** 今日已完成番茄数（悬浮小窗数字，PRD FR-G4） */
export function todayPomodoroCount(taskId?: string | null): number {
  const recs = todayRecords();
  if (taskId === undefined) return recs.length;
  return recs.filter((r) => r.task_id === taskId).length;
}
