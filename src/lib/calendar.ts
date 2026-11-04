// 日历组件核心模型与纯函数 —— 7 种视图（年/月/周/日/日程/多日/多周）
//
// 事件来源：复用任务数据。凡「有到期日（due_date）」的任务映射为一条日历事件，
// 有 `due_time` 的按时段块渲染，无时间的按「全天条」。颜色按所属清单稳定取色
// （低饱和马卡龙），不新造事件存储，纯派生。
//
// 设计约定：本模块为纯 TS，不 import React / i18n store；文字语言由
// `lib/date.ts` 的 getDateLocale() 单向下发（与全站一致）。

import type { Task } from '@/types';
import { addDays, getDateLocale, parseDateKey, startOfDay, startOfWeek, toDateKey } from './date';

export type CalendarViewMode =
  | 'year' | 'month' | 'week' | 'day' | 'schedule' | 'multiday' | 'multiweek';

/** 多日视图默认展示的天数（PRD 规格：3-4 天） */
export const MULTI_DAY_COUNT = 4;
/** 多周视图默认展示的周数（规格：2-3 周，取 2） */
export const MULTI_WEEK_COUNT = 2;

/** 事件：由任务派生，仅读渲染 */
export interface CalEvent {
  taskId: string;
  title: string;
  dateKey: string;         // 'YYYY-MM-DD'
  start: Date | null;      // 有 due_time 才有实时刻
  end: Date | null;
  allDay: boolean;         // 无 due_time → 全天条
  color: string;           // 主题事件颜色变量，含浅色 fallback
  urgent: boolean;
}

/** 时间网格视图内一个事件的位置（布局结果） */
export interface PlacedEvent {
  e: CalEvent;
  topMin: number;          // 距 00:00 的分钟数
  heightMin: number;       // 持续分钟
  leftPct: number;         // 相对列宽百分比
  widthPct: number;
}

// 低饱和 / 高明度马卡龙色系（PRD 规格：浅蓝、浅紫、浅绿、浅粉 …）
const PALETTE = ['#BBDEFB', '#D7C6F5', '#C8E6C9', '#F8C8D8', '#FCE4B8', '#B2E5E5', '#C5E1E0'];
// 浅色事件的默认文字；深色前景由 calendar.css 的主题变量控制
export const EVENT_TEXT = '#3A3A3A';

/** 按清单 id 稳定取色；交给 CSS 随主题切换，已渲染的事件无需重新派生。 */
export function listColor(listId: string | null | undefined): string {
  if (!listId) return `var(--cal-event-0, ${PALETTE[0]})`;
  let h = 0;
  for (let i = 0; i < listId.length; i++) h = (h * 31 + listId.charCodeAt(i)) >>> 0;
  const index = h % PALETTE.length;
  return `var(--cal-event-${index}, ${PALETTE[index]})`;
}

/** 任务 → 事件。有 due_time 的配 60 分钟名义时长，无时间的为全天条 */
export function tasksToEvents(tasks: Task[]): CalEvent[] {
  const events: CalEvent[] = [];
  for (const t of tasks) {
    if (!t.due_date) continue;
    let start: Date | null = null;
    let end: Date | null = null;
    if (t.due_time) {
      const [hh, mm] = t.due_time.split(':').map(Number);
      start = parseDateKey(t.due_date);
      start.setHours(hh || 0, mm || 0, 0, 0);
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    events.push({
      taskId: t.id,
      title: t.title,
      dateKey: t.due_date,
      start,
      end,
      allDay: !t.due_time,
      color: listColor(t.list_id),
      urgent: t.urgent === 1,
    });
  }
  return events;
}

// ── 周 / 多日 / 多周 区间 ──────────────────────────────────────
/** 周一起始的整周日期序列 */
export function weekDates(anchor: Date): Date[] {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}
/** 多日视图：从 anchor 起 N 天 */
export function multiDayDates(anchor: Date, n = MULTI_DAY_COUNT): Date[] {
  const s = startOfDay(anchor);
  return Array.from({ length: n }, (_, i) => addDays(s, i));
}
/** 多周视图：从 anchor 所在周的周一起，连续 N 周 */
export function multiWeekDates(anchor: Date, weeks = MULTI_WEEK_COUNT): Date[] {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 * weeks }, (_, i) => addDays(s, i));
}

// ── 语言化名称 ────────────────────────────────────────────────
function lang(): 'zh' | 'en' {
  return getDateLocale();
}
export function monthName(m0: number, short = false): string {
  const zh = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const zhS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const en = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const enS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (lang() === 'zh') return short ? zhS[m0] : zh[m0];
  return short ? enS[m0] : en[m0];
}
export function weekdayName(d: Date, short = false): string {
  const zh = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']; // getDay: 0=周日 → 归位
  const list = lang() === 'zh' ? zh : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const idx = (d.getDay() + 6) % 7; // 周一为首
  if (short && lang() === 'zh') return ['一', '二', '三', '四', '五', '六', '日'][idx];
  return lang() === 'zh' ? zh[idx] : list[d.getDay()];
}

