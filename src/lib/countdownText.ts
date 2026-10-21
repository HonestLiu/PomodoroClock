// 倒数纪念日 —— 展示文案（与 i18n 解耦，传入 t 函数）
import type { Countdown } from '@/types';
import { daysUntil, isFuture, nextDateKey, yearlyYears } from './countdown';
import { formatShortDate } from './date';

type TF = (key: string, params?: Record<string, number>) => string;

/** 卡片/列表的主数字文案 */
export function countdownBigText(c: Countdown, today: string, t: TF): string {
  const d = daysUntil(c, today); // kind=days_elapsed → 已过天数(>=0)；其余 → 距下一次(可负)
  if (c.kind === 'days_elapsed') return d === 0 ? t('cd.today') : t('cd.daysElapsed', { n: d });
  if (d === 0) return t('cd.today');
  if (d === 1) return t('cd.tomorrow');
  if (d === -1) return t('cd.yesterday');
  if (d > 1) return t('cd.daysLeft', { n: d });
  return t('cd.daysElapsed', { n: -d }); // 一次性已过
}

/** 副行：日期 + （每年重复）周年数 */
export function countdownSubText(c: Countdown, today: string, t: TF): string {
  const date = formatShortDate(nextDateKey(c, today));
  if (c.kind === 'yearly' || c.repeat === 'yearly') {
    const y = yearlyYears(c.date, today);
    return y >= 1 ? `${date} · ${t('cd.yearN', { n: y })}` : date;
  }
  return date;
}

/** 卡片/列表是否归入「未来」分区（含今天） */
export function isCountdownFuture(c: Countdown, today: string): boolean {
  return isFuture(c, today);
}

export type { Countdown };