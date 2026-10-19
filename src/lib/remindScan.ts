// 到时提醒巡检 —— 「提醒事项」时间 + 提前提醒（原 backlog #16）
// 由 App 挂 30s 轮询 + 启动补查一次。命中后：写应用内通知 +（可选）系统通知，
// 并置 reminded_at 去重。改了时间/日期后 reminded_at < remind_at 会自动重新武装。

import type { Task, Settings } from '@/types';
import { shouldRemind } from './taskRemind';
import { ensureSystemPermission, systemNotify } from './systemNotify';
import { api } from '@/api';

export interface RemindDeps {
  createNotification(args: { type: string; title: string; body: string }): Promise<unknown>;
  markReminded(taskId: string, at: number): Promise<void>;
}

/**
 * 扫描一遍任务，返回触发提醒的标题（便于测试/断言）。
 * @param now 当前毫秒时间戳（可注入便于测试）
 */
export async function scanTaskReminders(
  tasks: Task[],
  settings: Pick<Settings, 'notify_enabled' | 'system_notify'>,
  deps: RemindDeps,
  now = Date.now(),
): Promise<string[]> {
  const due = tasks.filter((t) => shouldRemind(t, now));
  for (const t of due) {
    // 先写应用内通知（铃铛），再去重，最后按需发系统通知
    await deps.createNotification({
      type: 'task_remind',
      title: t.title,
      body: t.due_time ? `${t.due_date ?? ''} ${t.due_time}` : (t.due_date ?? ''),
    });
    await deps.markReminded(t.id, now);
    if (settings.notify_enabled && settings.system_notify) {
      if (await ensureSystemPermission()) systemNotify(t.title, t.due_time ?? '');
    }
  }
  return due.map((t) => t.title);
}

/** 默认 deps：直接打 api + 置 reminded_at。App 侧用。 */
export function defaultRemindDeps(): RemindDeps {
  return {
    createNotification: (args) => api.create_notification(args),
    markReminded: async (taskId, at) => {
      await api.update_task(taskId, { reminded_at: at });
    },
  };
}