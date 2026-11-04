import { useQuestStore } from '@/stores/questStore';
import { localDay } from '@/lib/quests/model';
// 侧边栏 —— PRD FR-G2（截图事实 S1/S2）
// 账号区 / 搜索框 / 6 分类导航 / 清单夹（可收纳多个清单，嵌套导引线）+ 顶层自定义清单 / 底部创建清单·清单夹

import { useMemo, useState, type CSSProperties } from 'react';
import {
  CalendarDays, CalendarClock, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, Folder, FolderPlus,
  ScrollText, GripVertical, Heart, History, ListTodo, Plus, Search, Sparkles, Sun, Sunrise, User as UserIcon,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useDataStore } from '@/stores/dataStore';
import { useStatsStore } from '@/stores/statsStore';
import { useAuthStore } from '@/stores/authStore';
import { pbAvatarFileUrl } from '@/lib/pb';
import {
  categoryFocusMinutes, categoryTaskCount, folderAggregate, listAggregate, tasksInList, type Dataset,
} from '@/lib/derive';
import { formatMinutesShort } from '@/lib/date';
import { resolveFolderColor, resolveListIconColor } from '@/lib/listIcon';
import { useI18n, type ZhKey } from '@/i18n';
import type { SmartKey, TaskList } from '@/types';
import { ALL_TASKS_LIST_ID } from '@/types';

/** 侧边栏智能分类（PRD §5.2）。
 *  主分类（带时长/角标）：今天 / 明天 / 本周 / 已计划 / 任务。
 *  归档项（NAV_ARCHIVE）：`completed` = 已完成任务归档、`records` = 专注（番茄）归档，
 *  两者口径不同不可合并；且**不显示时长与数量**——这些值只随使用单调增长，展示噪音大于信息量。 */
type NavDef = { key: SmartKey; labelKey: ZhKey; icon: typeof Sun };

const NAV_MAIN: NavDef[] = [
  { key: 'today', labelKey: 'nav.today', icon: Sun },
  { key: 'tomorrow', labelKey: 'nav.tomorrow', icon: Sunrise },
  { key: 'week', labelKey: 'nav.week', icon: CalendarDays },
  { key: 'scheduled', labelKey: 'nav.scheduled', icon: CalendarClock },
  { key: 'tasks', labelKey: 'nav.tasks', icon: ListTodo },
];

/** 归档项：居于「任务」与自定义清单之间，上下各一条分隔线；纯导航，无累积数字。 */
const NAV_ARCHIVE: NavDef[] = [
  { key: 'completed', labelKey: 'nav.completed', icon: CheckCircle2 },
  { key: 'records', labelKey: 'nav.records', icon: History },
];

const DOT_COLORS: Record<string, string> = {
  today: '#4A7DE0', tomorrow: '#7BA05B', week: '#D9A441',
  scheduled: '#9B7BD4', completed: '#5A9E8E', records: '#8A8A8A', tasks: '#E85D3F',
};

