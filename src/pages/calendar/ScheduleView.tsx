// 日程视图：垂直时间线列表。左侧日期 + 时间 + 空心圆点节点，期间以竖线相连；
// 右侧宽圆角事件卡片（标题 + 时间跨度）。

import type { CalEvent } from '@/lib/calendar';
import { eventsOfDay, weekdayName } from '@/lib/calendar';
import { useI18n } from '@/i18n';

interface Props {
  anchor: Date;
  events: CalEvent[];
  onEventClick(e: CalEvent, x: number, y: number): void;
}

export function ScheduleView({ anchor, events, onEventClick }: Props) {
  const { t } = useI18n();
  const dayEvents = eventsOfDay(events, anchor).slice().sort(byTime);
  const dateLabel = `${anchor.getDate()} ${weekdayName(anchor)}`;
  return (
    <div className="cal-schedule-wrap">
      {dayEvents.length === 0 ? (
        <div className="cal-empty" style={{ marginTop: 80 }}>{t('calendar.empty')}</div>
      ) : (
        <div className="cal-schedule">
          {dayEvents.map((e, i) => (
            <div key={e.taskId} className="cal-sched-item">
              <span className="cal-sched-node" aria-hidden />
              <div className="cal-sched-date">
                {i === 0 ? <><div className="big">{dateLabel}</div><div>{timeText(e, t('calendar.allDay'))}</div></> : <div>&nbsp;</div>}
              </div>
              <div
                className="cal-sched-card"
                style={{ background: e.color }}
                onClick={(ev) => onEventClick(e, ev.clientX, ev.clientY)}
              >
                <div className="title">{e.title}</div>
                <div className="time">{timeText(e, t('calendar.allDay'))}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function byTime(a: CalEvent, b: CalEvent): number {
  if (a.allDay && b.allDay) return a.title.localeCompare(b.title);
  if (a.allDay) return -1;
  if (b.allDay) return 1;
  return (a.start!.getTime()) - (b.start!.getTime());
}

function timeText(e: CalEvent, allDayLabel: string): string {
  if (e.allDay) return allDayLabel;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(e.start!.getHours())}:${pad(e.start!.getMinutes())} – ${pad(e.end!.getHours())}:${pad(e.end!.getMinutes())}`;
}