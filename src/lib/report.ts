// 报表统一周期模型。只接收当前运行时 store 数据，不直接访问数据库。
import type { FocusRecord, GridCell, Period } from '@/types';
import type { Dataset } from '@/lib/derive';
import { addDays, parseDateKey, periodRange, startOfDay, toDateKey } from '@/lib/date';

export interface ReportBucket { key: string; minutes: number; sessions: number }
export interface ReportSummary {
  from: number;
  to: number;
  days: string[];
  elapsedDays: number;
  records: FocusRecord[];
  totalMin: number;
  sessions: number;
  completedTasks: number;
  activeDays: number;
  goalDays: number;
  goalRate: number;
  dailyAverage: number;
  averageSession: number;
  longestSession: number;
  longestStreak: number;
  bestDay: { key: string; minutes: number } | null;
  byDay: Map<string, number>;
  series: ReportBucket[];
  hours: ReportBucket[];
  weekdays: ReportBucket[];
  grid: GridCell[];
  taskDurations: Array<{ task_id: string | null; title: string | null; minutes: number }>;
  distribution: Array<{ list_id: string | null; name: string | null; minutes: number; percent: number }>;
}

/** 从周期起点导航，避免 Jan 31 → Mar 3 / 闰日跨年跳月。 */
export function moveReportPeriod(period: Period, anchor: Date, direction: number): Date {
  const [from] = periodRange(period, anchor);
  const next = new Date(from);
  if (period === 'day') return addDays(next, direction);
  if (period === 'week') return addDays(next, direction * 7);
  if (period === 'month') next.setMonth(next.getMonth() + direction);
  else next.setFullYear(next.getFullYear() + direction);
  return next;
}

/** 与既有每日报表一致：归档完整记录按 start_at 的本地日期、小时归属。 */
export function buildReport(ds: Dataset, period: Period, anchor: Date, goalMin: number, now = new Date()): ReportSummary {
  const [from, to] = periodRange(period, anchor);
  const days: string[] = [];
  for (let day = new Date(from); day.getTime() <= to; day = addDays(day, 1)) days.push(toDateKey(day));
  const records = ds.records.filter(r => r.phase === 'focus' && r.start_at >= from && r.start_at <= to
    && r.start_at <= now.getTime() && Number.isFinite(r.duration_min) && r.duration_min > 0);
  const hours = Array.from({ length: 24 }, (_, h) => ({ key: String(h), minutes: 0, sessions: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, d) => ({ key: String(d), minutes: 0, sessions: 0 }));
  const byDay = new Map<string, number>();
  const byMonth = Array.from({ length: 12 }, (_, m) => ({ key: String(m + 1), minutes: 0, sessions: 0 }));
  const dailySessions = new Map<string, number>();
  const grid = new Map<string, GridCell>();
  const taskMinutes = new Map<string | null, number>();
  const listMinutes = new Map<string | null, number>();
  let totalMin = 0;
  let longestSession = 0;
  for (const r of records) {
    const date = new Date(r.start_at);
    const key = toDateKey(date);
    const hour = date.getHours();
    totalMin += r.duration_min;
    longestSession = Math.max(longestSession, r.duration_min);
    byDay.set(key, (byDay.get(key) ?? 0) + r.duration_min);
    dailySessions.set(key, (dailySessions.get(key) ?? 0) + 1);
    for (const bucket of [hours[hour], weekdays[(date.getDay() + 6) % 7], byMonth[date.getMonth()]]) {
      bucket.minutes += r.duration_min; bucket.sessions++;
    }
    const cellKey = `${key}#${hour}`;
    const cell = grid.get(cellKey) ?? { date: key, hour, minutes: 0, count: 0 };
    cell.minutes += r.duration_min; cell.count++; grid.set(cellKey, cell);
    taskMinutes.set(r.task_id, (taskMinutes.get(r.task_id) ?? 0) + r.duration_min);
    listMinutes.set(r.list_id, (listMinutes.get(r.list_id) ?? 0) + r.duration_min);
  }
  const today = toDateKey(now);
  const elapsedDays = days.filter(key => key <= today).length;
  let longestStreak = 0;
  let streak = 0;
  let goalDays = 0;
  let bestDay: ReportSummary['bestDay'] = null;
  for (const key of days) {
    const minutes = byDay.get(key) ?? 0;
    streak = minutes > 0 ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
    if (goalMin > 0 && minutes >= goalMin) goalDays++;
    if (minutes > 0 && (!bestDay || minutes > bestDay.minutes)) bestDay = { key, minutes };
  }
  const taskNames = new Map(ds.tasks.map(task => [task.id, task.title]));
  const listNames = new Map(ds.lists.map(list => [list.id, list.name]));
  const taskDurations = [...taskMinutes].map(([task_id, minutes]) => ({ task_id, title: task_id ? taskNames.get(task_id) ?? null : null, minutes })).sort((a, b) => b.minutes - a.minutes);
  const distribution = [...listMinutes].map(([list_id, minutes]) => ({ list_id, name: list_id ? listNames.get(list_id) ?? null : null,
    minutes, percent: totalMin > 0 ? Math.round(minutes / totalMin * 100) : 0 })).sort((a, b) => b.minutes - a.minutes);
  return {
    from, to, days, elapsedDays, records, totalMin, sessions: records.length,
    completedTasks: ds.tasks.filter(task => task.completed === 1 && task.completed_at !== null
      && task.completed_at >= from && task.completed_at <= to && task.completed_at <= now.getTime()).length,
    activeDays: byDay.size, goalDays, goalRate: byDay.size ? Math.round(goalDays / byDay.size * 100) : 0,
    dailyAverage: elapsedDays ? Math.round(totalMin / elapsedDays) : 0,
    averageSession: records.length ? Math.round(totalMin / records.length) : 0,
    longestSession, longestStreak, bestDay, byDay,
    series: period === 'day' ? hours : period === 'year' ? byMonth : days.map(key => ({ key, minutes: byDay.get(key) ?? 0, sessions: dailySessions.get(key) ?? 0 })),
    hours, weekdays, grid: [...grid.values()], taskDurations, distribution,
  };
}

/** 所选周期的目标月历月份；避免直接解析 YYYY-MM-DD 为 UTC 日期。 */
export const reportDate = (key: string) => startOfDay(parseDateKey(key));
