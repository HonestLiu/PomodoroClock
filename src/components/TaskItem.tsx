// 任务条目 —— PRD FR-T3（截图事实 S1）
// 布局：圆形完成勾选 → 任务名 → 预估番茄数 → 到期日
// P1：行尾「⋯」更多菜单 + 右键菜单（标记完成/移到清单/复制/删除）

import { useEffect, useState } from 'react';
import { Check, Flag, Link2, MoreHorizontal, Copy, Repeat, Trash2, FolderPlus, ListTodo, Play } from 'lucide-react';
import type { Task } from '@/types';
import { formatDueDate } from '@/lib/date';
import { isOverdue } from '@/lib/derive';
import { resolveListIconColor } from '@/lib/listIcon';
import { ALL_TASKS_LIST_ID } from '@/types';
import { useDataStore } from '@/stores/dataStore';
import { useTimerStore } from '@/stores/timerStore';
import { useUiStore } from '@/stores/uiStore';
import { Menu, type MenuItem } from './Menu';
import { useI18n } from '@/i18n';

/** 小番茄图标（FR：每完成一个番茄累计一个） */
function TomatoIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="11.5" r="7" fill="#e85d3f" />
      <circle cx="7.6" cy="9" r="2.4" fill="#ff9a76" opacity="0.55" />
      <path
        d="M10 4C7.8 4 6.4 2.7 5.8 1 6.8 2 7.6 2.8 8.8 3c-1.9-1-1-2.8-.2-3 .7 1.1.8 2 .9 3.3.4-1.3 1-2.2 1.7-3 .8 1.8 1.9 2.7 3.9 2.8-1.3.5-2.3 1-2.5 3.4-1-.2-1-2-1.6 0z"
        fill="#4caf50"
      />
    </svg>
  );
}

