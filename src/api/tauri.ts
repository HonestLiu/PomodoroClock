// Tauri 适配器：把 §8.4 命令面转发到 Rust 侧（src-tauri/src/commands/*）。
// 仅在 Tauri 运行时下被选中（见 src/api/index.ts）。

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Api, AppEvent } from './types';
import { emit } from './events';

/**
 * 变更类命令的统一包装：调用后广播 data://changed，
 * 使侧边栏/报表在两种运行时下走完全相同的刷新路径（PRD §8.8-3）。
 */
async function mutate<T>(table: string, run: () => Promise<T>): Promise<T> {
  const out = await run();
  emit('data://changed', { table });
  return out;
}

export const tauriApi: Api = {
  get_user: () => invoke('get_user'),
  update_user: (patch) => mutate('users', () => invoke('update_user', { patch })),
  pick_avatar: () => invoke('pick_avatar'),

  list_lists: () => invoke('list_lists'),
  reorder_lists: (ids) => mutate('lists', () => invoke('reorder_lists', { ids })),
  get_default_list: () => invoke('get_default_list'),
  set_default_list: (id) => mutate('lists', () => invoke('set_default_list', { id })),
  create_list: (name) => mutate('lists', () => invoke('create_list', { name })),
  rename_list: (id, name) => mutate('lists', () => invoke('rename_list', { id, name })),
  delete_list: (id) => mutate('lists', () => invoke('delete_list', { id })),

  list_tasks: (args = {}) => invoke('list_tasks', { args }),
  create_task: (args) => mutate('tasks', () => invoke('create_task', { args })),
  update_task: (id, patch) => mutate('tasks', () => invoke('update_task', { id, patch })),
  toggle_task: (id) => mutate('tasks', () => invoke('toggle_task', { id })),
  reorder_tasks: (ids) => mutate('tasks', () => invoke('reorder_tasks', { ids })),
  delete_task: (id) => mutate('tasks', () => invoke('delete_task', { id })),

  create_focus_record: (args) => mutate('focus_records', () => invoke('create_focus_record', { args })),
  list_focus_records: (args = {}) => invoke('list_focus_records', { args }),

  get_stats: () => invoke('get_stats'),
  get_pomodoro_grid: (days = 14) => invoke('get_pomodoro_grid', { days }),
  get_task_durations: (period, anchorDate) => invoke('get_task_durations', { period, anchorDate }),
  get_list_distribution: (period, anchorDate) => invoke('get_list_distribution', { period, anchorDate }),

  get_goal: () => invoke('get_goal'),
  set_goal: (minutes) => mutate('goals', () => invoke('set_goal', { minutes })),

  get_timer_state: () => invoke('get_timer_state'),
  // 计时状态高频落盘，不广播（避免每 250ms 触发全量刷新）
  set_timer_state: (state) => invoke('set_timer_state', { state }),

  get_settings: () => invoke('get_settings'),
  set_setting: (key, value) => mutate('settings', () => invoke('set_setting', { key, value })),

  list_notifications: () => invoke('list_notifications'),
  create_notification: (args) => mutate('notifications', () => invoke('create_notification', { args })),
  mark_notif_read: (id) => mutate('notifications', () => invoke('mark_notif_read', { id })),
  mark_all_notifs_read: () => mutate('notifications', () => invoke('mark_all_notifs_read')),

  clear_all_data: () => mutate('all', () => invoke('clear_all_data')),
  logout: () => mutate('all', () => invoke('logout')),
};

/** 订阅 Rust→前端事件（PRD §8.5） */
export function tauriListen(event: AppEvent, handler: (payload: unknown) => void): () => void {
  const pending = listen(event, (e) => handler(e.payload));
  return () => { void pending.then((un) => un()); };
}
