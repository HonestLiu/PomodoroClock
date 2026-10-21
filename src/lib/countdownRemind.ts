// 倒数纪念日提醒巡检 —— 复用任务到时提醒的成熟模式（docs/05-modules/countdown.md）
// 由 App 挂 30s 轮询 + 启动补查一次。命中：写应用内通知（type=countdown_remind）
// +（可选）系统通知，并置 reminded_at 去重。改期/改提前天数后自动重新武装。

import type { Countdown, Settings } from '@/types';
import { shouldRemindFor } from './countdown';
import { ensureSystemPermission, systemNotify } from './systemNotify';
import { api } from '@/api';
import { todayKey } from './date';

export interface CountdownRemindDeps {
  createNotification(args: { type: string; title: string; body: string }): Promise<unknown>;
  markReminded(id: string): Promise<void>;
}

/** 扫描一遍纪念日，返回触发提醒的标题（便于测试/断言）。 */
export async function scanCountdownReminders(
  countdowns: Countdown[],
  settings: Pick<Settings, 'notify_enabled' | 'system_notify'>,
  deps: CountdownRemindDeps,
  today = todayKey(),
): Promise<string[]> {
  const due = countdowns.filter((c) => shouldRemindFor(c, today, c.reminded_at));
  for (const c of due) {
    await deps.createNotification({
      type: 'countdown_remind',
      title: c.title,
      body: `${c.date} · ${formatKind(c)}`,
    });
    await deps.markReminded(c.id);
    if (settings.notify_enabled && settings.system_notify) {
      if (await ensureSystemPermission()) systemNotify(c.title, c.date);
    }
  }
  return due.map((c) => c.title);
}

/** 通知正文里的简短描述（避免循环依赖 i18n，用纯枚举文案） */
function formatKind(c: Countdown): string {
  if (c.kind === 'yearly') return '每年';
  if (c.kind === 'days_elapsed') return '已过';
  // 提前 N 天触发文案
  return c.remind_days > 0 ? `提前 ${c.remind_days} 天` : '今天';
}

/** 默认 deps：直接打 api。App 侧用。 */
export function defaultCountdownRemindDeps(): CountdownRemindDeps {
  return {
    createNotification: (args) => api.create_notification(args),
    markReminded: (id) => api.mark_countdown_reminded(id),
  };
}