export function TaskItem({ task, onReorder, showListSource = false }: {
  task: Task;
  /** 存在时启用拖拽排序（tasks.md ★2）；目标行被投放时以 targetId 回调 */
  onReorder?: (targetId: string) => void;
  /** 智能时间视图（今天/明天/本周）下，标注任务来源于哪个自定义清单 */
  showListSource?: boolean;
}) {
  const toggleTask = useDataStore((s) => s.toggleTask);
  const updateTask = useDataStore((s) => s.updateTask);
  const createTask = useDataStore((s) => s.createTask);
  const deleteTask = useDataStore((s) => s.deleteTask);
  const lists = useDataStore((s) => s.lists);
  const records = useDataStore((s) => s.records);
  const setEditingTask = useUiStore((s) => s.setEditingTask);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const highlight = useUiStore((s) => s.highlight);
  const clearHighlight = useUiStore((s) => s.clearHighlight);
  const setDraggingTask = useUiStore((s) => s.setDraggingTask);
  const selectedTaskIds = useUiStore((s) => s.selectedTaskIds);
  const toggleTaskSelect = useUiStore((s) => s.toggleTaskSelect);
  const { t } = useI18n();

  const [dragOver, setDragOver] = useState(false);

  // 多选：Cmd/Ctrl 点选。capture 阶段拦截，阻止子控件(编辑/勾选/播放)触发。
  const selected = selectedTaskIds.includes(task.id);
  function handleRowClickCapture(e: React.MouseEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTaskSelect(task.id);
  }

  function onDragStart(e: React.DragEvent) {
    setDraggingTask(task.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    setDraggingTask(null);
    onReorder?.(task.id);
  }

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState(false);

  // 该任务累计完成的番茄数 → 右侧小番茄图标（每条专注记录一个）
  const pomodoroCount = records.filter((r) => r.task_id === task.id).length;

  // 逾期标志（未完成 + 到期日早于今天）
  const overdue = isOverdue(task);
  // 来源清单：仅自定义清单（内置「任务」清单不打标），在时间视图里标注
  const sourceList = showListSource && task.list_id && task.list_id !== ALL_TASKS_LIST_ID
    ? lists.find((l) => l.id === task.list_id)
    : undefined;

  // 提醒事项派生：URL 显示名 / 标签 / 到时文本（日期 + 时间）
  const url = task.url?.trim() ?? '';
  const niceUrl = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || url;
  const tags = task.tags ?? [];
  const dueText = task.due_time
    ? `${formatDueDate(task.due_date)} ${task.due_time}`
    : formatDueDate(task.due_date);

  function openUrl() {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    // Tauri webview 与浏览器均走系统默认浏览器打开；失败静默
    window.open(href, '_blank', 'noopener');
  }

  // 搜索定位高亮（search.md ★1）：命中一次后自动清除
  useEffect(() => {
    if (task.id === highlight) setFlash(true);
  }, [highlight, task.id]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => { setFlash(false); clearHighlight(); }, 1500);
    return () => clearTimeout(t);
  }, [flash, clearHighlight]);

  function close() { setMenu(null); }

  const moveItems: Array<MenuItem & { value?: string }> = lists.map((l) => ({
    key: l.id,
    label: l.name,
    value: l.id,
  }));
  moveItems.push({ key: '_none', label: t('task.noneList'), value: '__none__' });

  const menuItems: MenuItem[] = [
    {
      key: 'toggle',
      label: task.completed === 1 ? t('task.uncomplete') : t('task.complete'),
      icon: <Check size={13} />,
      onSelect: () => { void toggleTask(task.id); close(); },
    },
    {
      key: 'edit',
      label: t('task.edit'),
      icon: <ListTodo size={13} />,
      onSelect: () => { setEditingTask(task.id); close(); },
    },
    {
      key: 'move',
      label: t('task.moveToList'),
      icon: <FolderPlus size={13} />,
      children: moveItems,
      onSelect: (value) => {
        const listId = value === '__none__' ? null : (value ?? task.list_id);
        void updateTask(task.id, { list_id: listId });
        close();
      },
    },
    {
      key: 'copy',
      label: t('task.copy'),
      icon: <Copy size={13} />,
      onSelect: () => {
        void createTask({
          title: task.title,
          listId: task.list_id ?? undefined,
          estPomodoros: task.est_pomodoros,
          notes: task.notes,
          dueDate: task.due_date ?? undefined,
          dueTime: task.due_time ?? undefined,
          url: task.url,
          urgent: task.urgent,
          repeat: task.repeat,
          leadRemind: task.lead_remind,
          tags: task.tags,
          flag: task.flag,
          priority: task.priority,
        });
        close();
      },
    },
    {
      key: 'delete',
      label: t('task.delete'),
      danger: true,
      icon: <Trash2 size={13} />,
      onSelect: () => {
        close();
        askConfirm({
          title: t('task.deleteTitle'),
          message: t('task.deleteMsg', { title: task.title }),
          confirmText: t('common.delete'),
          danger: true,
          onConfirm: () => deleteTask(task.id),
        });
      },
    },
  ];

  function openAt(x: number, y: number, e?: React.MouseEvent) {
    e?.stopPropagation();
    setMenu({ x, y });
  }

  /** 直接进入绑定该任务的番茄钟 */
  function startPomodoro(e: React.MouseEvent) {
    e.stopPropagation();
    const timer = useTimerStore.getState();
    timer.setTask(task.id);
    timer.openScreen(true);
  }

  return (
    <div
      data-task-id={task.id}
      className={`task-item${task.completed ? ' done' : ''}${menu ? ' menu-open' : ''}${flash ? ' highlight' : ''}${dragOver ? ' drag-target' : ''}${onReorder ? ' draggable-row' : ''}${selected ? ' task-selected' : ''}`}
      draggable={!!onReorder && task.completed === 0}
      onClickCapture={handleRowClickCapture}
      onDragStart={onReorder ? onDragStart : undefined}
      onDragEnd={() => { setDraggingTask(null); setDragOver(false); }}
      onDragOver={(e) => { if (onReorder) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onReorder ? onDrop : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        openAt(e.clientX, e.clientY);
      }}
    >
      <button
        className={`check${task.completed ? ' checked' : ''}`}
        aria-label={task.completed ? t('task.uncomplete') : t('task.complete')}
        onClick={(e) => { e.stopPropagation(); void toggleTask(task.id); }}
      >
        {task.completed === 1 && <Check size={11} strokeWidth={3} aria-hidden />}
      </button>

      <button
        className="task-play"
        title={t('timer.cta.start')}
        aria-label={t('timer.cta.start')}
        onClick={startPomodoro}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Play size={11} strokeWidth={2.5} aria-hidden />
      </button>

      <span
        className={`task-title${task.urgent === 1 ? ' urgent' : ''}`}
        role="button"
        tabIndex={0}
        title={task.title}
        onClick={() => setEditingTask(task.id)}
        onDoubleClick={() => setEditingTask(task.id)}
        onKeyDown={(e) => {
          // 键盘等价操作：Enter / Space 打开编辑（Space 是按钮的标准激活键）
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditingTask(task.id);
          }
        }}
      >
        {task.flag === 1 && <Flag size={12} className="task-flag" aria-hidden />}
        {task.priority && task.priority !== 'none' && (
          <span className={`task-prio task-prio-${task.priority}`} title={t(`task.priority.${task.priority}`)} aria-hidden />
        )}
        {task.title}
        {task.urgent === 1 && <span className="task-urgent">{t('task.urgent')}</span>}
        {(tags.length > 0 || url) && (
          <span className="task-sub">
            {tags.map((tag) => <span key={tag} className="task-tag">{tag}</span>)}
            {url && (
              <span
                className="task-url"
                role="link" tabIndex={0} title={url}
                onClick={(e) => { e.stopPropagation(); openUrl(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openUrl(); } }}
              >
                <Link2 size={11} aria-hidden /> {niceUrl}
              </span>
            )}
          </span>
        )}
      </span>

      {pomodoroCount > 0 && (
        <span className="task-pomos" title={t('task.pomoDone', { n: pomodoroCount })}>
          {Array.from({ length: pomodoroCount }).map((_, i) => (
            <TomatoIcon key={i} />
          ))}
        </span>
      )}

      <span className="task-meta">
        {sourceList && (
          <button
            type="button"
            className="task-source"
            title={t('task.fromList', { name: sourceList.name })}
            onClick={(e) => {
              e.stopPropagation();
              useUiStore.getState().navigate({ name: 'list', id: sourceList.id });
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="task-source-dot" style={{ background: resolveListIconColor(sourceList) }} aria-hidden />
            {sourceList.name}
          </button>
        )}
        {overdue && <span className="task-overdue">{t('task.overdue')}</span>}
        {task.repeat && task.repeat !== 'none' && (
          <Repeat size={12} className="task-repeat" aria-hidden />
        )}
        {task.est_pomodoros > 0 && (
          <span className="task-est">{task.est_pomodoros.toFixed(1).replace(/\.0$/, '')}</span>
        )}
        {task.due_date && (
          <span className={`task-due${overdue ? ' overdue' : ''}`}>{dueText}</span>
        )}
      </span>

      <button
        className="task-more"
        title={t('menu.label')}
        aria-label={t('menu.label')}
        onClick={(e) => { e.stopPropagation(); openAt(e.currentTarget.getBoundingClientRect().right - 12, e.currentTarget.getBoundingClientRect().bottom + 4); }}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={close} />}
    </div>
  );
}
