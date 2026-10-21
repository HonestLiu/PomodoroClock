// 倒数纪念日 —— 日期与文案纯函数（docs/05-modules/countdown.md）
// 边界口径（PRD 需求三）：
//  - 自然日差：先折 UTC 零点再差，**绝不用 24h 差**（规避 DST ±1h 漂移）。
//  - 每年重复：跨年自动翻；2/29 在平年按 2/28 计入（生日惯例，用户已确认）。
//  - 今天/明天/昨天、已过/未来文案分别处理。
// 不依赖 React 或数据库，可被 verify-countdown.ts / 双运行时复用。

import type { Countdown } from '@/types';
import { addDays, parseDateKey, toDateKey } from './date';

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 每年重复在某年的「当年发生日」：存储 02-29 且该年不是闰年 → 按 02-28。 */
export function yearlyOccurrenceOn(date: string, year: number): string {
  const d = parseDateKey(date);
  const m = d.getMonth();
  let day = d.getDate();
  if (m === 1 && day === 29 && !isLeapYear(year)) day = 28; // 2/29 → 2/28
  return toDateKey(new Date(year, m, day));
}

/** 自然日差：(b − a)，单位天，符号=方向。0=同一天。避免 DST。 */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  const ut = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
  return Math.round((ut(yb, mb, db) - ut(ya, ma, da)) / 86_400_000);
}

/** 按自然日加减（内部用 addDays，二者口径一致） */
export function addDaysKey(key: string, n: number): string {
  return toDateKey(addDays(parseDateKey(key), n));
}

/** 每月推进：保持「日」并在月末截断（31 号在 2 月 → 2/28、闰年 2/29）。 */
function advanceMonthKey(key: string, months: number): string {
  const d = parseDateKey(key);
  const y = d.getFullYear();
  const m0 = d.getMonth();
  const total = y * 12 + m0 + months;
  const y2 = Math.floor(total / 12);
  const m2 = ((total % 12) + 12) % 12;
  const lastDay = new Date(y2, m2 + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDay);
  return toDateKey(new Date(y2, m2, day));
}

/**
 * 生效的重复规则：`kind=yearly` 隐式每年（类型=每年重复），其余按 `repeat`。
 * **推进靠 repeat，展示靠 kind** —— 例如「倒数日 + 每年」也要自动翻年。
 */
function effectiveRepeat(c: Pick<Countdown, 'kind' | 'repeat'>): Countdown['repeat'] {
  return c.kind === 'yearly' ? 'yearly' : c.repeat;
}

/**
 * 下一次发生日期键（本地时区，按 today 评估）：
 *  - once：固定为 `date`（已过仍返回，由文案判「已过」）。
 *  - yearly：今年该日（含今天）；早于今天则翻到下一年。02-29 平年按 02-28。
 *  - monthly：逐月走到「>= today」的当日（月末截断）。
 *  - custom_days：以 date 为起点，每 interval_days 递增到「>= today」。
 */
export function nextDateKey(
  c: Pick<Countdown, 'kind' | 'repeat' | 'date' | 'interval_days'>,
  today: string,
): string {
  const rep = effectiveRepeat(c);
  if (rep === 'once') return c.date;
  if (rep === 'yearly') {
    const ty = parseDateKey(today).getFullYear();
    const thisY = yearlyOccurrenceOn(c.date, ty);
    return thisY >= today ? thisY : yearlyOccurrenceOn(c.date, ty + 1);
  }
  if (rep === 'monthly') {
    // 锚点步进：每次从原 date 推 n 个月（而非从上次结果累加），
    // 否则 1/31 → 2/28 之后会一路变成 3/28、4/28…… 原来的「日」被永久吃掉。
    let n = 0;
    let cur = advanceMonthKey(c.date, 0);
    while (cur < today && n < 1200) { n += 1; cur = advanceMonthKey(c.date, n); }
    return cur;
  }
  // custom_days
  const step = Math.max(1, Math.floor(c.interval_days ?? 1));
  let cur = c.date;
  let guard = 0;
  while (cur < today && guard < 100_000) { cur = addDaysKey(cur, step); guard += 1; }
  return cur;
}

