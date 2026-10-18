// invoke 接口签名 —— PRD §8.4

import type {
  FocusRecord, Goal, GridCell, ListDistribution, Notification, Settings, Stats,
  Task, TaskDuration, TaskList, TimerState, User,
} from '@/types';

export interface ListTasksArgs {
  listId?: string | null;
  completed?: boolean;
  search?: string;
  dueFrom?: string;
  dueTo?: string;
}

export interface CreateTaskArgs {
  title: string;
  listId?: string | null;
  dueDate?: string | null;
  estPomodoros?: number;
  notes?: string;
}

/** 建清单入参：图标可省略（省略则用默认单色原点） */
export interface CreateListArgs {
  name: string;
  iconType?: 'dot' | 'font';
  iconColor?: string;
  iconGlyph?: string;
}

export interface UpdateTaskPatch {
  title?: string;
  list_id?: string | null;
  due_date?: string | null;
  est_pomodoros?: number;
  notes?: string;
  sort_order?: number;
}

export interface CreateRecordArgs {
  taskId?: string | null;
  listId?: string | null;
  startAt: number;
  endAt: number;
  durationMin: number;
}

/** 全部命令的前端调用面 */
export interface Api {
  get_user(): Promise<User>;
  update_user(patch: Partial<Pick<User, 'username' | 'email' | 'avatar_path'>>): Promise<User>;
  pick_avatar(): Promise<string | null>;

  list_lists(): Promise<TaskList[]>;
  /** 按新顺序整体重排清单（ids 为完整有序清单 id 列表） */
  reorder_lists(ids: string[]): Promise<void>;
  get_default_list(): Promise<string | null>;
  set_default_list(id: string | null): Promise<void>;
  create_list(args: CreateListArgs): Promise<TaskList>;
  rename_list(id: string, name: string): Promise<TaskList>;
  delete_list(id: string): Promise<void>;

  list_tasks(args?: ListTasksArgs): Promise<Task[]>;
  create_task(args: CreateTaskArgs): Promise<Task>;
  update_task(id: string, patch: UpdateTaskPatch): Promise<Task>;
  toggle_task(id: string): Promise<Task>;
  /** 按新顺序整体重排任务 sort_order（tasks.md ★2 拖拽排序） */
  reorder_tasks(ids: string[]): Promise<void>;
  delete_task(id: string): Promise<void>;

  create_focus_record(args: CreateRecordArgs): Promise<FocusRecord>;
  list_focus_records(args?: { from?: number; to?: number; taskId?: string }): Promise<FocusRecord[]>;

  get_stats(): Promise<Stats>;
  get_pomodoro_grid(days?: number): Promise<{ dates: string[]; cells: GridCell[] }>;
  /** anchorDate 为本地日期键 'YYYY-MM-DD'（PRD §7.3 以本地时区为准） */
  get_task_durations(period: string, anchorDate: string): Promise<{ items: TaskDuration[]; total: number }>;
  get_list_distribution(period: string, anchorDate: string): Promise<{ items: ListDistribution[]; total: number }>;

  get_goal(): Promise<Goal>;
  set_goal(minutes: number): Promise<Goal>;

  get_timer_state(): Promise<TimerState>;
  set_timer_state(state: TimerState): Promise<TimerState>;
  update_tray_title(text: string): Promise<void>;
  update_tray_toggle(text: string): Promise<void>;
  set_tray_phase(phase: string): Promise<void>;

  get_settings(): Promise<Settings>;
  set_setting(key: string, value: string): Promise<Settings>;

  list_notifications(): Promise<Notification[]>;
  create_notification(args: { type: string; title: string; body: string }): Promise<Notification>;
  mark_notif_read(id: string): Promise<void>;
  mark_all_notifs_read(): Promise<void>;

  clear_all_data(): Promise<void>;
  logout(): Promise<void>;
}

/** Rust→前端事件（PRD §8.5）；浏览器运行时下由本地 emitter 承担 */
export type AppEvent = 'timer://tick' | 'timer://state-changed' | 'timer://finished' | 'data://changed' | 'tray://menu';
