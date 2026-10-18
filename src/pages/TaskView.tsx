// 任务视图 / 分类视图 / 清单视图 —— PRD §5.1 FR-T1、§5.2
// 页面标题 + 4 统计卡片 + 添加任务 + 任务列表 + 「显示已完成任务」

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatCards, countCard, minutesCard } from '@/components/StatCards';
import { AddTask } from '@/components/AddTask';
import { TaskItem } from '@/components/TaskItem';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { completedForCategory, computeTaskCards, tasksForCategory, tasksInList, type Dataset } from '@/lib/derive';
import { todayKey, tomorrowKey } from '@/lib/date';
import { useI18n } from '@/i18n';
import type { SmartKey } from '@/types';

const TITLE_KEYS: Record<SmartKey, string> = {
  today: 'nav.today', tomorrow: 'nav.tomorrow', week: 'nav.week',
  scheduled: 'nav.scheduled', completed: 'nav.completed', tasks: 'nav.tasks',
};

export function TaskView() {
  const route = useUiStore((s) => s.route);
  const showCompleted = useUiStore((s) => s.showCompleted);
  const toggleShowCompleted = useUiStore((s) => s.toggleShowCompleted);
  const { tasks, lists, records, reorderTasks } = useDataStore();
  const stats = useStatsStore((s) => s.stats);
  const draggingTaskId = useUiStore((s) => s.draggingTaskId);
  const setDraggingTask = useUiStore((s) => s.setDraggingTask);
  const statsRevision = useStatsStore((s) => s.revision);
  const focusLenMin = useTimerStore((s) => s.settings.focus_len_min);
  const { t, dict } = useI18n();
  const [moveMsg, setMoveMsg] = useState('');

  const key: SmartKey = route.name === 'list' ? 'tasks' : route.name;
  const listId = route.name === 'list' ? route.id : null;

  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const view = useMemo(() => {
    const pending = listId ? tasksInList(ds, listId) : tasksForCategory(ds, key);
    // 已完成任务只显示**当前分类窗口**的，而非全局（修复：分类下误显示全局已完成）
    const done = listId
      ? tasks.filter((t) => t.completed === 1 && t.list_id === listId)
      : completedForCategory(ds, key);
    return { pending, done };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, listId, key, statsRevision]);

  const cards = useMemo(() => {
    const c = computeTaskCards(ds, key, focusLenMin, stats);
    return [
      minutesCard(t('stat.estTime'), c.est_min),
      countCard(t('stat.pending'), listId ? view.pending.length : c.pending),
      minutesCard(t('stat.focused'), c.focus_min),
      countCard(t('stat.completed'), c.done),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dict, ds, key, focusLenMin, stats, statsRevision, view.pending.length, listId]);

  const title = listId ? (lists.find((l) => l.id === listId)?.name ?? t('nav.tasks')) : t(TITLE_KEYS[key]);
  const expanded = !!showCompleted[key];

  // 分类视图自动设置到期日：今天/明天/本周/已计划均预填当天（PRD §5.2）
  const autoDueDate: string | undefined =
    listId ? undefined
      : key === 'today' ? todayKey()
      : key === 'tomorrow' ? tomorrowKey()
      : key === 'week' || key === 'scheduled' ? todayKey()
      : undefined;

  // 拖拽排序：把被拖任务移到目标位置（tasks.md ★2）
  function onReorder(targetId: string) {
    if (!draggingTaskId || draggingTaskId === targetId) return;
    const ids = view.pending.map((t) => t.id);
    const from = ids.indexOf(draggingTaskId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDraggingTask(null); return; }
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setDraggingTask(null);
    void reorderTasks(ids);
  }

  /** 键盘重排（拖拽的等价操作）：任务行上按 Alt + ↑/↓ */
  function onListKeyDown(e: React.KeyboardEvent) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const row = (e.target as HTMLElement).closest('.task-item') as HTMLElement | null;
    const id = row?.dataset.taskId;
    if (!id) return;
    const ids = view.pending.map((x) => x.id);
    const from = ids.indexOf(id);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= ids.length) return;
    e.preventDefault();
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    void reorderTasks(ids);
    const name = view.pending.find((x) => x.id === id)?.title ?? '';
    setMoveMsg(t('a11y.moved', { name, n: to + 1 }));
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-id="${id}"] .task-title`)?.focus();
    });
  }

  return (
    <div className="content">
      <h1 className="page-title">{title}</h1>
      <StatCards cards={cards} />

      <AddTask
        listId={listId}
        dueDate={autoDueDate}
        placeholder={t('task.add', { list: title })}
      />

      <div className="task-list" onKeyDown={onListKeyDown}>
        {view.pending.length === 0 && <div className="empty">{t('task.empty')}</div>}
        {view.pending.map((t) => <TaskItem key={t.id} task={t} onReorder={onReorder} />)}
      </div>
      {/* 键盘重排的读屏播报（视觉隐藏） */}
      <div className="sr-only" role="status" aria-live="polite">{moveMsg}</div>

      {(
        <>
          <button
            className="show-completed" aria-expanded={expanded}
            onClick={() => toggleShowCompleted(key)}
          >
            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {t('task.showCompleted')}
            <span style={{ color: 'var(--text-3)' }}>({view.done.length})</span>
          </button>
          {expanded && view.done.map((t) => <TaskItem key={t.id} task={t} />)}
        </>
      )}
    </div>
  );
}
