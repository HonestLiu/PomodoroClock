// 日历页 —— 7 种视图（年/月/周/日/日程/多日/多周）
//
// 状态全部本地：anchor（视图锚点日期）、mode（视图模式）。事件复用任务数据
// （有 due_date 即映射为日历事件），不新建存储。视图切换、左右翻页、今天归零、
// + 添加、星光快捷操作、事件详情弹层均在此页。

import { useMemo, useRef, useState, useEffect, useCallback, forwardRef } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { CalEvent, CalendarViewMode } from '@/lib/calendar';
import {
  rangeLabel, shift, tasksToEvents, weekDates, multiDayDates,
} from '@/lib/calendar';
import { toDateKey } from '@/lib/date';
import { useDataStore } from '@/stores/dataStore';
import { useUiStore } from '@/stores/uiStore';
import { useI18n } from '@/i18n';
import { YearView } from './YearView';
import { MonthView } from './MonthView';
import { TimelineGrid } from './TimelineGrid';
import { ScheduleView } from './ScheduleView';
import { MultiWeekView } from './MultiWeekView';
import '@/styles/calendar.css';

const VIEW_MODES: CalendarViewMode[] = ['year', 'month', 'week', 'day', 'schedule', 'multiday', 'multiweek'];

interface Popover {
  e?: CalEvent;
  text?: string;
  x: number;
  y: number;
}

export function CalendarPage() {
  const { t } = useI18n();
  const tasks = useDataStore((s) => s.tasks);
  const createTask = useDataStore((s) => s.createTask);

  const [mode, setMode] = useState<CalendarViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [now, setNow] = useState<Date>(() => new Date());
  const [popover, setPopover] = useState<Popover | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 「今天」时间线每分钟推进
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // 点空白处关闭弹层
  useEffect(() => {
    if (!popover) return;
    const onDown = (ev: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) setPopover(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [popover]);

  const events = useMemo(() => tasksToEvents(tasks), [tasks]);
  const todayKey = toDateKey(new Date());

  const go = useCallback((dir: 1 | -1) => setAnchor((a) => shift(mode, a, dir)), [mode]);

  const onEventClick = useCallback((e: CalEvent, x: number, y: number) => {
    setPopover({ e, x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 150) });
  }, []);

  const onShowMore = useCallback((key: string, x: number, y: number) => {
    setPopover({ text: key, x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 150) });
  }, []);

  // 从年/月钻取
  const goMonthAt = (m0: number) => { setAnchor(new Date(anchor.getFullYear(), m0, 1)); setMode('month'); };
  const goWeekAt = (d: Date) => { setAnchor(d); setMode('week'); };
  const selectDay = (d: Date) => { setAnchor(d); setMode('day'); };

  // + 添加：在当前锚点日期创建任务并打开编辑弹层（复用既有 TaskEditModal，
  // 与任务页「添加任务 → 编辑」一致，不新造表单）。
  // 注意：create_task 拒绝空标题，故带默认标题创建，用户随即在弹层改名。
  const setEditingTask = useUiStore((s) => s.setEditingTask);
  const onAdd = async () => {
    const date = mode === 'year' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : anchor;
    try {
      const task = await createTask({ title: t('calendar.untitledEvent'), dueDate: toDateKey(date) });
      setEditingTask(task.id);
    } catch {
      // 创建失败（如库不可写）静默降级，不打断日历浏览
    }
  };

  const datesForTimeline = mode === 'week'
    ? weekDates(anchor)
    : mode === 'day'
      ? [anchor]
      : multiDayDates(anchor);

  return (
    <div className="cal-page">
      {/* 顶部导航栏 */}
      <div className="cal-topbar">
        <span className="cal-range">{rangeLabel(mode, anchor)}</span>
        <button className="cal-btn cal-btn-add" aria-label={t('calendar.add')} onClick={onAdd}>+</button>
        <label className="cal-dropdown">
          <select
            aria-label={t('calendar.viewSwitch')}
            value={mode}
            onChange={(e) => setMode(e.target.value as CalendarViewMode)}
          >
            {VIEW_MODES.map((m) => (
              <option key={m} value={m}>{t(`calendar.mode.${m}`)}</option>
            ))}
          </select>
        </label>
        <button className="cal-btn icon-only" aria-label={t('calendar.prev')} onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="cal-btn icon-only" aria-label={t('calendar.next')} onClick={() => go(1)}>
          <ChevronRight size={16} />
        </button>
        <button className="cal-btn cal-btn-today" onClick={() => setAnchor(new Date())}>
          {t('calendar.today')}
        </button>
      </div>

      {/* 视图主体 */}
      {mode === 'year' && (
        <YearView
          year={anchor.getFullYear()}
          events={events}
          todayKey={todayKey}
          onGoMonth={goMonthAt}
          onGoWeek={goWeekAt}
        />
      )}
      {mode === 'month' && (
        <MonthView
          anchor={anchor}
          events={events}
          todayKey={todayKey}
          onSelectDay={selectDay}
          onEventClick={onEventClick}
          onShowMore={onShowMore}
        />
      )}
      {(mode === 'week' || mode === 'day' || mode === 'multiday') && (
        <TimelineGrid
          dates={datesForTimeline}
          events={events}
          now={now}
          todayKey={todayKey}
          onEventClick={onEventClick}
        />
      )}
      {mode === 'schedule' && (
        <ScheduleView anchor={anchor} events={events} onEventClick={onEventClick} />
      )}
      {mode === 'multiweek' && (
        <MultiWeekView anchor={anchor} events={events} todayKey={todayKey} onEventClick={onEventClick} />
      )}

      {/* 底部悬浮胶囊工具栏 */}
      <div className="cal-toolbar-wrap">
        <div className="cal-toolbar" role="tablist" aria-label={t('calendar.viewSwitch')}>
          {VIEW_MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`cal-toolbar-btn${mode === m ? ' active' : ''}`}
              onClick={() => setMode(m)}
            >
              {t(`calendar.mode.${m}`)}
            </button>
          ))}
          <button className="cal-upgrade" onClick={() => onAdd()}>{t('calendar.upgrade')}</button>
        </div>
      </div>

      {/* 右下角星光快捷操作 */}
      <button
        className="cal-fab"
        aria-label={t('calendar.quick')}
        title={t('calendar.quick')}
        onClick={() => setMode('schedule')}
      >
        <Sparkles size={20} />
      </button>

      {/* 事件详情 / 更多 弹层 */}
      {popover && (
        <EventPopover
          ref={popRef}
          popover={popover}
          events={events}
          onClose={() => setPopover(null)}
        />
      )}
      <CalendarSpacer />
    </div>
  );
}

