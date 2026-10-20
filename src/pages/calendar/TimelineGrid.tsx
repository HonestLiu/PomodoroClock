// 时间网格视图组（周视图 / 日视图 / 多日视图）：共享时间轴 + 日期列。
// 左侧固定时间轴 00:00–23:00；事件 CSS 绝对定位，高度∝时长，重叠平分列宽错开；
// 今天的列贯穿红色「当前时间线」；日视图单列（大号日期横幅表头）、周视图 7 列、多日 3-4 列。
//
// 对齐说明：CSS 变量 --tl-head-h / --tl-strip-h / --tl-body-h 统一表头、全天条与正文高度，
// JS 侧不再硬编码。时间轴显式撑满「表头块 + 24h 正文」，刻度 top 由 CSS calc 偏移表头块，
// 故 00:00 落在正文首条网格线上且不被粘性表头遮挡；各列（含今日）高度与正文起点一致。

import type { CalEvent, PlacedEvent } from '@/lib/calendar';
import {
  HOUR_PX, eventsOfDay, hourTicks, layoutTimeColumn, monthName, nowLineTop, weekdayName,
} from '@/lib/calendar';
import { toDateKey } from '@/lib/date';

interface Props {
  dates: Date[];
  events: CalEvent[];
  now: Date;
  todayKey: string;
  onEventClick(e: CalEvent, x: number, y: number): void;
  onEventContextMenu(e: CalEvent, x: number, y: number): void;
  /** 空白日期区右键（用于「在此新建日程」） */
  onDayContextMenu?(d: Date, x: number, y: number): void;
}

export function TimelineGrid({
  dates, events, now, todayKey, onEventClick, onEventContextMenu, onDayContextMenu,
}: Props) {
  const dayMode = dates.length === 1;
  // 刻度 top 基于固定 HOUR_PX 网格；表头偏移由 CSS 占位块负责，这里不再重复计算
  const tickTop = (h: number) => h * HOUR_PX;
  return (
    <div className={`cal-timeline${dayMode ? ' day' : ''}`}>
      {/* 固定时间轴：顶部占位与列头+全天条等高（CSS 变量），刻度整体下移 */}
      <div className="cal-time-axis">
        {hourTicks().map((h) => (
          <div key={h} className="cal-axis-tick" style={{ top: `calc(var(--tl-head-block) + ${tickTop(h)}px)` }}>
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>
      <div className="cal-cols">
        {dates.map((d) => {
          const k = toDateKey(d);
          const isToday = k === todayKey;
          const dayEvents = eventsOfDay(events, d);
          const allDay = dayEvents.filter((e) => e.allDay);
          const timed = dayEvents.filter((e) => !e.allDay);
          const placed = layoutTimeColumn(timed);
          return (
            <div
              key={k}
              className={`cal-col${isToday ? ' today' : ''}`}
              onContextMenu={(ev) => {
                if (!onDayContextMenu) return;
                ev.preventDefault();
                ev.stopPropagation();
                onDayContextMenu(d, ev.clientX, ev.clientY);
              }}
            >
              <div className="cal-col-head">
                {dayMode ? (
                  <div className="cal-day-banner">
                    <span className="banner-num">{d.getDate()}</span>
                    <span className="banner-meta">
                      <span className="weekday">{weekdayName(d)}</span>
                      <span className="ym">{monthName(d.getMonth(), true)}</span>
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="weekday">{weekdayName(d)}</span>
                    <span className="daynum">{d.getDate()}</span>
                  </>
                )}
              </div>
              <AllDayStrip
                events={allDay}
                onEventClick={onEventClick}
                onEventContextMenu={onEventContextMenu}
              />
              <div className="cal-col-body">
                {placed.map((p) => (
                  <EventBlock
                    key={p.e.taskId}
                    p={p}
                    onEventClick={onEventClick}
                    onEventContextMenu={onEventContextMenu}
                  />
                ))}
                {isToday && (
                  // 正文与时间轴同高、共用 00:00 原点，故当前时间线直接用 nowLineTop
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

function AllDayStrip({ events, onEventClick, onEventContextMenu }: {
  events: CalEvent[];
  onEventClick(e: CalEvent, x: number, y: number): void;
  onEventContextMenu(e: CalEvent, x: number, y: number): void;
}) {
  if (events.length === 0) return <div className="cal-all-day-strip" />;
  return (
    <div className="cal-all-day-strip">
      {events.map((e) => (
        <span
          key={e.taskId}
          className="cal-all-day-chip"
          style={{ background: e.color }}
          onClick={(ev) => { ev.stopPropagation(); onEventClick(e, ev.clientX, ev.clientY); }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onEventContextMenu(e, ev.clientX, ev.clientY);
          }}
        >
          {e.title}
        </span>
      ))}
    </div>
  );
}

function EventBlock({ p, onEventClick, onEventContextMenu }: {
  p: PlacedEvent;
  onEventClick(e: CalEvent, x: number, y: number): void;
  onEventContextMenu(e: CalEvent, x: number, y: number): void;
}) {
  const top = (p.topMin / 60) * HOUR_PX;
  const h = (p.heightMin / 60) * HOUR_PX;
  return (
    <div
      className="cal-event"
      style={{
        background: p.e.color,
        top,
        height: `${Math.max(h, 18)}px`,
        left: `${p.leftPct}%`,
        width: `${p.widthPct}%`,
      }}
      onClick={(e) => { e.stopPropagation(); onEventClick(p.e, e.clientX, e.clientY); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEventContextMenu(p.e, e.clientX, e.clientY);
      }}
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
