// 派生查询（纯函数）—— 数据由调用方传入。
//
// 为什么需要它：`db/queries.ts` 直接读取 IndexedDB（`getDB()`），那是**浏览器适配器**的存储。
// 在 Tauri 运行时数据在 SQLite，IndexedDB 从未初始化，若 UI 仍调用 db/queries 会永远得到空结果
// （历史缺陷：桌面版任务列表恒为空）。因此 UI 一律使用本文件的纯函数，
// 数据来源为 store（经 src/api 从「当前运行时」加载），两种运行时行为一致。

import type {
  FocusRecord, SmartKey, Stats, Task, TaskList,
} from '@/types';
import {
  addDays, endOfWeek, startOfDay, startOfWeek, toDateKey, todayKey,
} from './date';
import { tStatic } from '@/i18n';

/** 一次派生所需的全部数据 */
export interface Dataset {
  tasks: Task[];
  lists: TaskList[];
  records: FocusRecord[];
}

export const emptyDataset: Dataset = { tasks: [], lists: [], records: [] };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const dueTs = (t: Task) => (t.due_date ? startOfDay(new Date(t.due_date)).getTime() : null);

// ── 分类筛选（PRD §5.2） ────────────────────────────────────────────────

export function tasksForCategory(ds: Dataset, key: SmartKey): Task[] {
  const today = startOfDay(new Date()).getTime();
  const tomorrow = startOfDay(addDays(new Date(), 1)).getTime();
  const weekStart = startOfWeek(new Date()).getTime();
  const weekEnd = endOfWeek(new Date()).getTime();

  const filtered = ds.tasks.filter((t) => {
    const due = dueTs(t);
    switch (key) {
      // 今天：到期日 = 今天，**以及所有逾期任务**（用户需求：逾期不沉到「任务」，留在时间清单并打逾期标志）
      case 'today': return t.completed === 0 && due !== null && due <= today;
      // 明天：严格 = 明天（到期即今天的任务已在「今天」，逾期同理）
      case 'tomorrow': return t.completed === 0 && due === tomorrow;
      // 本周：本周窗口 + 所有逾期（今天 ⊂ 本周，逾期任务随「今天」一并留在本周）
      case 'week': return t.completed === 0 && due !== null && due <= weekEnd;
      case 'scheduled': return t.completed === 0 && due !== null;
      case 'completed': return t.completed === 1;
      // 「记录」视图展示的是专注记录而非任务，任务集合为空
      case 'records': return false;
      case 'tasks':
      default: return t.completed === 0;
    }
  });

  // 今天/本周：逾期任务置顶（越久远越靠前），其后按到期日、再按排序/创建时间
  if (key === 'today' || key === 'week') {
    return filtered.sort((a, b) => {
      const da = dueTs(a) ?? 0, db = dueTs(b) ?? 0;
      const oa = da < (key === 'week' ? weekStart : today) ? 0 : 1;
      const ob = db < (key === 'week' ? weekStart : today) ? 0 : 1;
      return oa - ob || da - db || a.sort_order - b.sort_order || a.created_at - b.created_at;
    });
  }
  return filtered.sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

/** 逾期：未完成且到期日早于今天本地 00:00（无到期日不算） */
export function isOverdue(t: Task): boolean {
  if (t.completed === 1 || !t.due_date) return false;
  return startOfDay(new Date(t.due_date)).getTime() < startOfDay(new Date()).getTime();
}

const DAY_MS = 86_400_000;

/**
 * 分类视图「显示已完成任务」的已完成列表 —— 只包含**属于当前分类窗口**的已完成任务
 * （PRD 用户需求：例如「今天」下只显示今天勾选完成的任务，而非全局已完成）。
 * 按任务的完成时间 completed_at 归属分类：
 *   今天/明天/本周 -> completed_at 落在该时间窗；已计划 -> 有到期日；任务 -> 全部已完成；清单 -> 清单内。
 */
export function completedForCategory(ds: Dataset, key: SmartKey): Task[] {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const todayEnd = todayStart + DAY_MS - 1;
  const tomorrowStart = startOfDay(addDays(now, 1)).getTime();
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = endOfWeek(now).getTime();

  return ds.tasks
    .filter((t) => {
      if (t.completed !== 1) return false;
      const c = t.completed_at ?? 0;
      switch (key) {
        case 'today':     return c >= todayStart && c <= todayEnd;
        case 'tomorrow':  return c >= tomorrowStart && c <= tomorrowStart + DAY_MS - 1;
        case 'week':      return c >= weekStart && c <= weekEnd;
        case 'scheduled': return t.due_date != null;
        case 'records':   return false;
        case 'tasks':
        default:          return true;
      }
    })
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
}

export function tasksInList(ds: Dataset, listId: string, includeCompleted = false): Task[] {
  return ds.tasks
    .filter((t) => t.list_id === listId && (includeCompleted || t.completed === 0))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

/** 今日到期的未完成任务（番茄钟任务选择框用） */
export function todayDueTasks(ds: Dataset): Task[] {
  const today = todayKey();
  return ds.tasks
    .filter((t) => t.completed === 0 && t.due_date === today)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

export function searchTasks(ds: Dataset, q: string): Task[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  return ds.tasks.filter((t) => t.title.toLowerCase().includes(n));
}

export function searchLists(ds: Dataset, q: string) {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  return ds.lists.filter((l) => l.name.toLowerCase().includes(n));
}

export function taskTitle(ds: Dataset, taskId: string | null): string {
  // 兜底文案走词表：英文界面下不再露出中文「未指定任务」
  const fallback = tStatic('task.unspecified');
  if (!taskId) return fallback;
  return ds.tasks.find((t) => t.id === taskId)?.title ?? fallback;
}

// ── 专注记录 ────────────────────────────────────────────────────────────

export function todayRecords(ds: Dataset): FocusRecord[] {
  const s = startOfDay(new Date()).getTime();
  const e = s + 86_400_000 - 1;
  return ds.records
    .filter((r) => r.start_at >= s && r.start_at <= e)
    .sort((a, b) => a.start_at - b.start_at);
}

/** 已完成视图分组：按记录 end_at 的日期归档（PRD §7.3 / FR-C1） */
export function completedGroups(ds: Dataset): Array<{ dateKey: string; records: FocusRecord[] }> {
  const map = new Map<string, FocusRecord[]>();
  for (const r of ds.records) {
    const k = toDateKey(r.end_at);
    const arr = map.get(k);
    if (arr) arr.push(r); else map.set(k, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dateKey, records]) => ({ dateKey, records: records.sort((a, b) => a.start_at - b.start_at) }));
}

/**
 * 「已完成」视图分组：已完成任务按 `completed_at` 的日期倒序归档（PRD §5.3）。
 * 与 `completedGroups`（专注记录按 end_at 归档，「记录」视图）是两套口径：
 * 一边是任务勾选完成，一边是番茄专注结束。
 */
export function completedTaskGroups(ds: Dataset): Array<{ dateKey: string; tasks: Task[] }> {
  const map = new Map<string, Task[]>();
  for (const t of ds.tasks) {
    if (t.completed !== 1) continue;
    const k = toDateKey(t.completed_at ?? t.updated_at);
    const arr = map.get(k);
    if (arr) arr.push(t); else map.set(k, [t]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dateKey, tasks]) => ({
      dateKey,
      tasks: tasks.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0)),
    }));
}

