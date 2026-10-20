// 时间网格视图组（周视图 / 日视图 / 多日视图）：共享时间轴 + 日期列。
// 左侧固定时间轴 00:00–23:00；事件 CSS 绝对定位，高度∝时长，重叠平分列宽错开；
// 今天的列贯穿红色「当前时间线」；日视图单列、周视图 7 列、多日 3-4 列。

import type { CalEvent, PlacedEvent } from '@/lib/calendar';
import { HOUR_PX, eventsOfDay, hourTicks, layoutTimeColumn, nowLineTop, weekdayName } from '@/lib/calendar';
import { toDateKey } from '@/lib/date';

interface Props {
  dates: Date[];
  events: CalEvent[];
  now: Date;
  todayKey: string;
  onEventClick(e: CalEvent, x: number, y: number): void;
}

export function TimelineGrid({ dates, events, now, todayKey, onEventClick }: Props) {
  return (
    <div className="cal-timeline">
      {/* 固定时间轴 */}
      <TimeAxis />
      <div className="cal-cols">
        {dates.map((d) => {
          const k = toDateKey(d);
          const isToday = k === todayKey;
          const dayEvents = eventsOfDay(events, d);
          const allDay = dayEvents.filter((e) => e.allDay);
          const timed = dayEvents.filter((e) => !e.allDay);
          const placed = layoutTimeColumn(timed);
          return (
            <div key={k} className={`cal-col${isToday ? ' today' : ''}`}>
              <div className="cal-col-head">
                <span className="weekday">{weekdayName(d)}</span>
                <span className="daynum">{d.getDate()}</span>
              </div>
              <AllDayStrip events={allDay} onEventClick={onEventClick} />
              <div className="cal-col-body">
                {placed.map((p) => (
                  <EventBlock key={p.e.taskId} p={p} onEventClick={onEventClick} />
                ))}
                {isToday && (
                  <div className="cal-nowline" style={{ top: nowLineTop(now) }} aria-hidden />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimeAxis() {
  return (
    <div className="cal-time-axis">
      {hourTicks().map((h) => (
        <div
          key={h}
          className="cal-axis-tick"
          style={{ top: (h / 24) * 24 * HOUR_PX }}
        >
          {String(h).padStart(2, '0')}:00
        </div>
      ))}
    </div>
  );
}

function AllDayStrip({ events, onEventClick }: {
  events: CalEvent[]; onEventClick(e: CalEvent, x: number, y: number): void;
}) {
  if (events.length === 0) return <div className="cal-all-day-strip" />;
  return (
    <div className="cal-all-day-strip">
      {events.map((e) => (
        <span
          key={e.taskId}
          className="cal-all-day-chip"
          style={{ background: e.color }}
          onClick={(ev) => onEventClick(e, ev.clientX, ev.clientY)}
        >
          {e.title}
        </span>
      ))}
    </div>
  );
}

function EventBlock({ p, onEventClick }: {
  p: PlacedEvent; onEventClick(e: CalEvent, x: number, y: number): void;
}) {
  const top = (p.topMin / 60) * HOUR_PX;
  const h = (p.heightMin / 60) * HOUR_PX;
  return (
    <div
      className="cal-event"
      style={{ background: p.e.color, top, height: `${Math.max(h, 18)}px`, left: `${p.leftPct}%`, width: `${p.widthPct}%` }}
      onClick={(e) => onEventClick(p.e, e.clientX, e.clientY)}
    >
      <span className="ev-title">{p.e.title}</span>
      {h >= 34 && p.e.start && <span className="ev-time">{fmtRange(p.e.start!, p.e.end!)}</span>}
    </div>
  );
}

function fmtRange(a: Date, b: Date): string {
  return `${pad(a.getHours())}:${pad(a.getMinutes())} – ${pad(b.getHours())}:${pad(b.getMinutes())}`;
}
const pad = (n: number) => String(n).padStart(2, '0');