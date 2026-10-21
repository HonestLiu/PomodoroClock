// invoke 接口签名 —— PRD §8.4

import type {
  Countdown, FocusRecord, Folder, Goal, GridCell, LeadRemind, ListDistribution, Notification, Recurrence, Settings,
  Stats, Task, TaskDuration, TaskList, TaskPriority, TimerState, User,
} from '@/types';
import type { CountdownKind, CountdownRepeat } from '@/types';

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
  dueTime?: string | null;
  url?: string;
  urgent?: number;
  repeat?: Recurrence;
  leadRemind?: LeadRemind;
  tags?: string[];
  flag?: number;
  priority?: TaskPriority;
  estPomodoros?: number;
  notes?: string;
  parentId?: string | null;
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
  due_time?: string | null;
  url?: string;
  urgent?: number;
  repeat?: Recurrence;
  lead_remind?: LeadRemind;
  tags?: string[];
  flag?: number;
  priority?: TaskPriority;
  /** 到时提醒去重标记（内部由巡检写入） */
  reminded_at?: number | null;
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

/** 倒数纪念日：创建 / 更新共用（编辑时整体替换，字段齐全） */
export interface CreateCountdownArgs {
  title: string;
  date: string;
  kind: CountdownKind;
  repeat: CountdownRepeat;
  intervalDays?: number | null;
  note?: string;
  color?: string;
  icon?: string;
  pinned?: number;
  remindEnabled?: number;
  remindDays?: number;
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
  /** 把清单归档到清单夹（folderId=null 表示移出到顶层） */
  set_list_folder(list_id: string, folder_id: string | null): Promise<TaskList>;
  /** 编辑清单图标 */
  set_list_icon(list_id: string, icon_type: string, icon_color: string, icon_glyph: string): Promise<TaskList>;

  list_folders(): Promise<Folder[]>;
  create_folder(args: { name: string; color: string }): Promise<Folder>;
  rename_folder(id: string, name: string): Promise<Folder>;
  update_folder(id: string, name: string, color: string): Promise<Folder>;
  delete_folder(id: string): Promise<void>;
  reorder_folders(ids: string[]): Promise<void>;

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

  list_countdowns(): Promise<Countdown[]>;
  create_countdown(args: CreateCountdownArgs): Promise<Countdown>;
  update_countdown(id: string, args: CreateCountdownArgs): Promise<Countdown>;
  delete_countdown(id: string): Promise<void>;
  reorder_countdowns(ids: string[]): Promise<void>;
  /** 提醒去重标记（巡检命中后写入） */
  mark_countdown_reminded(id: string): Promise<void>;

  clear_all_data(): Promise<void>;
  logout(): Promise<void>;
}

/** Rust→前端事件（PRD §8.5）；浏览器运行时下由本地 emitter 承担 */
export type AppEvent = 'timer://tick' | 'timer://state-changed' | 'timer://finished' | 'data://changed' | 'tray://menu' | 'menu://command';