/** 今日已完成番茄数（悬浮小窗，PRD FR-G4） */
export function todayPomodoroCount(ds: Dataset, taskId?: string | null): number {
  const recs = todayRecords(ds);
  if (taskId === undefined) return recs.length;
  return recs.filter((r) => r.task_id === taskId).length;
}

/** 每日专注时长映射（报表日历，PRD FR-R6） */
export function dailyFocusMap(ds: Dataset): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of ds.records) {
    const k = toDateKey(r.start_at);
    map.set(k, (map.get(k) ?? 0) + r.duration_min);
  }
  return map;
}

/** 近 N 天每日专注时长（含 0 值日，右边为最新）—— report.md ★1 趋势图 */
export function focusTrend(ds: Dataset, days: number): Array<{ dateKey: string; minutes: number }> {
  const today = startOfDay(new Date());
  const map = new Map<string, number>();
  for (const r of ds.records) {
    const k = toDateKey(r.start_at);
    if (k > toDateKey(today)) continue;
    map.set(k, (map.get(k) ?? 0) + r.duration_min);
  }
  const out: Array<{ dateKey: string; minutes: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const dkKey = toDateKey(addDays(today, -i));
    out.push({ dateKey: dkKey, minutes: map.get(dkKey) ?? 0 });
  }
  return out;
}

