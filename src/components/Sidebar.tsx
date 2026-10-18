// 侧边栏 —— PRD FR-G2（截图事实 S1/S2）
// 账号区 / 搜索框 / 6 分类导航（各带已专注时长 + 任务数角标）/ 用户清单 / 创建清单

import { useMemo, useState } from 'react';
import {
  CalendarDays, CalendarClock, CheckCircle2, GripVertical, ListTodo, Plus, Search,
  Sun, Sunrise,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useAuthStore } from '@/stores/authStore';
import { pbAvatarFileUrl } from '@/lib/pb';
import { categoryFocusMinutes, categoryTaskCount, tasksInList, type Dataset } from '@/lib/derive';
import { formatMinutesShort } from '@/lib/date';
import { useI18n, type ZhKey } from '@/i18n';
import type { SmartKey } from '@/types';

const NAV: Array<{ key: SmartKey; labelKey: ZhKey; icon: typeof Sun }> = [
  { key: 'today', labelKey: 'nav.today', icon: Sun },
  { key: 'tomorrow', labelKey: 'nav.tomorrow', icon: Sunrise },
  { key: 'week', labelKey: 'nav.week', icon: CalendarDays },
  { key: 'scheduled', labelKey: 'nav.scheduled', icon: CalendarClock },
  { key: 'completed', labelKey: 'nav.completed', icon: CheckCircle2 },
  { key: 'tasks', labelKey: 'nav.tasks', icon: ListTodo },
];

const DOT_COLORS: Record<string, string> = {
  today: '#4A7DE0', tomorrow: '#7BA05B', week: '#D9A441',
  scheduled: '#9B7BD4', completed: '#8A8A8A', tasks: '#E85D3F',
};

