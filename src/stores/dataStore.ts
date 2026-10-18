// 业务数据状态：任务 / 清单 / 用户 / 通知。
// 数据变更后由 data://changed 事件驱动重载（PRD §8.8-3）。

import { create } from 'zustand';
import { api, on } from '@/api';
import type { FocusRecord, Notification, Task, TaskList, User } from '@/types';
import type { CreateTaskArgs, UpdateTaskPatch } from '@/api/types';
import type { ListIconSpec } from '@/lib/listIcon';

interface DataState {
  ready: boolean;
  user: User | null;
  lists: TaskList[];
  tasks: Task[];
  records: FocusRecord[];
  notifications: Notification[];
  revision: number;

  bootstrap(): Promise<void>;
  reload(): Promise<void>;
  reloadTasks(): Promise<void>;
  reloadNotifs(): Promise<void>;

  createTask(args: CreateTaskArgs): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskPatch): Promise<void>;
  toggleTask(id: string): Promise<void>;
  reorderTasks(ids: string[]): Promise<void>;
  deleteTask(id: string): Promise<void>;

  createList(name: string, icon?: ListIconSpec): Promise<void>;
  renameList(id: string, name: string): Promise<void>;
  deleteList(id: string): Promise<void>;
  reorderLists(ids: string[]): Promise<void>;
  setDefaultList(id: string | null): Promise<void>;

  updateUser(patch: Partial<Pick<User, 'username' | 'email' | 'avatar_path'>>): Promise<void>;
  pickAvatar(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

let subscribed = false;

export const useDataStore = create<DataState>((set, get) => ({
  ready: false,
  user: null,
  lists: [],
  tasks: [],
  records: [],
  notifications: [],
  revision: 0,

  async bootstrap() {
    if (!subscribed) {
      subscribed = true;
      on('data://changed', () => { void get().reload(); });
    }
    await get().reload();
    set({ ready: true });
  },

  async reload() {
    const [user, lists, tasks, records, notifications] = await Promise.all([
      api.get_user(), api.list_lists(), api.list_tasks(),
      api.list_focus_records(), api.list_notifications(),
    ]);
    set((s) => ({ user, lists, tasks, records, notifications, revision: s.revision + 1 }));
  },

  async reloadTasks() {
    const tasks = await api.list_tasks();
    set((s) => ({ tasks, revision: s.revision + 1 }));
  },

  async reloadNotifs() {
    const notifications = await api.list_notifications();
    set({ notifications });
  },

  async createTask(args) {
    const t = await api.create_task(args);
    await get().reload();
    return t;
  },
  async updateTask(id, patch) { await api.update_task(id, patch); await get().reload(); },
  async toggleTask(id) { await api.toggle_task(id); await get().reload(); },
  async reorderTasks(ids) { await api.reorder_tasks(ids); await get().reload(); },
  async deleteTask(id) { await api.delete_task(id); await get().reload(); },

  async createList(name, icon) {
    await api.create_list({
      name,
      iconType: icon?.icon_type,
      iconColor: icon?.icon_color,
      iconGlyph: icon?.icon_glyph,
    });
    await get().reload();
  },
  async reorderLists(ids) { await api.reorder_lists(ids); await get().reload(); },
  async setDefaultList(id) { await api.set_setting('default_list_id', id ?? ''); await get().reload(); },
  async renameList(id, name) { await api.rename_list(id, name); await get().reload(); },
  async deleteList(id) { await api.delete_list(id); await get().reload(); },

  async updateUser(patch) { const user = await api.update_user(patch); set({ user }); },
  async pickAvatar() {
    const path = await api.pick_avatar();
    if (path) await get().updateUser({ avatar_path: path });
  },
  async markRead(id) { await api.mark_notif_read(id); await get().reloadNotifs(); },
  async markAllRead() { await api.mark_all_notifs_read(); await get().reloadNotifs(); },
}));

export const unreadCount = (n: Notification[]) => n.filter((x) => x.read === 0).length;