export function Sidebar() {
  const ui = useUiStore();
  const { user, folders, lists, tasks, records, reorderLists, updateTask } = useDataStore();
  const draggingTaskId = useUiStore((s) => s.draggingTaskId);
  const setDraggingTask = useUiStore((s) => s.setDraggingTask);
  const statsRevision = useStatsStore((s) => s.revision);
  const questData = useQuestStore(s => s.data);
  const acceptedToday = questData.attempts.filter(a => a.status === 'accepted' && a.day === localDay(Date.now()) && Date.now() < a.expiresAt).length;
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
  const [dragId, setDragId] = useState<string | null>(null);
  const { t } = useI18n();
  const displayName = signedIn
    ? (cloudUser?.name?.trim() || cloudUser?.email?.split('@')[0] || user?.username || t('account.untitled'))
    : t('account.guest');
  const [overId, setOverId] = useState<string | null>(null);
  // 折叠的清单夹 id 集合（默认全部展开）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 依赖 tasks / revision 触发重算（统计口径实时聚合）
  const ds: Dataset = useMemo(() => ({ tasks, lists, records }), [tasks, lists, records]);

  const navMeta = useMemo(
    () => NAV_MAIN.map((n) => ({
      ...n,
      minutes: categoryFocusMinutes(ds, n.key, todayFocusMin),
      count: categoryTaskCount(ds, n.key) + (n.key === 'today' ? acceptedToday : 0),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds, statsRevision, todayFocusMin, acceptedToday],
  );

  const listRows = useMemo(
    () => lists.map((l) => ({ ...l, count: tasksInList(ds, l.id).length })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, ds, statsRevision],
  );

  // 侧边栏只展示「自定义」清单：排除内置的「任务」清单（与顶部智能分类重复）
  const customRows = useMemo(() => listRows.filter((l) => l.id !== ALL_TASKS_LIST_ID), [listRows]);

  const foldersSorted = useMemo(() => [...folders].sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at), [folders]);
  const listsInFolder = useMemo(
    () => (fid: string) => customRows.filter((l) => l.folder_id === fid).sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at),
    [customRows],
  );
  const unfiledLists = useMemo(
    // !folder_id：空串也算顶层（历史脏数据把 NULL 外键拉成了 ""，见 db::repair_empty_refs）
    () => customRows.filter((l) => !l.folder_id).sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at),
    [customRows],
  );

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

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

  /** 单个清单行：图标 + 名称 + 专注时长 + 未完成任务数（顶层与夹内复用） */
  function renderListRow(l: TaskList) {
    const agg = listAggregate(ds, l.id);
    return (
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
          onContextMenu={(e) => { e.preventDefault(); ui.openContextMenu({ x: e.clientX, y: e.clientY, kind: 'list', id: l.id }); }}
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
          <span className="nav-time">{formatMinutesShort(agg.minutes)}</span>
          <span className="nav-count">{agg.count}</span>
        </button>
      </div>
    );
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
        {/* 主分类：时长 + 未完成任务角标 */}
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
              <span className="nav-time">{formatMinutesShort(n.minutes)}</span>
              <span className="nav-count">{n.count}</span>
            </button>
          );
        })}

        {/* 归档区：任务 ｜ 已完成 · 记录 ｜ 自定义清单（用户需求 2026-10-19） */}
        <div className="nav-divider" role="separator" />
        {NAV_ARCHIVE.map((n) => {
          const Icon = n.icon;
          const active = activeKey === n.key;
          return (
            <button
              key={n.key}
              className={`nav-item nav-archive${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => ui.navigate({ name: n.key })}
            >
              <Icon size={15} style={{ color: DOT_COLORS[n.key], flex: '0 0 auto' }} aria-hidden />
              {/* 归档项刻意不渲染时长/数量：累积值随使用无限增长，没有导航价值 */}
              <span className="nav-label">{t(n.labelKey)}</span>
            </button>
          );
        })}

        {/* 日历 + 纪念自成一组（用户需求 2026-10-21）：上方一条分割线与「已完成/记录」归档区隔开，
            组内两项相邻不加线；下方沿用清单区那条条件分割线。
            刻意排在归档项之后，保持上方主分类/归档的 .nav-item 序号不变（tools/shoot.mjs 依赖）。 */}
        <div className="nav-divider" role="separator" />
        <button
          className="nav-item nav-calendar"
          aria-current={activeKey === 'calendar' ? 'page' : undefined}
          onClick={() => ui.navigate({ name: 'calendar' })}
        >
          <CalendarRange size={15} style={{ color: '#9B7BD4', flex: '0 0 auto' }} aria-hidden />
          <span className="nav-label">{t('nav.calendar')}</span>
        </button>

        {/* 倒数纪念日（独立日期域，docs/05-modules/countdown.md）：纯导航无时长/角标 */}
        <button
          className="nav-item nav-countdown"
          aria-current={activeKey === 'countdown' ? 'page' : undefined}
          onClick={() => ui.navigate({ name: 'countdown' })}
        >
  <Heart size={15} style={{ color: '#E85D3F', flex: '0 0 auto' }} aria-hidden />
          <span className="nav-label">{t('nav.countdown')}</span>
        </button>

        {/* AI 助手（docs/05-modules/ai.md）：与日历/纪念同组，排在「纪念」之后 */}
        <button className="nav-item nav-quests" aria-current={activeKey === 'quests' ? 'page' : undefined}
          onClick={() => ui.navigate({ name: 'quests' })}>
          <ScrollText size={15} style={{ color: '#a67b43', flex: '0 0 auto' }} aria-hidden /><span className="nav-label">{t('quest.board')}</span>
        </button>
        <button
          className="nav-item nav-ai"
          aria-current={activeKey === 'ai' ? 'page' : undefined}
          onClick={() => ui.navigate({ name: 'ai' })}
        >
          <Sparkles size={15} style={{ color: '#4A7DE0', flex: '0 0 auto' }} aria-hidden />
          <span className="nav-label">{t('nav.ai')}</span>
        </button>

        {/* 清单夹 + 顶层自定义清单：有内容时再补一条分割线（排除内置「任务」清单） */}
        {(customRows.length > 0 || foldersSorted.length > 0) && <div className="nav-divider" role="separator" />}

        {foldersSorted.map((f) => {
          const agg = folderAggregate(ds, f.id);
          const isCollapsed = collapsed.has(f.id);
          return (
            <div key={f.id} className="folder-block">
              <button
                className="folder-row"
                aria-expanded={!isCollapsed}
                onClick={() => toggleCollapse(f.id)}
                onContextMenu={(e) => { e.preventDefault(); ui.openContextMenu({ x: e.clientX, y: e.clientY, kind: 'folder', id: f.id }); }}
              >
                <Folder size={15} style={{ color: resolveFolderColor(f), flex: '0 0 auto' }} aria-hidden />
                <span className="nav-label">{f.name}</span>
                <span className="nav-time">{formatMinutesShort(agg.minutes)}</span>
                <span className="nav-count">{agg.count}</span>
                {isCollapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
              </button>
              {!isCollapsed && (
                <div className="folder-children" style={{ '--guide': resolveFolderColor(f) } as CSSProperties}>
                  {listsInFolder(f.id).map((l) => renderListRow(l))}
                </div>
              )}
            </div>
          );
        })}

        {unfiledLists.map((l) => renderListRow(l))}
      </nav>

      {/* 底部操作：创建清单 + 创建清单夹（同行，各弹一个弹窗） */}
      <div className="sidebar-foot">
        <div className="sidebar-actions">
          <button
            className="list-row create-list-btn"
            aria-label={t('list.new')} title={t('list.new')}
            onClick={() => ui.openListCreate(true)}
          >
            <Plus size={14} style={{ color: 'var(--accent-focus)' }} aria-hidden />
            <span>{t('sidebar.createList')}</span>
          </button>
          <button
            className="icon-btn create-folder-btn"
            aria-label={t('folder.new')} title={t('folder.new')}
            onClick={() => ui.openFolderCreate(true)}
          >
            <FolderPlus size={16} style={{ color: 'var(--accent-focus)' }} aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}