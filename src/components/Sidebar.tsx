// 侧边栏 —— PRD FR-G2（截图事实 S1/S2）
// 账号区 / 搜索框 / 6 分类导航（各带已专注时长 + 任务数角标）/ 用户清单（紧跟"任务"、分割线分隔）/ 创建清单（名称 + 图标）

import { useMemo, useState } from 'react';
import {
  CalendarDays, CalendarClock, CheckCircle2, GripVertical, ListTodo, Plus, Search,
  Sun, Sunrise, User as UserIcon,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useAuthStore } from '@/stores/authStore';
import { pbAvatarFileUrl } from '@/lib/pb';
import { categoryFocusMinutes, categoryTaskCount, tasksInList, type Dataset } from '@/lib/derive';
import { formatMinutesShort } from '@/lib/date';
import { defaultListIcon, LIST_ICON_COLORS, LIST_ICON_GLYPHS, resolveListIconColor } from '@/lib/listIcon';
import { useI18n, type ZhKey } from '@/i18n';
import type { SmartKey, ListIconType } from '@/types';
import { ALL_TASKS_LIST_ID } from '@/types';

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
  const authStatus = useAuthStore((s) => s.status);
  // 仅已登录才走「云端资料 → 本地兜底」；未登录一律显示预设占位（不暴露本地种子里的写死昵称）
  const signedIn = authStatus === 'signedIn';
  // 云端头像优先（PB users.avatar），否则回退本地头像文件，最后首字母
  const cloudAvatarUrl = signedIn && cloudUser && typeof cloudUser.avatar === 'string' && cloudUser.avatar
    ? pbAvatarFileUrl(cloudUser, 72)
    : '';
  const todayFocusMin = useStatsStore((s) => s.stats?.today_focus_min ?? 0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [iconType, setIconType] = useState<ListIconType>(defaultListIcon().icon_type);
  const [iconColor, setIconColor] = useState(defaultListIcon().icon_color);
  const [iconGlyph, setIconGlyph] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const { t } = useI18n();
  const displayName = signedIn
    ? (cloudUser?.name?.trim() || cloudUser?.email?.split('@')[0] || user?.username || t('account.untitled'))
    : t('account.guest');
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

  // 侧边栏只展示「自定义」清单：排除内置的「任务」清单（与顶部智能分类重复）
  const customRows = useMemo(() => listRows.filter((l) => l.id !== ALL_TASKS_LIST_ID), [listRows]);

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
    const fromIdx = customRows.findIndex((l) => l.id === dragId);
    const toIdx = customRows.findIndex((l) => l.id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setOverId(null); return; }
    const next = [...customRows.map((l) => l.id)];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    void reorderLists(next);
    setDragId(null); setOverId(null);
  }

  function cancelCreate() {
    setCreating(false);
    setName('');
    setIconType('dot');
    setIconColor(defaultListIcon().icon_color);
    setIconGlyph('');
  }

  async function submitList() {
    const v = name.trim();
    if (!v) return;
    await createList(v, { icon_type: iconType, icon_color: iconColor, icon_glyph: iconGlyph.trim() });
    cancelCreate();
  }

  const activeKey = ui.route.name === 'list' ? null : ui.route.name;

  /** 键盘重排清单：焦点在清单行上按 Alt + ↑/↓，与拖拽等效 */
  function moveList(id: string, dir: -1 | 1) {
    const ids = customRows.map((l) => l.id);
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
            : signedIn
              ? (user?.avatar_path
                  ? <img src={user.avatar_path} alt="" />
                  : (displayName[0]?.toUpperCase() ?? 'U'))
              : <UserIcon size={14} aria-hidden />}
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

        {/* 自定义清单：紧跟"任务"条目之后，分割线分隔（排除内置「任务」清单） */}
        {customRows.length > 0 && <div className="nav-divider" role="separator" />}

        {customRows.map((l) => (
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
              {l.icon_type === 'font' && l.icon_glyph
                ? <span className="list-glyph" style={{ color: resolveListIconColor(l) }}>{l.icon_glyph}</span>
                : <span className="list-dot" style={{ background: resolveListIconColor(l) }} />}
              <span className="nav-label" style={{ flex: 1 }}>{l.name}</span>
              {draggingTaskId && <span className="list-move-hint">{t('list.dropToMove')}</span>}
              <span className="nav-count">{l.count}</span>
            </button>
          </div>
        ))}
      </nav>

      {/* 创建清单：固定在侧边栏底部 */}
      <div className="sidebar-foot">
        {creating ? (
          <div className="list-create" role="group" aria-label={t('list.new')}>
            <input
              className="new-list-input"
              autoFocus
              placeholder={t('list.placeholder')}
              aria-label={t('list.placeholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitList();
                if (e.key === 'Escape') cancelCreate();
              }}
            />

            <div className="list-create-row">
              <span className="list-create-label">{t('list.icon.type')}</span>
              <div className="seg" role="group" aria-label={t('list.icon.type')}>
                <button
                  type="button" className={iconType === 'dot' ? 'active' : ''}
                  aria-pressed={iconType === 'dot'}
                  onClick={() => setIconType('dot')}
                >
                  {t('list.icon.dot')}
                </button>
                <button
                  type="button" className={iconType === 'font' ? 'active' : ''}
                  aria-pressed={iconType === 'font'}
                  onClick={() => setIconType('font')}
                >
                  {t('list.icon.font')}
                </button>
              </div>
            </div>

            {iconType === 'font' && (
              <div className="list-create-row">
                <span className="list-create-label">{t('list.icon.glyph')}</span>
                <div className="glyph-palette">
                  {LIST_ICON_GLYPHS.map((g) => (
                    <button
                      type="button" key={g}
                      className={iconGlyph === g ? 'active' : ''}
                      style={{ color: iconColor }}
                      onClick={() => setIconGlyph(g)}
                    >
                      {g}
                    </button>
                  ))}
                  <input
                    className="glyph-custom" maxLength={2}
                    aria-label={t('list.icon.glyph')}
                    value={iconGlyph}
                    onChange={(e) => setIconGlyph(e.target.value.slice(-1))}
                  />
                </div>
              </div>
            )}

            <div className="list-create-row">
              <span className="list-create-label">{t('list.icon.color')}</span>
              <div className="color-palette" role="group" aria-label={t('list.icon.color')}>
                {LIST_ICON_COLORS.map((c) => (
                  <button
                    type="button" key={c}
                    className={iconColor === c ? 'active' : ''}
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={iconColor === c}
                    onClick={() => setIconColor(c)}
                  />
                ))}
              </div>
            </div>

            <div className="list-create-actions">
              <button type="button" className="btn" onClick={cancelCreate}>{t('common.cancel')}</button>
              <button
                type="button" className="btn primary"
                disabled={!name.trim()}
                onClick={() => void submitList()}
              >
                {t('list.create')}
              </button>
            </div>
          </div>
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