/** 底部胶囊工具栏高度占位，避免内容被胶囊压住 */
function CalendarSpacer() {
  return <div aria-hidden style={{ height: 72, flex: '0 0 auto' }} />;
}

const EventPopover = forwardRef<HTMLDivElement, {
  popover: Popover;
  events: CalEvent[];
  onClose(): void;
}>(({ popover, events, onClose }, ref) => {
  const { t } = useI18n();
  const list = useMemo(() => {
    if (popover.e) return [popover.e];
    if (popover.text) {
      // +N 更多：该日期全天事件
      const k = popover.text;
      return events.filter((e) => e.dateKey === k);
    }
    return [];
  }, [popover, events]);

  return (
    <div ref={ref} className="cal-popover" style={{ left: popover.x, top: popover.y }}>
      {list.map((e) => (
        <div key={e.taskId} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0ee' }}>
          <div className="title">{e.title || t('calendar.untitled')}</div>
          <div className="meta">{e.allDay ? t('calendar.allDay') : rangeTime(e)}</div>
        </div>
      ))}
      <button
        className="cal-btn"
        style={{ marginTop: 8, height: 26, fontSize: 12 }}
        onClick={onClose}
      >
        {t('calendar.close')}
      </button>
    </div>
  );
});
EventPopover.displayName = 'EventPopover';

function rangeTime(e: CalEvent): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!e.start || !e.end) return '';
  return `${pad(e.start.getHours())}:${pad(e.start.getMinutes())} – ${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`;
}