export function Sidebar() {
  const ui = useUiStore();
  const { user, lists, tasks, records, createList, reorderLists, updateTask } = useDataStore();
  const draggingTaskId = useUiStore((s) => s.draggingTaskId);
  const setDraggingTask = useUiStore((s) => s.setDraggingTask);
  const statsRevision = useStatsStore((s) => s.revision);
  // 身份跟随云端账号：登录后侧边栏显示的就是云端那个账号，避免「设置里 foo@bar.com、侧边栏 honestliu」的割裂
  const cloudUser = useAuthStore((s) => s.user);
  // 云端头像优先（PB users.avatar），否则回退本地头像文件，最后首字母
  const cloudAvatarUrl = cloudUser && typeof cloudUser.avatar === 'string' && cloudUser.avatar
    ? pbAvatarFileUrl(cloudUser, 72)
    : '';
  const todayFocusMin = useStatsStore((s) => s.stats?.today_focus_min ?? 0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const { t } = useI18n();
  const displayName =
    cloudUser?.name?.trim() || cloudUser?.email?.split('@')[0] || user?.username || t('account.untitled');
  const [overId, setOverId] = useState<string | null>(null);

  // 依赖 tasks / revision 触发重算（统计口径实时聚合）
  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const navMeta = useMemo(
    () => NAV.map((n) => ({
      ...n,
      minutes: categoryFocusMinutes(ds, n.key, todayFocusMin),
      count: categoryTaskCount(ds, n.key),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, statsRevision, todayFocusMin],
  );

  const listRows = useMemo(
    () => lists.map((l) => ({ ...l, count: tasksInList(ds, l.id).length })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, ds, statsRevision],
  );

  function onDrop(targetId: string) {
    // 任务是拖来的（跨视图移入清单）：移动任务
    if (draggingTaskId) {
      const target = lists.find((l) => l.id === targetId);
      const idx = target ? tasksInList(ds, target.id).length : 0;
      void updateTask(draggingTaskId, { list_id: target ? target.id : null, sort_order: idx });
      setDraggingTask(null);
      setOverId(null);
      return;
    }
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const fromIdx = listRows.findIndex((l) => l.id === dragId);
    const toIdx = listRows.findIndex((l) => l.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setOverId(null); return; }
    const next = [...listRows.map((l) => l.id)];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    void reorderLists(next);
    setDragId(null); setOverId(null);
  }

  async function submitList() {
    const v = name.trim();
    setCreating(false);
    setName('');
    if (v) await createList(v);
  }

  const activeKey = ui.route.name === 'list' ? null : ui.route.name;

  /** 键盘重排清单：焦点在清单行上按 Alt + ↑/↓，与拖拽等效 */
  function moveList(id: string, dir: -1 | 1) {
    const ids = listRows.map((l) => l.id);
    const from = ids.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorderLists(next);
  }

  return (
    <aside className="sidebar">
      <button
        className="account" aria-haspopup="dialog"
        aria-label={`${t('settings.tab.account')}：${displayName}`}
        onClick={() => ui.openSettings('account')}
      >
        <span className="avatar">
          {cloudAvatarUrl
            ? <img src={cloudAvatarUrl} alt="" />
            : user?.avatar_path
              ? <img src={user.avatar_path} alt="" />
              : (displayName[0]?.toUpperCase() ?? 'U')}
        </span>
        <span className="account-name" title={displayName}>{displayName}</span>
      </button>

      <div className="search-box">
        <Search size={14} aria-hidden />
        <input
          placeholder={t('search.placeholder')}
          aria-label={t('a11y.searchInput')}
          value=""
          onFocus={() => ui.openSearch(true)}
          readOnly
        />
      </div>

      <nav className="nav">
        {navMeta.map((n) => {
          const Icon = n.icon;
          const active = activeKey === n.key;
          return (
            <button
              key={n.key}
              className={`nav-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => ui.navigate({ name: n.key })}
            >
              <Icon size={15} style={{ color: DOT_COLORS[n.key], flex: '0 0 auto' }} aria-hidden />
              <span className="nav-label">{t(n.labelKey)}</span>
              {n.key !== 'completed' && <span className="nav-time">{formatMinutesShort(n.minutes)}</span>}
              <span className="nav-count">{n.count}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        {listRows.map((l) => (
          <div
            key={l.id}
            className={`list-row-wrap${overId === l.id ? ' drag-over' : ''}`}
            draggable
            onDragStart={() => setDragId(l.id)}
            onDragOver={(e) => { e.preventDefault(); if (overId !== l.id) setOverId(l.id); }}
            onDragLeave={() => setOverId((p) => (p === l.id ? null : p))}
            onDrop={(e) => { e.preventDefault(); onDrop(l.id); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
          >
            <button
              className={`list-row${ui.route.name === 'list' && ui.route.id === l.id ? ' active' : ''}`}
              aria-current={ui.route.name === 'list' && ui.route.id === l.id ? 'page' : undefined}
              title={t('a11y.reorderHint')}
              onClick={() => ui.navigate({ name: 'list', id: l.id })}
              onKeyDown={(e) => {
                if (!e.altKey) return;
                if (e.key === 'ArrowUp') { e.preventDefault(); moveList(l.id, -1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); moveList(l.id, 1); }
              }}
            >
              <span className="list-grip" aria-hidden><GripVertical size={12} /></span>
              <span className="dot" style={{ background: '#B4B2AD' }} />
              <span className="nav-label" style={{ flex: 1 }}>{l.name}</span>
              {draggingTaskId && <span className="list-move-hint">{t('list.dropToMove')}</span>}
              <span className="nav-count">{l.count}</span>
            </button>
          </div>
        ))}

        {creating ? (
          <input
            className="new-list-input"
            autoFocus
            placeholder={t('list.placeholder')}
            aria-label={t('list.placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submitList}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitList();
              if (e.key === 'Escape') { setCreating(false); setName(''); }
            }}
          />
        ) : (
          <button className="list-row" onClick={() => setCreating(true)}>
            <Plus size={14} style={{ color: 'var(--text-2)' }} aria-hidden />
            <span style={{ color: 'var(--text-2)' }}>{t('sidebar.createList')}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
