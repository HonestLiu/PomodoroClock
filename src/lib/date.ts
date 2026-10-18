// 日期与分组逻辑 —— PRD §7.3
//
// 本地化说明：本模块不 import i18n（避免 i18n → date → i18n 循环依赖）。
// 当前语言由 src/i18n/store.ts 通过 setDateLocale() 单向下发，因此调用方无需传参，
// 英文界面下「今天 / 昨天 / 10月13日 / 8小时59分钟」会自动切换为 Today / Yesterday / 10/13 / 8h 59m。

export type DateLocale = 'zh' | 'en';

let dateLocale: DateLocale = 'zh';

/** 由 i18n 层在初始化与切换语言时调用 */
export function setDateLocale(locale: DateLocale): void {
  dateLocale = locale === 'en' ? 'en' : 'zh';
}

export function getDateLocale(): DateLocale {
  return dateLocale;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 本地时区 'YYYY-MM-DD' */
export function toDateKey(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function startOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date | number): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date | number, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 本周一 00:00（PRD §7.3：本周 = 周一 00:00 至周日 24:00） */
export function startOfWeek(d: Date | number): Date {
  const x = startOfDay(d);
  const dow = x.getDay(); // 0=周日
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(x, diff);
}

export function endOfWeek(d: Date | number): Date {
  return endOfDay(addDays(startOfWeek(d), 6));
}

export function startOfMonth(d: Date | number): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function endOfMonth(d: Date | number): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  return endOfDay(x);
}

export function startOfYear(d: Date | number): Date {
  const x = startOfDay(d);
  x.setMonth(0, 1);
  return x;
}

export function endOfYear(d: Date | number): Date {
  const x = startOfYear(d);
  x.setFullYear(x.getFullYear() + 1);
  x.setDate(0);
  return endOfDay(x);
}

export const todayKey = () => toDateKey(new Date());
export const tomorrowKey = () => toDateKey(addDays(new Date(), 1));

/** 日期区间 -> [from, to] 时间戳，用于所选周期（PRD §7.2） */
export function periodRange(period: 'day' | 'week' | 'month' | 'year', anchor: Date): [number, number] {
  switch (period) {
    case 'day':
      return [startOfDay(anchor).getTime(), endOfDay(anchor).getTime()];
    case 'week':
      return [startOfWeek(anchor).getTime(), endOfWeek(anchor).getTime()];
    case 'month':
      return [startOfMonth(anchor).getTime(), endOfMonth(anchor).getTime()];
    case 'year':
      return [startOfYear(anchor).getTime(), endOfYear(anchor).getTime()];
  }
}

/** 该周期的天数（用于日历/报表导航步进） */
export function shiftPeriod(period: 'day' | 'week' | 'month' | 'year', anchor: Date, dir: number): Date {
  const x = new Date(anchor);
  switch (period) {
    case 'day':
      return addDays(x, dir);
    case 'week':
      return addDays(x, 7 * dir);
    case 'month':
      x.setMonth(x.getMonth() + dir);
      return x;
    case 'year':
      x.setFullYear(x.getFullYear() + dir);
      return x;
  }
}

/** 「8小时59分钟」/「20分钟」/「0分钟」；英文「8h 59m」/「20m」/「0m」 */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (dateLocale === 'en') {
    if (h > 0) return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
    return `${m}m`;
  }
  if (h > 0) return rest === 0 ? `${h}小时` : `${h}小时${rest}分钟`;
  return `${rest}分钟`;
}

/** 侧边栏短格式：「0m」「1h20m」 */
export function formatMinutesShort(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h${rest}m`;
}

/** 倒计时 MM:SS（可超过 60 分钟则 HH:MM:SS） */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** '09:24' */
export function formatHM(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 分组标题：今天 / 昨天 / 10月13日（PRD §5.3 FR-C1）；英文 Today / Yesterday / 10/13 */
export function relativeDayLabel(key: string): string {
  const en = dateLocale === 'en';
  const today = todayKey();
  if (key === today) return en ? 'Today' : '今天';
  if (key === toDateKey(addDays(new Date(), -1))) return en ? 'Yesterday' : '昨天';
  const d = parseDateKey(key);
  const now = new Date();
  const md = `${d.getMonth() + 1}${en ? '/' : '月'}${d.getDate()}${en ? '' : '日'}`;
  if (d.getFullYear() === now.getFullYear()) return md;
  return en ? `${md}/${d.getFullYear()}` : `${d.getFullYear()}年${md}`;
}

/** 「10月13日」—— 任务行到期日；英文 10/13 */
export function formatDueDate(key: string | null): string {
  if (!key) return '';
  const d = parseDateKey(key);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return dateLocale === 'en'
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return dateLocale === 'en'
    ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 报表周期标题 —— 今天 / 10月13日 / 本周 / 10月1日–10月31日 / 2026年10月 / 2026
 * 英文：Today / 10/13 / This week / 10/1 – 10/31 / Oct 2026 / 2026
 */
export function formatPeriodTitle(
  period: 'day' | 'week' | 'month' | 'year',
  anchor: Date,
): string {
  const en = dateLocale === 'en';
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + 1;
  const d = anchor.getDate();
  if (period === 'day') {
    if (toDateKey(anchor) === todayKey()) return en ? 'Today' : '今天';
    return en ? `${m}/${d}` : `${m}月${d}日`;
  }
  if (period === 'week') {
    if (toDateKey(startOfWeek(anchor)) === toDateKey(startOfWeek(new Date()))) {
      return en ? 'This week' : '本周';
    }
    const s = startOfWeek(anchor);
    const e = endOfWeek(anchor);
    const sm = s.getMonth() + 1;
    const em = e.getMonth() + 1;
    return en
      ? `${sm}/${s.getDate()} – ${em}/${e.getDate()}`
      : `${sm}月${s.getDate()}日–${em}月${e.getDate()}日`;
  }
  if (period === 'month') {
    if (en) {
      const mon = anchor.toLocaleDateString('en-US', { month: 'short' });
      return `${mon} ${y}`;
    }
    return `${y}年${m}月`;
  }
  return String(y);
}

/** 图表坐标轴短日期：10/13（中英一致），供趋势图 X 轴使用 */
export function formatShortDate(key: string): string {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 月历网格（周一起始，上下月补位）—— PRD §7.3 / FR-R6 */export interface CalendarCell {
  date: Date;
  key: string;
  inMonth: boolean;
}

export function monthGrid(year: number, month0: number): CalendarCell[] {
  const first = new Date(year, month0, 1);
  const gridStart = startOfWeek(first);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    cells.push({
      date: d,
      key: toDateKey(d),
      inMonth: d.getMonth() === month0,
    });
  }
  // 若最后一行整行属于下月，则裁掉（保持紧凑）
  while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.length -= 7;
  return cells;
}

/** 报表番茄记录图的日期轴：今天起倒序 days 天 */
export function recentDateKeys(days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(toDateKey(addDays(new Date(), -i)));
  return out;
}
