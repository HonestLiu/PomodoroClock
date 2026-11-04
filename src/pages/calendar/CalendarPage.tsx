import { Select } from '@/components/controls/Select';
// 日历页 —— 7 种视图（年/月/周/日/日程/多日/多周）
//
// 状态全部本地：anchor（视图锚点日期）、mode（视图模式）。事件复用任务数据
// （有 due_date 即映射为日历事件），不新造存储。视图切换、左右翻页、今天归零、
// + 添加、星光快捷操作、事件详情弹层、自定义右键菜单均在此页。
//
// 右键约定：日历区域接管原生右键菜单——事件上出「编辑/完成/删除」菜单，
// 空白处出「新建日程」菜单；其余位置仅静默屏蔽原生菜单。

import { useMemo, useRef, useState, useEffect, useCallback, forwardRef } from 'react';
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
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

/** 自定义右键菜单：带事件 = 事件操作；不带 = 空白处新建 */
interface CalCtx {
  x: number;
  y: number;
  e?: CalEvent;
  date?: Date;
}

export function CalendarPage() {
  const { t } = useI18n();
  const tasks = useDataStore((s) => s.tasks);
  const createTask = useDataStore((s) => s.createTask);
  const toggleTask = useDataStore((s) => s.toggleTask);
  const deleteTask = useDataStore((s) => s.deleteTask);
  const setEditingTask = useUiStore((s) => s.setEditingTask);
  const askConfirm = useUiStore((s) => s.askConfirm);

  const [mode, setMode] = useState<CalendarViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [now, setNow] = useState<Date>(() => new Date());
  const [popover, setPopover] = useState<Popover | null>(null);
  const [ctx, setCtx] = useState<CalCtx | null>(null);
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
    setCtx(null);
    setPopover({ e, x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 170) });
  }, []);

  const onShowMore = useCallback((key: string, x: number, y: number) => {
    setPopover({ text: key, x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 170) });
  }, []);

  const onEventContextMenu = useCallback((e: CalEvent, x: number, y: number) => {
    setPopover(null);
    setCtx({ x, y, e });
  }, []);

  const onDayContextMenu = useCallback((d: Date, x: number, y: number) => {
    setPopover(null);
    setCtx({ x, y, date: d });
  }, []);

  // 从年/月钻取
  const goMonthAt = (m0: number) => { setAnchor(new Date(anchor.getFullYear(), m0, 1)); setMode('month'); };
  const goWeekAt = (d: Date) => { setAnchor(d); setMode('week'); };
  const selectDay = (d: Date) => { setAnchor(d); setMode('day'); };

  // + 添加：在指定日期创建任务并打开编辑弹层（复用既有 TaskEditModal，
  // 与任务页「添加任务 → 编辑」一致，不新造表单）。
  // 注意：create_task 拒绝空标题，故带默认标题创建，用户随即在弹层改名。
  const addAt = useCallback(async (date: Date) => {
    try {
      const task = await createTask({ title: t('calendar.untitledEvent'), dueDate: toDateKey(date) });
      setEditingTask(task.id);
    } catch {
      // 创建失败（如库不可写）静默降级，不打断日历浏览
    }
  }, [createTask, setEditingTask, t]);

  const onAdd = () => {
    const date = mode === 'year' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : anchor;
    void addAt(date);
  };

  const onCtxEdit = (taskId: string) => { setCtx(null); setEditingTask(taskId); };
  const onCtxToggle = (taskId: string) => { setCtx(null); void toggleTask(taskId); };
  const onCtxDelete = (e: CalEvent) => {
    setCtx(null);
    askConfirm({
      title: t('task.deleteTitle'),
      message: t('task.deleteMsg', { title: e.title || t('calendar.untitled') }),
      confirmText: t('common.delete'),
      danger: true,
      onConfirm: () => deleteTask(e.taskId),
    });
  };
  const onCtxAdd = () => {
    const d = ctx?.date ?? anchor;
    setCtx(null);
    void addAt(d);
  };

  const datesForTimeline = mode === 'week'
    ? weekDates(anchor)
    : mode === 'day'
      ? [anchor]
      : multiDayDates(anchor);

  return (
    <div
      className="cal-page"
      onContextMenu={(ev) => {
        // 接管右键：屏蔽原生菜单；空白处弹软件菜单，事件上由子组件冒泡前拦下
        ev.preventDefault();
        if (ctx || popover) return;
        setPopover(null);
        setCtx({ x: ev.clientX, y: ev.clientY, date: anchor });
      }}
    >
      {/* 顶部导航栏 */}
      <div className="cal-topbar">
        <span className="cal-range">{rangeLabel(mode, anchor)}</span>
        <button className="cal-btn cal-btn-add" aria-label={t('calendar.add')} onClick={onAdd}>+</button>
        <label className="cal-dropdown">
          <Select
            aria-label={t('calendar.viewSwitch')}
            value={mode}
            onChange={(e) => setMode(e.target.value as CalendarViewMode)}
          >
            {VIEW_MODES.map((m) => (
              <option key={m} value={m}>{t(`calendar.mode.${m}`)}</option>
            ))}
          </Select>
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
          onEventContextMenu={onEventContextMenu}
          onDayContextMenu={onDayContextMenu}
        />
      )}
      {(mode === 'week' || mode === 'day' || mode === 'multiday') && (
        <TimelineGrid
          dates={datesForTimeline}
          events={events}
          now={now}
          todayKey={todayKey}
          onEventClick={onEventClick}
          onEventContextMenu={onEventContextMenu}
          onDayContextMenu={onDayContextMenu}
        />
      )}
      {mode === 'schedule' && (
        <ScheduleView
          anchor={anchor}
          events={events}
          onEventClick={onEventClick}
          onEventContextMenu={onEventContextMenu}
        />
      )}
      {mode === 'multiweek' && (
        <MultiWeekView
          anchor={anchor}
          events={events}
          todayKey={todayKey}
          onEventClick={onEventClick}
          onEventContextMenu={onEventContextMenu}
          onDayContextMenu={onDayContextMenu}
        />
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

      {/* 事件详情 / 更多 弹层：可直接跳编辑、勾选完成 */}
      {popover && (
        <EventPopover
          ref={popRef}
          popover={popover}
          events={events}
          tasks={tasks}
          onClose={() => setPopover(null)}
          onEdit={(id) => { setPopover(null); setEditingTask(id); }}
          onToggle={(id) => { void toggleTask(id); }}
        />
      )}

      {/* 自定义右键菜单（接管原生菜单） */}
      {ctx && (
        <CalendarContextMenu
          ctx={ctx}
          tasks={tasks}
          onClose={() => setCtx(null)}
          onEdit={onCtxEdit}
          onToggle={onCtxToggle}
          onDelete={onCtxDelete}
          onAdd={onCtxAdd}
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

const MENU_W = 160;
const MENU_W_EMPTY = 150;
const MENU_H_EVENT = 110;
const MENU_H_EMPTY = 40;

/** 日历右键菜单：事件 = 跳编辑 / 完成勾选 / 删除；空白 = 新建日程 */
function CalendarContextMenu({ ctx, tasks, onClose, onEdit, onToggle, onDelete, onAdd }: {
  ctx: CalCtx;
  tasks: { id: string; completed: number }[];
  onClose(): void;
  onEdit(taskId: string): void;
  onToggle(taskId: string): void;
  onDelete(e: CalEvent): void;
  onAdd(): void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasEvent = !!ctx.e;
  const w = hasEvent ? MENU_W : MENU_W_EMPTY;
  const h = hasEvent ? MENU_H_EVENT : MENU_H_EMPTY;
  const left = Math.max(4, Math.min(ctx.x, window.innerWidth - w - 4));
  const top = Math.max(4, Math.min(ctx.y, window.innerHeight - h - 4));
  const done = ctx.e ? tasks.find((x) => x.id === ctx.e!.taskId)?.completed === 1 : false;

  return (
    <>
      <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="ctx-menu" style={{ left, top }} role="menu">
        {ctx.e ? (
          <>
            <button type="button" role="menuitem" onClick={() => onEdit(ctx.e!.taskId)}>
              <Pencil size={13} aria-hidden /> {t('task.edit')}
            </button>
            <button type="button" role="menuitem" onClick={() => onToggle(ctx.e!.taskId)}>
              <Check size={13} aria-hidden /> {done ? t('task.uncomplete') : t('task.complete')}
            </button>
            <button type="button" role="menuitem" className="danger" onClick={() => onDelete(ctx.e!)}>
              <Trash2 size={13} aria-hidden /> {t('task.delete')}
            </button>
          </>
        ) : (
          <button type="button" role="menuitem" onClick={onAdd}>
            <Plus size={13} aria-hidden /> {t('calendar.add')}
          </button>
        )}
      </div>
    </>
  );
}

const EventPopover = forwardRef<HTMLDivElement, {
  popover: Popover;
  events: CalEvent[];
  tasks: { id: string; completed: number }[];
  onClose(): void;
  onEdit(taskId: string): void;
  onToggle(taskId: string): void;
}>(({ popover, events, tasks, onClose, onEdit, onToggle }, ref) => {
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
      {list.map((e) => {
        const done = tasks.find((x) => x.id === e.taskId)?.completed === 1;
        return (
          <div key={e.taskId} className="cal-pop-row">
            <button
              type="button"
              className={`cal-pop-check${done ? ' done' : ''}`}
              aria-label={done ? t('task.uncomplete') : t('task.complete')}
              aria-pressed={done}
              onClick={() => onToggle(e.taskId)}
            >
              {done && <Check size={11} strokeWidth={3} aria-hidden />}
            </button>
            <div className="body">
              <div className={`title${done ? ' done' : ''}`}>{e.title || t('calendar.untitled')}</div>
              <div className="meta">{e.allDay ? t('calendar.allDay') : rangeTime(e)}</div>
            </div>
            <button
              type="button"
              className="cal-pop-edit"
              aria-label={t('task.edit')}
              title={t('task.edit')}
              onClick={() => onEdit(e.taskId)}
            >
              <Pencil size={13} aria-hidden />
            </button>
          </div>
        );
      })}
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
