// 重复引擎（纯函数，便于单测）——「提醒事项」真正重复
// 完成一个重复任务时，推进到下一次（date + time）；永不（none）不推进。
// 只做日期/时间的推移，不触碰其他字段；由 dataStore.toggleTask 调用。

import type { Recurrence } from '@/types';

const pad = (n: number) => String(n).padStart(2, '0');

function mk(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function hm(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 由 date ('YYYY-MM-DD') + time ('HH:MM' | null, 默认 08:00) 拼本地 Date */
function toDate(date: string, time: string | null, base = 8): Date {
  const [y, m, d] = date.split('-').map(Number);
  const hh = time ? Number(time.split(':')[0]) : base;
  const mm = time ? Number(time.split(':')[1]) : 0;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export interface DuePoint { date: string; time: string | null }

/**
 * 由当前到期点推进到下一次。
 * @param current 当前 due_date / due_time；due_date 为空时以 today 为基准
 * @param repeat  重复规则（none 返回 null）
 */
export function nextOccurrence(
  current: { date: string | null; time: string | null },
  repeat: Recurrence,
  now = new Date(),
): DuePoint | null {
  if (repeat === 'none') return null;

  const baseDate = current.date ?? mk(now);
  const base = toDate(baseDate, current.time);

  // hourly：仅当选了时间才有意义；否则退化为 daily
  if (repeat === 'hourly' && current.time) {
    const next = new Date(base.getTime() + 3_600_000);
    return { date: mk(next), time: hm(next) };
  }
  if (repeat === 'hourly') repeat = 'daily';

  // 非 hourly：日期按规则推进，时间保持不变
  let next: Date;
  switch (repeat) {
    case 'daily': next = addD(base, 1); break;
    case 'weekly': next = addD(base, 7); break;
    case 'weekdays': next = nextWeekday(base); break;
    case 'weekends': next = nextSaturday(base); break;
    default: return null;
  }
  return { date: mk(next), time: current.time };
}

function addD(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 下一工作日（周一~周五）：周五→下周一（+3），周六→下周一（+2），周日→下周一（+1） */
function nextWeekday(d: Date): Date {
  const dow = d.getDay(); // 0=Sun
  const add = dow === 0 ? 1 : dow === 6 ? 2 : dow === 5 ? 3 : 1;
  return addD(d, add);
}

/** 下一个周六：周六→下周六（+7）；周日→下周六（+6）；其余→本周六 */
function nextSaturday(d: Date): Date {
  const dow = d.getDay();
  const add = dow === 6 ? 7 : (6 - dow + 7) % 7 || 7;
  return addD(d, add === 0 ? 7 : add);
}