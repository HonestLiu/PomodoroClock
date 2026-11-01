// 业务数据状态：任务 / 清单 / 用户 / 通知。
// 数据变更后由 data://changed 事件驱动重载（PRD §8.8-3）。

import { create } from 'zustand';
import { api, on } from '@/api';
import type { FocusRecord, Folder, Notification, Task, TaskList, User } from '@/types';
import type { CreateTaskArgs, UpdateTaskPatch } from '@/api/types';
import type { ListIconSpec } from '@/lib/listIcon';
import { nextOccurrence } from '@/lib/recurrence';
import { useGrowthStore } from '@/stores/growthStore';

interface DataState {
  ready: boolean;
  user: User | null;
  folders: Folder[];
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
  /** 多选批量：同一补丁应用到多条任务（一次重载） */
  batchPatch(ids: string[], patch: UpdateTaskPatch): Promise<void>;
  /** 多选批量：删除多条（一次重载） */
  batchDelete(ids: string[]): Promise<void>;
  /** 多选批量：切换完成态（含重复任务推进，一次重载） */
  batchToggle(ids: string[]): Promise<void>;

  createList(name: string, icon?: ListIconSpec): Promise<void>;
  renameList(id: string, name: string): Promise<void>;
  deleteList(id: string): Promise<void>;
  reorderLists(ids: string[]): Promise<void>;
  setDefaultList(id: string | null): Promise<void>;
  setListFolder(listId: string, folderId: string | null): Promise<void>;
  setListIcon(listId: string, icon: ListIconSpec): Promise<void>;

  createFolder(name: string, color: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  updateFolder(id: string, name: string, color: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  reorderFolders(ids: string[]): Promise<void>;

  updateUser(patch: Partial<Pick<User, 'username' | 'email' | 'avatar_path'>>): Promise<void>;
  pickAvatar(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

let subscribed = false;

export const useDataStore = create<DataState>((set, get) => ({
  ready: false,
  user: null,
  folders: [],
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
    const [user, folders, lists, tasks, records, notifications] = await Promise.all([
      api.get_user(), api.list_folders(), api.list_lists(), api.list_tasks(),
      api.list_focus_records(), api.list_notifications(),
    ]);
    set((s) => ({ user, folders, lists, tasks, records, notifications, revision: s.revision + 1 }));
    await useGrowthStore.getState().reconcile(records);
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
  async toggleTask(id) {
      const before = get().tasks.find((t) => t.id === id);
      await api.toggle_task(id);
      // 重复任务（repeat != none）：完成时按规则推进到下一次（真正重复）。
      // 当前这一轮标完成进「已完成」，再建一个同内容、到期=下一次的新任务。
      if (before && before.completed === 0 && before.repeat !== 'none' && before.due_date) {
        const next = nextOccurrence(
          { date: before.due_date, time: before.due_time ?? null },
          before.repeat,
        );
        if (next) {
          await api.create_task({
            title: before.title,
            notes: before.notes,
            url: before.url,
            listId: before.list_id,
            dueDate: next.date,
            dueTime: next.time,
            urgent: before.urgent,
            repeat: before.repeat,
            leadRemind: before.lead_remind,
            tags: before.tags,
            flag: before.flag,
            priority: before.priority,
            estPomodoros: before.est_pomodoros,
          });
        }
      }
      await get().reload();
    },
  async reorderTasks(ids) { await api.reorder_tasks(ids); await get().reload(); },
  async deleteTask(id) { await api.delete_task(id); await get().reload(); },

  async batchPatch(ids, patch) {
    for (const id of ids) await api.update_task(id, patch);
    await get().reload();
  },
  async batchDelete(ids) {
    for (const id of ids) await api.delete_task(id);
    await get().reload();
  },
  async batchToggle(ids) {
    for (const id of ids) {
      const before = get().tasks.find((t) => t.id === id);
      await api.toggle_task(id);
      // 重复任务（repeat != none）：完成时按规则推进到下一次（真正重复）
      if (before && before.completed === 0 && before.repeat !== 'none' && before.due_date) {
        const next = nextOccurrence({ date: before.due_date, time: before.due_time ?? null }, before.repeat);
        if (next) {
          await api.create_task({
            title: before.title, notes: before.notes, url: before.url, listId: before.list_id,
            dueDate: next.date, dueTime: next.time, urgent: before.urgent, repeat: before.repeat,
            leadRemind: before.lead_remind, tags: before.tags, flag: before.flag,
            priority: before.priority, estPomodoros: before.est_pomodoros,
          });
        }
      }
    }
    await get().reload();
  },

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
  async setListFolder(listId, folderId) { await api.set_list_folder(listId, folderId); await get().reload(); },
  async setListIcon(listId, icon) {
    await api.set_list_icon(listId, icon.icon_type, icon.icon_color, icon.icon_glyph);
    await get().reload();
  },

  async createFolder(name, color) { await api.create_folder({ name, color }); await get().reload(); },
  async renameFolder(id, name) { await api.rename_folder(id, name); await get().reload(); },
  async updateFolder(id, name, color) { await api.update_folder(id, name, color); await get().reload(); },
  async deleteFolder(id) { await api.delete_folder(id); await get().reload(); },
  async reorderFolders(ids) { await api.reorder_folders(ids); await get().reload(); },

  async updateUser(patch) { const user = await api.update_user(patch); set({ user }); },
  async pickAvatar() {
    const path = await api.pick_avatar();
    if (path) await get().updateUser({ avatar_path: path });
  },
  async markRead(id) { await api.mark_notif_read(id); await get().reloadNotifs(); },
  async markAllRead() { await api.mark_all_notifs_read(); await get().reloadNotifs(); },
}));

export const unreadCount = (n: Notification[]) => n.filter((x) => x.read === 0).length;
