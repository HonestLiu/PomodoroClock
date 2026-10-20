// 月视图：7 列网格（周一起始）。非本月数字置灰；选中日期蓝色实心圆、文字变白；
// 有事件在格内按顺序渲染小型圆角色块（标题+时间），超出显示「+N 更多」。

import type { CalEvent } from '@/lib/calendar';
import { monthGrid, toDateKey } from '@/lib/date';
import { eventsOfDay, weekdayName } from '@/lib/calendar';
import { useI18n } from '@/i18n';

const MAX_CHIPS = 3;

interface Props {
  anchor: Date;
  events: CalEvent[];
  todayKey: string;
  onSelectDay(date: Date): void;          // 点击日期（含选中态）
  onEventClick(e: CalEvent, x: number, y: number): void;
  onShowMore(key: string, x: number, y: number): void;
  onEventContextMenu(e: CalEvent, x: number, y: number): void;
  onDayContextMenu?(d: Date, x: number, y: number): void;
}

export function MonthView({
  anchor, events, todayKey, onSelectDay, onEventClick, onShowMore,
  onEventContextMenu, onDayContextMenu,
}: Props) {
  const { t } = useI18n();
  const cells = monthGrid(anchor.getFullYear(), anchor.getMonth());
  const selectedKey = toDateKey(anchor);
  // 表头：网格首日所在周（周一起始）的 7 天
  const dow = cells.slice(0, 7).map((c) => c.date);

  return (
    <div className="cal-month-wrap">
      <div className="cal-month-grid">
        {dow.map((d, i) => (
          <div key={i} className="cal-month-dow">{weekdayName(d, true)}</div>
        ))}
        {cells.map((c) => {
          const k = c.key;
          const dayEvents = eventsOfDay(events, c.date);
          const shown = dayEvents.slice(0, MAX_CHIPS);
          const more = dayEvents.length - shown.length;
          const cls = ['cal-day-cell']
            .concat(c.inMonth ? [] : ['other-month'])
            .concat(k === todayKey ? ['today'] : [])
            .concat(k === selectedKey ? ['selected'] : [])
            .join(' ');
          return (
            <div
              key={k}
              className={cls}
              onClick={() => onSelectDay(c.date)}
              onContextMenu={(ev) => {
                if (!onDayContextMenu) return;
                ev.preventDefault();
                ev.stopPropagation();
                onDayContextMenu(c.date, ev.clientX, ev.clientY);
              }}
            >
              <span className="cal-day-num">{c.date.getDate()}</span>
              <div className="cal-day-events">
                {shown.map((ev) => (
                  <div
                    key={ev.taskId}
                    className="cal-ev-chip"
                    style={{ background: ev.color }}
                    onClick={(e) => { e.stopPropagation(); onEventClick(ev, e.clientX, e.clientY); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEventContextMenu(ev, e.clientX, e.clientY);
                    }}
                  >
                    {fmtTitleTime(ev)}
                  </div>
                ))}
                {more > 0 && (
                  <div
                    className="cal-ev-more"
                    onClick={(e) => { e.stopPropagation(); onShowMore(k, e.clientX, e.clientY); }}
                  >
                    {t('calendar.more', { n: more })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtTitleTime(ev: CalEvent): string {
  if (ev.allDay) return ev.title;
  const t = ev.start ? formatHHMM(ev.start) : '';
  return `${t} ${ev.title}`;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
