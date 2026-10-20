// 多周视图：横向 2 周的 7 列网格（14 天）。顶部一周星期几，事件以短条小色块
// 平铺在对应日期顶部区域，不按时段绘制高度，仅展示标题 + 时间。

import type { CalEvent } from '@/lib/calendar';
import { eventsOfDay, multiWeekDates, weekdayName } from '@/lib/calendar';
import { toDateKey } from '@/lib/date';

interface Props {
  anchor: Date;
  events: CalEvent[];
  todayKey: string;
  onEventClick(e: CalEvent, x: number, y: number): void;
}

export function MultiWeekView({ anchor, events, todayKey, onEventClick }: Props) {
  const days = multiWeekDates(anchor); // 连续 2×7=14 天，周一起始
  return (
    <div className="cal-multweek-wrap">
      <div className="cal-multweek">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="cal-mw-dow">
            {weekdayName(d, true)}
          </div>
        ))}
        {days.map((d) => {
          const k = toDateKey(d);
          const isToday = k === todayKey;
          const dayEvents = eventsOfDay(events, d);
          return (
            <div key={k} className={`cal-mw-col${isToday ? ' today' : ''}`}>
              <div className="cal-mw-daynum">{d.getDate()}</div>
              {dayEvents.map((e) => (
                <div
                  key={e.taskId}
                  className="cal-mw-event"
                  style={{ background: e.color }}
                  onClick={(ev) => onEventClick(e, ev.clientX, ev.clientY)}
                >
                  <span className="t">{timeShort(e)}</span>
                  {e.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function timeShort(e: CalEvent): string {
  if (e.allDay) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(e.start!.getHours())}:${pad(e.start!.getMinutes())} `;
}