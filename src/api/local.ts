// 本地适配器：以 IndexedDB 承载 §6.2 表结构，实现 §8.4 全部命令。
// 与 Tauri 适配器（src/api/tauri.ts）提供完全相同的调用面。

import type {
  FocusRecord, Goal, Notification, Task, TaskList, TimerState, User,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { tStatic } from '@/i18n/store';
import {
  flush, getDB, getSettings, initDB, mutate, setSetting, settingsMap, wipeDB,
} from '@/db/idb';
import {
  categoryFocusMinutes, completedGroups, computeStats, dailyFocusMap, listDistribution,
  pomodoroGrid, recordsInRange, taskDurations, tasksForCategory,
} from '@/db/queries';
import type { Period } from '@/types';
import type { Api, CreateListArgs, CreateRecordArgs, CreateTaskArgs, ListTasksArgs, UpdateTaskPatch } from './types';
import { broadcastDataChanged } from './events';
import { parseDateKey, toDateKey } from '@/lib/date';
import { defaultListIcon } from '@/lib/listIcon';

const uid = (p: string) =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function ready() { await initDB(); }

/** 旧库升级兜底：早期建的清单可能没有 icon 字段，补默认值 */
function normalizeList<T extends TaskList>(l: T): TaskList {
  if (l.icon_type) return l;
  const d = defaultListIcon();
  return { ...l, icon_type: d.icon_type, icon_color: l.icon_color || d.icon_color, icon_glyph: l.icon_glyph || d.icon_glyph };
}

export const localApi: Api = {
  async get_user() {
    await ready();
    let u = getDB().users[0];
    if (!u) {
      u = mutate((d) => {
        const nu: User = {
          id: 'u_local', username: 'honestliu', email: 'honestliu@icloud.com', avatar_path: '',
          created_at: Date.now(), updated_at: Date.now(),
        };
        d.users.push(nu);
        return nu;
      });
    }
    return { ...u };
  },

  async update_user(patch) {
    await ready();
    return mutate((d) => {
      const u = d.users[0];
      if (!u) throw new Error(tStatic('err.userNotFound'));
      Object.assign(u, patch, { updated_at: Date.now() });
      return { ...u };
    });
  },

  async pick_avatar() {
    await ready();
    // 浏览器运行时用 <input type=file> 降级；Tauri 运行时走 plugin-dialog（见 tauri.ts）
    return new Promise<string | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },

  async list_lists() {
    await ready();
    return getDB().lists
      .map((l) => normalizeList(l))
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
  },

  async get_default_list() {
    await ready();
    return settingsMap()['default_list_id'] || null;
  },

  async set_default_list(id) {
    await ready();
    if (id) {
      // 与 Rust set_default_list_impl 一致：引用的清单必须存在
      if (!getDB().lists.some((l) => l.id === id)) throw new Error(tStatic('err.listNotFound'));
      setSetting('default_list_id', id);
    } else { mutate((d) => { d.settings = d.settings.filter((x) => x.key !== 'default_list_id'); }); }
    await flush();
    broadcastDataChanged('lists');
  },

  async reorder_lists(ids) {
    await ready();
    mutate((d) => {
      const byId = new Map(d.lists.map((l) => [l.id, l]));
      ids.forEach((id, i) => {
        const l = byId.get(id);
        if (l) l.sort_order = i;
      });
    });
    broadcastDataChanged('lists');
  },

  async create_list({ name, iconType, iconColor, iconGlyph }: CreateListArgs) {
    await ready();
    const listName = (name ?? '').trim();
    if (!listName) throw new Error(tStatic('err.listNameRequired'));
    const icon = defaultListIcon();
    const out = mutate((d) => {
      const l: TaskList = {
        id: uid('list'), name: listName, sort_order: d.lists.length,
        is_smart: 0,
        icon_type: iconType ?? icon.icon_type,
        icon_color: (iconColor ?? '').trim() || icon.icon_color,
        icon_glyph: (iconGlyph ?? '').trim() || icon.icon_glyph,
        created_at: Date.now(), updated_at: Date.now(),
      };
      d.lists.push(l);
      return { ...l };
    });
    broadcastDataChanged('lists');
    return out;
  },

  async rename_list(id, name) {
    await ready();
    const listName = name.trim();
    if (!listName) throw new Error(tStatic('err.listNameRequired'));
    const out = mutate((d) => {
      const l = d.lists.find((x) => x.id === id);
      if (!l) throw new Error(tStatic('err.listNotFound'));
      l.name = listName;
      l.updated_at = Date.now();
      return { ...l };
    });
    broadcastDataChanged('lists');
    return out;
  },

  async delete_list(id) {
    await ready();
    mutate((d) => {
      d.lists = d.lists.filter((l) => l.id !== id);
      // 任务 list_id 置空（PRD §6.2 ON DELETE SET NULL）
      for (const t of d.tasks) if (t.list_id === id) t.list_id = null;
    });
    broadcastDataChanged('lists');
  },

  async list_tasks(args: ListTasksArgs = {}) {
    await ready();
    const db = getDB();
    // 与 Rust list_tasks_impl 的 WHERE 组合保持同序：清单 -> 完成态 -> 关键词 -> 日期
    let rows: Task[] = [...db.tasks];
    if (args.listId) rows = rows.filter((t) => t.list_id === args.listId);
    if (args.completed !== undefined) {
      rows = rows.filter((t) => (t.completed === 1) === args.completed);
    } else if (args.listId) {
      // 清单视图默认只看未完成（与桌面端一致）；「全部任务」视图仍返回全部
      rows = rows.filter((t) => t.completed === 0);
    }
    if (args.search) {
      const n = args.search.trim().toLowerCase();
      rows = rows.filter((t) => n === '' || t.title.toLowerCase().includes(n));
    }
    if (args.dueFrom) rows = rows.filter((t) => t.due_date !== null && t.due_date >= args.dueFrom!);
    if (args.dueTo) rows = rows.filter((t) => t.due_date !== null && t.due_date <= args.dueTo!);
    return rows
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)
      .map((t) => ({ ...t }));
  },

  async create_task(args: CreateTaskArgs) {
    await ready();
    const title = args.title.trim();
    if (!title) throw new Error(tStatic('err.taskTitleRequired'));
    const out = mutate((d) => {
      const settings = settingsMap();
      const defId = settings['default_list_id'];
      const firstList = [...d.lists]
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at)[0]?.id ?? null;
      const listId = args.listId
        ?? (defId && d.lists.some((l) => l.id === defId) ? defId : null)
        ?? firstList;
      const t: Task = {
        id: uid('task'),
        list_id: listId,
        title,
        notes: args.notes ?? '',
        est_pomodoros: args.estPomodoros ?? 0,
        due_date: args.dueDate ?? null,
        completed: 0,
        completed_at: null,
        sort_order: d.tasks.filter((x) => x.list_id === listId).length,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      d.tasks.push(t);
      return { ...t };
    });
    broadcastDataChanged('tasks');
    return out;
  },

  async update_task(id, patch: UpdateTaskPatch) {
    await ready();
    const clean: UpdateTaskPatch = { ...patch };
    if (clean.title !== undefined) {
      const title = clean.title.trim();
      if (!title) throw new Error(tStatic('err.taskTitleRequired'));
      clean.title = title;
    }
    // 只写显式出现的键；避免 patch 里的 undefined 覆盖已有值
    for (const k of Object.keys(clean) as Array<keyof UpdateTaskPatch>) {
      if (clean[k] === undefined) delete clean[k];
    }
    const out = mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) throw new Error(tStatic('err.taskNotFound'));
      Object.assign(t, clean, { updated_at: Date.now() });
      return { ...t };
    });
    broadcastDataChanged('tasks');
    return out;
  },

  async toggle_task(id) {
    await ready();
    const out = mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) throw new Error(tStatic('err.taskNotFound'));
      t.completed = t.completed ? 0 : 1;
      t.completed_at = t.completed ? Date.now() : null;
      t.updated_at = Date.now();
      return { ...t };
    });
    broadcastDataChanged('tasks');
    return out;
  },

  async reorder_tasks(ids) {
    await ready();
    mutate((d) => {
      const byId = new Map(d.tasks.map((t) => [t.id, t]));
      ids.forEach((id, i) => {
        const t = byId.get(id);
        if (t) t.sort_order = i;
      });
      // 未涉及的任务保持原 sort_order（与 Rust reorder_tasks_impl 一致）
    });
    broadcastDataChanged('tasks');
  },

  async delete_task(id) {
    await ready();
    mutate((d) => {
      d.tasks = d.tasks.filter((t) => t.id !== id);
      // focus_records.task_id 置空（PRD §6.2 ON DELETE SET NULL）
      for (const r of d.focus_records) if (r.task_id === id) r.task_id = null;
    });
    broadcastDataChanged('tasks');
  },

  async create_focus_record(args: CreateRecordArgs) {
    await ready();
    if (args.endAt < args.startAt) throw new Error(tStatic('err.endBeforeStart'));
    const out = mutate((d) => {
      const task = args.taskId ? d.tasks.find((t) => t.id === args.taskId) : undefined;
      const r: FocusRecord = {
        id: uid('fr'),
        task_id: args.taskId ?? null,
        list_id: args.listId ?? task?.list_id ?? null,
        start_at: args.startAt,
        end_at: args.endAt,
        duration_min: args.durationMin,
        phase: 'focus',
        created_at: Date.now(),
      };
      d.focus_records.push(r);
      return { ...r };
    });
    broadcastDataChanged('focus_records');
    return out;
  },

  async list_focus_records(args = {}) {
    await ready();
    const from = args.from ?? 0;
    const to = args.to ?? Number.MAX_SAFE_INTEGER;
    return recordsInRange(from, to, args.taskId).map((r) => ({ ...r }));
  },

  async get_stats() {
    await ready();
    return computeStats();
  },

  async get_pomodoro_grid(days = 14) {
    await ready();
    // 与 Rust pomodoro_grid_impl 的 clamp(1, 90) 对齐，避免异常入参撑爆渲染
    return pomodoroGrid(Math.min(90, Math.max(1, Math.trunc(days))));
  },

  async get_task_durations(period, anchorDate) {
    await ready();
    return taskDurations(period as Period, parseDateKey(anchorDate));
  },

  async get_list_distribution(period, anchorDate) {
    await ready();
    return listDistribution(period as Period, parseDateKey(anchorDate));
  },

  async get_goal() {
    await ready();
    const g = getDB().goals[0];
    return g ? { ...g } : { id: 'default', daily_target_min: DEFAULT_SETTINGS.daily_target_min };
  },

  async set_goal(minutes) {
    await ready();
    const out = mutate((d) => {
      const g: Goal = d.goals[0] ?? { id: 'default', daily_target_min: minutes };
      g.daily_target_min = Math.max(0, Math.round(minutes));
      if (!d.goals[0]) d.goals.push(g);
      const row = d.settings.find((s) => s.key === 'daily_target_min');
      if (row) row.value = String(g.daily_target_min);
      else d.settings.push({ key: 'daily_target_min', value: String(g.daily_target_min) });
      return { ...g };
    });
    broadcastDataChanged('goals');
    return out;
  },

  async get_timer_state() {
    await ready();
    const s = getDB().timer_state[0];
    return s ? { ...s } : {
      phase: 'idle', mode: 'pomodoro', task_id: null, running: false,
      start_at: null, end_at: null, paused_remaining_ms: null,
    };
  },

  async set_timer_state(state: TimerState) {
    await ready();
    return mutate((d) => {
      d.timer_state[0] = { ...state };
      return { ...state };
    });
  },

  async update_tray_title(_text: string) {
    // 浏览器运行时无菜单栏托盘，静默忽略
  },

  async update_tray_toggle(_text: string) {
    // 浏览器运行时无菜单栏托盘，静默忽略
  },

  async set_tray_phase(_phase: string) {
    // 浏览器运行时无菜单栏托盘，静默忽略
  },

  async get_settings() {
    await ready();
    return getSettings();
  },

  async set_setting(key, value) {
    await ready();
    setSetting(key, value);
    await flush();
    return getSettings();
  },

  async list_notifications() {
    await ready();
    return getDB().notifications.map((n) => ({ ...n })).sort((a, b) => b.created_at - a.created_at);
  },

  async create_notification(args) {
    await ready();
    const out = mutate((d) => {
      const n: Notification = {
        id: uid('ntf'), type: args.type, title: args.title, body: args.body,
        read: 0, created_at: Date.now(),
      };
      d.notifications.unshift(n);
      return { ...n };
    });
    broadcastDataChanged('notifications');
    return out;
  },

  async mark_notif_read(id) {
    await ready();
    mutate((d) => {
      const n = d.notifications.find((x) => x.id === id);
      if (n) n.read = 1;
    });
    broadcastDataChanged('notifications');
  },

  async mark_all_notifs_read() {
    await ready();
    mutate((d) => { for (const n of d.notifications) n.read = 1; });
    broadcastDataChanged('notifications');
  },

  async clear_all_data() {
    await ready();
    wipeDB();
    await flush();
    broadcastDataChanged('all');
  },

  async logout() {
    await ready();
    // 退出登录是**会话级、可逆**的操作：只清前端 PB 会话（authStore.logout），本地数据一律保留。
    // 之前这里做 resetDB() 并把整库重置为出厂态，导致「只是想换个账号」的用户丢掉全部任务与专注记录。
    // PRD FR-S2 的「注销账号 → 登出并清理」属另一个不可逆动作，走 clear_all_data()。
  },
};

// 供测试/校验使用：导出内部口径以便与截图数据比对
export const __internals = {
  computeStats,
  tasksForCategory,
  categoryFocusMinutes,
  completedGroups,
  dailyFocusMap,
  toDateKey,
  settingsMap,
};

export type { Notification };