/** 上一次（或本次）发生日：<= today；once 或尚未发生时返回 `date`。 */
export function prevDateKey(
  c: Pick<Countdown, 'kind' | 'repeat' | 'date' | 'interval_days'>,
  today: string,
): string {
  const rep = effectiveRepeat(c);
  if (rep === 'once') return c.date;
  if (rep === 'yearly') {
    const ty = parseDateKey(today).getFullYear();
    const thisY = yearlyOccurrenceOn(c.date, ty);
    return thisY > today ? yearlyOccurrenceOn(c.date, ty - 1) : thisY;
  }
  if (rep === 'monthly') {
    // 同样以原锚点步进（月末截断可逆），并保证不越过 today
    let cur = advanceMonthKey(c.date, 0);
    if (cur > today) return cur;
    let n = 0;
    while (advanceMonthKey(c.date, n + 1) <= today && n < 1200) n += 1;
    return advanceMonthKey(c.date, n);
  }
  const step = Math.max(1, Math.floor(c.interval_days ?? 1));
  let cur = c.date;
  let guard = 0;
  while (addDaysKey(cur, step) <= today && guard < 100_000) { cur = addDaysKey(cur, step); guard += 1; }
  return cur;
}

/** 距下一次发生日的自然日差：0=今天；>0 未来；<0 已过。**排序与分区只用它**。 */
export function daysToNext(
  c: Pick<Countdown, 'kind' | 'repeat' | 'date' | 'interval_days'>,
  today: string,
): number {
  return daysBetween(today, nextDateKey(c, today));
}

/** 已过天数（kind=days_elapsed）：以最近一次发生日为基准，>=0；未来日期为 0。 */
export function daysElapsed(
  c: Pick<Countdown, 'kind' | 'repeat' | 'date' | 'interval_days'>,
  today: string,
): number {
  if (nextDateKey(c, today) > today) return 0; // 尚未开始
  const d = daysBetween(prevDateKey(c, today), today);
  return d > 0 ? d : 0;
}

/**
 * 展示用天数差（按 kind 分口径）：
 *  - days_elapsed → 已过天数（>=0）
 *  - 其余（倒数日 / 每年重复）→ 距下一次（可为负，表示已过）
 */
export function daysUntil(c: Pick<Countdown, 'kind' | 'repeat' | 'date' | 'interval_days'>, today: string): number {
  if (c.kind === 'days_elapsed') return daysElapsed(c, today);
  return daysToNext(c, today);
}

/** 每年重复：已过周年数（date 年份起计；今年该日未到则 −1）。未来首次也返回 0。 */
export function yearlyYears(date: string, today: string): number {
  const base = parseDateKey(date).getFullYear();
  const ty = parseDateKey(today).getFullYear();
  let y = ty - base;
  if (yearlyOccurrenceOn(date, ty) > today) y -= 1;
  return Math.max(0, y);
}

/**
 * 排序比较：置顶优先 → 未来区剩余天数升序（快到期在前）→ 已过分区天数降序 → created_at。
 * 返回可喂给 Array.sort。
 */
export function compareCountdown(a: Countdown, b: Countdown, today: string): number {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;
  // 分区与排序一律用「距下一次」（与 kind 解耦）：未来区在前、快到期在前
  const da = daysToNext(a, today);
  const db = daysToNext(b, today);
  const futureA = da >= 0;
  const futureB = db >= 0;
  if (futureA !== futureB) return futureA ? -1 : 1;
  if (futureA) return da - db;  // 未来：升序
  return db - da;               // 已过：降序（最近过去的在前）
}

/** 未来 / 已过 分区判定（含今天=未来区）：只看「距下一次」，与展示口径无关。 */
export function isFuture(countdown: Countdown, today: string): boolean {
  return daysToNext(countdown, today) >= 0;
}

// ── 提醒（纯函数版：触发目标日 + 去重判断；巡检见 lib/countdownRemind.ts）──

/**
 * 提醒触发日（date key）：occurrence − remind_days（自然日）。未开启提醒返回 null。
 * days_elapsed 视为「起计日」，不参与到时提醒（它是累计口径）——但保留开关以兼容将来；
 * 这里按设定仍可为它算触发日。remind_days<=0 即当天。
 */
export function remindTargetDate(c: Countdown, today: string): string | null {
  if (!c.remind_enabled) return null;
  // 下一次发生日（once → date；年度/月度/自定义 → 当期），再按提前天数回退
  const occ = nextDateKey(c, today);
  return addDaysKey(occ, -(c.remind_days > 0 ? c.remind_days : 0));
}

/**
 * 是否应提醒：开启 && 今天 >= 触发日 && 本周期未提醒过。
 * 去重键 = 触发日（date key）：同一天只提醒一次；改期/改提前天数后 remindTarget 变化自动重武装。
 */
export function shouldRemindFor(c: Countdown, today: string, notifiedAt: number | null): boolean {
  if (!c.remind_enabled) return false;
  const target = remindTargetDate(c, today);
  if (!target) return false;
  // 已提醒时间戳的日期键
  const notifiedKey = notifiedAt == null ? null : toDateKey(new Date(notifiedAt));
  return today >= target && (notifiedKey === null || notifiedKey < target);
}