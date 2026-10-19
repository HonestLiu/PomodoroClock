// 到时提醒（纯函数）——「提醒事项」时间 + 提前提醒
// 仅当任务设置了 due_date + due_time 才触发（规格：时间关闭则无"到点应用通知"）。
// 由 App 的 30s 巡检调用 `taskRemindAt` 决定是否到点。

import type { LeadRemind, Task } from '@/types';

/** '1d'|'2d'|'1w' → 毫秒（提前量） */
export function leadMs(lead: LeadRemind): number {
  const DAY = 86_400_000;
  switch (lead) {
    case '1d': return DAY;
    case '2d': return 2 * DAY;
    case '1w': return 7 * DAY;
    default: return 0;
  }
}

/** 由 date('YYYY-MM-DD') + time('HH:MM') 拼本地时间戳；缺任一返回 null */
export function dueTimestamp(date: string, time: string | null): number | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * 该任务的提醒时刻（提前量之后）。无 due_time 的任务不触发（返回 null）——
 * 与规格「时间：关闭则无到点提醒」一致；纯日期任务靠逾期显示而非系统提醒。
 */
export function taskRemindAt(task: Task): number | null {
  if (!task.due_date) return null;
  const due = dueTimestamp(task.due_date, task.due_time);
  if (due === null) return null;
  return due - leadMs(task.lead_remind);
}

/** 是否应触发（未完成、到点、且未被这次提醒标记过） */
export function shouldRemind(task: Task, now = Date.now()): boolean {
  if (task.completed === 1) return false;
  const at = taskRemindAt(task);
  if (at === null) return false;
  return at <= now && (task.reminded_at === null || task.reminded_at < at);
}