// ── 侧边栏（PRD §7.2 分类已专注时长 / 角标） ────────────────────────────

/**
 * 专注时长，排除「已完成任务」相关记录。
 * 用户需求：侧边栏「任务」类目的时间不考虑已完成任务——只统计当前未完成任务的专注时长。
 * 未绑定任务的记录（task_id 为空，「未指定任务」）不属于已完成，仍计入。
 */
export function focusMinExcludingCompleted(ds: Dataset): number {
  const doneIds = new Set(ds.tasks.filter((t) => t.completed === 1).map((t) => t.id));
  return sum(ds.records.filter((r) => !r.task_id || !doneIds.has(r.task_id)).map((r) => r.duration_min));
}

/** 单个清单的聚合：未完成任务数 + 这些任务的专注时长（排除已完成任务记录） */
export function listAggregate(ds: Dataset, listId: string): { count: number; minutes: number } {
  const tasks = ds.tasks.filter((t) => t.list_id === listId && t.completed === 0);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    count: tasks.length,
    minutes: sum(ds.records.filter((r) => r.task_id && ids.has(r.task_id)).map((r) => r.duration_min)),
  };
}

/** 清单夹聚合：夹内所有清单的未完成任务数 + 专注时长 */
export function folderAggregate(ds: Dataset, folderId: string): { count: number; minutes: number } {
  let count = 0;
  let minutes = 0;
  for (const l of ds.lists) {
    if (l.folder_id !== folderId) continue;
    const a = listAggregate(ds, l.id);
    count += a.count;
    minutes += a.minutes;
  }
  return { count, minutes };
}

export function categoryTaskCount(ds: Dataset, key: SmartKey): number {
  // 「记录」入口的角标 = 已完成番茄数（专注记录条数），不是任务数
  if (key === 'records') return ds.records.length;
  return tasksForCategory(ds, key).length;
}

/**
 * 分类已专注时长（PRD §7.2）：今天=今日记录；本周=本周记录；任务=当前未完成任务的记录（不考虑已完成）；
 * 已完成=已完成任务相关记录；明天/已计划=该分类待办任务相关记录。
 */
export function categoryFocusMinutes(ds: Dataset, key: SmartKey, todayFocusMin: number): number {
  const weekStart = startOfWeek(new Date()).getTime();
  // 「记录」= 全部专注时长（该入口就是专注归档，不做任务过滤）
  if (key === 'records') return sum(ds.records.map((r) => r.duration_min));
  if (key === 'today') return todayFocusMin; // PRD 明确：今天 = 今日记录时长
  if (key === 'week') return sum(ds.records.filter((r) => r.start_at >= weekStart).map((r) => r.duration_min));
  if (key === 'tasks') return focusMinExcludingCompleted(ds); // 任务：不考虑已完成任务的记录
  if (key === 'completed') {
    const ids = new Set(ds.tasks.filter((t) => t.completed === 1).map((t) => t.id));
    return sum(ds.records.filter((r) => r.task_id && ids.has(r.task_id)).map((r) => r.duration_min));
  }
  const ids = new Set(tasksForCategory(ds, key).map((t) => t.id));
  return sum(ds.records.filter((r) => r.task_id && ids.has(r.task_id)).map((r) => r.duration_min));
}

// ── 统计卡片（PRD FR-T2） ───────────────────────────────────────────────

