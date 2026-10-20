// 年视图：3 行 × 4 列展示 12 个月，每格为「月份名 + 微型日期网格」。
// 有事件的日子以浅紫/浅蓝填充；点月份 → 月视图，点日期 → 周视图。

import type { CalEvent } from '@/lib/calendar';
import { eventsOfDay, monthName, weekDates, weekdayName } from '@/lib/calendar';
import { monthGrid, parseDateKey } from '@/lib/date';

interface Props {
  year: number;
  events: CalEvent[];
  todayKey: string;
  onGoMonth(m0: number): void;   // 进入月视图
  onGoWeek(date: Date): void;    // 进入周视图（含该日期）
}

export function YearView({ year, events, todayKey, onGoMonth, onGoWeek }: Props) {
  return (
    <div className="cal-year-grid">
      {Array.from({ length: 12 }, (_, m0) => (
        <div key={m0} className="cal-year-month" onClick={() => onGoMonth(m0)} title={monthName(m0)}>
          <div className="cal-year-month-title">{monthName(m0)}</div>
          <MiniMonth year={year} m0={m0} events={events} todayKey={todayKey} onGoWeek={onGoWeek} />
        </div>
      ))}
    </div>
  );
}

function MiniMonth({ year, m0, events, todayKey, onGoWeek }: {
  year: number; m0: number; events: CalEvent[]; todayKey: string; onGoWeek(d: Date): void;
}) {
  // 保留上下月补位，网格才能按周一 7 列对齐；补位格不响应点击
  const cells = monthGrid(year, m0);
  return (
    <div className="cal-mini-grid">
      <MiniDow />
      {cells.map((c) => {
        if (!c.inMonth) return <div key={c.key} className="cal-mini-day" />;
        const k = c.key;
        const has = eventsOfDay(events, c.date).length > 0;
        return (
          <div
            key={k}
            className={`cal-mini-day${has ? ' has-event' : ''}${k === todayKey ? ' today' : ''}`}
            onClick={(e) => { e.stopPropagation(); onGoWeek(c.date); }}
          >
            {c.date.getDate()}
          </div>
        );
      })}
    </div>
  );
}

function MiniDow() {
  // 周一起始的 7 天，weekdayName 按当前语言给出（中「一..日」/ 英「Mon..Sun」）
  const days = weekDates(parseDateKey('2026-10-19')); // 2026-10-19 是周一，仅作模板
  return (
    <>
      {days.map((d) => (
        <div key={d.toISOString()} className="cal-mini-dow">{weekdayName(d, true)}</div>
      ))}
    </>
  );
}