// ── 顶部区间标题 ──────────────────────────────────────────────
export function rangeLabel(view: CalendarViewMode, anchor: Date): string {
  const y = anchor.getFullYear();
  const m0 = anchor.getMonth();
  const d = anchor.getDate();
  switch (view) {
    case 'year':
      return lang() === 'zh' ? `${y}年` : String(y);
    case 'month':
      return lang() === 'zh' ? `${y}年${monthName(m0, true)}` : `${monthName(m0)} ${y}`;
    case 'week': {
      const s = weekDates(anchor)[0];
      const e = addDays(s, 6);
      return lang() === 'zh'
        ? `${monthName(s.getMonth(), true)}${s.getDate()}日 - ${monthName(e.getMonth(), true)}${e.getDate()}日`
        : `${s.getMonth() + 1}/${s.getDate()} - ${e.getMonth() + 1}/${e.getDate()}`;
    }
    case 'day':
      return lang() === 'zh'
        ? `${y}年${monthName(m0, true)}${d}日 ${weekdayName(anchor)}`
        : `${monthName(m0)} ${d}, ${y}`;
    case 'schedule':
      return lang() === 'zh'
        ? `${monthName(m0, true)}${d}日日程`
        : `Schedule · ${monthName(m0, false)} ${d}`;
    case 'multiday': {
      const range = multiDayDates(anchor);
      const f = range[0];
      const l = range[range.length - 1];
      return lang() === 'zh'
        ? `${monthName(f.getMonth(), true)}${f.getDate()}日 - ${monthName(l.getMonth(), true)}${l.getDate()}日`
        : `${f.getMonth() + 1}/${f.getDate()} - ${l.getMonth() + 1}/${l.getDate()}`;
    }
    case 'multiweek': {
      const range = multiWeekDates(anchor);
      const f = range[0];
      const l = range[range.length - 1];
      return lang() === 'zh'
        ? `${monthName(f.getMonth(), true)}${f.getDate()}日 - ${monthName(l.getMonth(), true)}${l.getDate()}日`
        : `${f.getMonth() + 1}/${f.getDate()} - ${l.getMonth() + 1}/${l.getDate()}`;
    }
  }
}

/** 当前视图向前/向后一档（年/月/周/日/日程走邻近单位，多日/多周按各自跨度） */
export function shift(view: CalendarViewMode, anchor: Date, dir: 1 | -1): Date {
  const byDays = dir * 7;
  switch (view) {
    case 'year': return new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1);
    case 'month': return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    case 'week': return addDays(anchor, byDays);
    case 'day':
    case 'schedule':
      return addDays(anchor, dir);
    case 'multiday': return addDays(anchor, dir * MULTI_DAY_COUNT);
    case 'multiweek': return addDays(anchor, dir * 7 * MULTI_WEEK_COUNT);
  }
}

// ── 时间网格：位置计算与重叠布局 ──────────────────────────────
/** 每小时像素高度 */
export const HOUR_PX = 44;

export function minutesInDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 列内时间事件布局（重叠平分列宽、水平错开，PRD 规格）。
 * 输入：某列内**有时刻**的事件（含其 Date）；返回带 top/height/left/width 的结果。
 * 事件高度 = 持续时间 / 60 * HOUR_PX（由调用方换算像素）。
 */
export function layoutTimeColumn(events: CalEvent[]): PlacedEvent[] {
  const timed = events
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => ({
      e,
      start: minutesInDay(e.start!),
      end: minutesInDay(e.end!),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // 传递重叠分组（链式重叠归同一簇），簇结束看簇内最大结束时间（不能只看
  // 最后一个事件：后开始的事件可能更早结束）。
  const groups: Array<{ items: typeof timed; maxEnd: number }> = [];
  for (const t of timed) {
    let g = groups.find((grp) => grp.maxEnd > t.start);
    if (!g) {
      g = { items: [], maxEnd: 0 };
      groups.push(g);
    }
    g.items.push(t);
    if (t.end > g.maxEnd) g.maxEnd = t.end;
  }

  const placed: PlacedEvent[] = [];
  for (const g of groups) {
    const columns: number[] = []; // 每列当前占用的结束分钟
    const assigned: Array<{ t: typeof g.items[number]; col: number }> = [];
    for (const t of g.items) {
      let c = 0;
      while (c < columns.length && columns[c] > t.start) c++;
      if (c >= columns.length) columns.push(t.end);
      else columns[c] = Math.max(columns[c], t.end);
      assigned.push({ t, col: c });
    }
    // 实际并发列数（可能小于簇内事件数），按它平分列宽
    const n = columns.length;
    for (const { t, col } of assigned) {
      placed.push({
        e: t.e,
        topMin: t.start,
        heightMin: Math.max(t.end - t.start, 15), // 过短至少 15min 保证可点
        leftPct: (col * 100) / n,
        widthPct: 100 / n,
      });
    }
  }
  return placed;
}

/** 当前时刻在今天列内的像素顶部位置（用于红色「当前时间线」） */
export function nowLineTop(now: Date): number {
  return (minutesInDay(now) / 60) * HOUR_PX;
}

/** 时间轴小时刻度（00:00 … 23:00） */
export function hourTicks(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

// ── 聚合辅助 ──────────────────────────────────────────────────
/** 某天的所有事件 */
export function eventsOfDay(events: CalEvent[], date: Date): CalEvent[] {
  const k = toDateKey(date);
  return events.filter((e) => e.dateKey === k);
}