export function computeTaskCards(
  ds: Dataset, key: SmartKey, focusLenMin: number, stats: Stats | null, listId: string | null = null,
) {
  const today = startOfDay(new Date()).getTime();
  const tomorrow = startOfDay(addDays(new Date(), 1)).getTime();
  const weekEnd = endOfWeek(new Date()).getTime();
  const dueTs = (t: Task): number | null => (t.due_date ? startOfDay(new Date(t.due_date)).getTime() : null);

  // 「记录」视图不复用任务统计卡（页面自带记录统计栏），且不是任务集合，直接短路
  if (key === 'records') return { est_min: 0, pending: 0, focus_min: 0, done: 0 };

  // 清单视图（TaskView 在 listId 下把 key 压成 'tasks'）：待办集合必须是该清单的任务，
  // 不能走 tasksForCategory(ds,'tasks')（那是全部未完成任务），否则「已专注时间」会恒等于总专注时间。
  const pendingTasks = listId ? tasksInList(ds, listId) : tasksForCategory(ds, key);
  const pendingIds = new Set(pendingTasks.map((t) => t.id));

  // 预计时间：
  //  - 清单视图：该清单全部待办的预估番茄数 × 专注时长；
  //  - 「任务」智能分类按 PRD FR-T2 仅取今日到期；
  //  - 其余分类：分类窗口内待办。
  const estMin = listId
    ? sum(pendingTasks.map((t) => t.est_pomodoros * focusLenMin))
    : key === 'tasks'
      ? sum(ds.tasks.filter((t) => t.completed === 0 && dueTs(t) === today).map((t) => t.est_pomodoros * focusLenMin))
      : sum(pendingTasks.map((t) => t.est_pomodoros * focusLenMin));

  const completedTasks = ds.tasks.filter((t) => t.completed === 1);
  const completedIds = new Set(completedTasks.map((t) => t.id));

  // 已专注时间：
  //  - 清单视图 = 该清单任务（含已完成）的全部记录，与侧边栏 listAggregate 同口径；
  //  - 今日=今日记录；本周=本周记录；任务视图=全部；已完成=已完成任务相关；其余=该分类任务相关记录。
  let focusMin: number;
  if (listId) {
    const listTaskIds = new Set(ds.tasks.filter((t) => t.list_id === listId).map((t) => t.id));
    focusMin = sum(ds.records.filter((r) => r.task_id && listTaskIds.has(r.task_id)).map((r) => r.duration_min));
  } else if (key === 'today') focusMin = stats?.today_focus_min ?? 0;
  else if (key === 'week') focusMin = stats?.week_focus_min ?? 0;
  else if (key === 'tasks') focusMin = stats?.total_focus_min ?? 0;
  else if (key === 'completed') focusMin = sum(ds.records.filter((r) => r.task_id && completedIds.has(r.task_id)).map((r) => r.duration_min));
  else focusMin = sum(ds.records.filter((r) => r.task_id && pendingIds.has(r.task_id)).map((r) => r.duration_min));

  // 已完成任务：按分类口径
  let done: number;
  switch (key) {
    case 'today': done = completedTasks.filter((t) => dueTs(t) === today).length; break;
    case 'tomorrow': done = completedTasks.filter((t) => dueTs(t) === tomorrow).length; break;
    case 'week': done = completedTasks.filter((t) => { const d = dueTs(t); return d !== null && d >= today && d <= weekEnd; }).length; break;
    case 'scheduled': done = completedTasks.filter((t) => dueTs(t) !== null).length; break;
    case 'tasks': done = stats?.today_done_tasks ?? 0; break;
    case 'completed': done = completedTasks.length; break;
    default: done = 0;
  }
  if (listId) {
    done = ds.tasks.filter((t) => t.list_id === listId && t.completed === 1).length;
  }

  return {
    est_min: estMin,
    pending: pendingTasks.length,
    focus_min: focusMin,
    done,
  };
}

// ── 今日面板（PRD FR-P2 右侧「今天」） ──────────────────────────────────

export function todayPendingTasks(ds: Dataset): Task[] {
  const today = startOfDay(new Date()).getTime();
  const weekEnd = endOfWeek(new Date()).getTime();
  const due = (t: Task) => (t.due_date ? startOfDay(new Date(t.due_date)).getTime() : null);
  const todayDue = ds.tasks.filter((t) => t.completed === 0 && due(t) === today);
  if (todayDue.length) return todayDue;
  const weekDue = ds.tasks.filter((t) => {
    const d = due(t);
    return t.completed === 0 && d !== null && d >= today && d <= weekEnd;
  });
  if (weekDue.length) return weekDue;
  return ds.tasks.filter((t) => t.completed === 0);
}
