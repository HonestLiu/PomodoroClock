// 实体模型 —— 对应 PRD §6.2 表定义

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_path: string;
  created_at: number;
  updated_at: number;
}

/** 自定义清单的图标形态：单色原点 ｜ 字体图标（iconfont/任意 Unicode 字形） */
export type ListIconType = 'dot' | 'font';

/** 清单夹（文件夹）：容纳多个 todo 清单 */
export interface Folder {
  id: string;
  name: string;
  color: string; // 十六进制色值，驱动夹图标与嵌套导引线
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface TaskList {
  id: string;
  name: string;
  sort_order: number;
  is_smart: number; // 1=智能分类，0=用户清单
  icon_type: ListIconType;
  icon_color: string; // 十六进制色值，空则走默认色
  icon_glyph: string; // type=font 时的字形字符（emoji / Unicode 符号）
  folder_id: string | null; // 所属清单夹；null=顶层未归档
  created_at: number;
  updated_at: number;
}

/** 重复规则（提醒事项） */
export type Recurrence = 'none' | 'hourly' | 'daily' | 'weekdays' | 'weekends' | 'weekly';

/** 提前提醒（基于 due_time；无则仅当天日期不触发到时提醒） */
export type LeadRemind = 'none' | '1d' | '2d' | '1w';

/** 优先级：none=未设置（界面隐藏）；低/中/高 */
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  list_id: string | null;
  title: string;
  notes: string;
  est_pomodoros: number;
  due_date: string | null; // 'YYYY-MM-DD'
  due_time: string | null; // 到期时刻 'HH:MM'（24h）
  url: string;
  urgent: number;          // 紧急 0/1
  repeat: Recurrence;
  lead_remind: LeadRemind;
  tags: string[];
  flag: number;            // 旗标 0/1
  priority: TaskPriority;
  reminded_at: number | null; // 到时提醒去重（内部）
  completed: number;       // 0/1
  completed_at: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface FocusRecord {
  id: string;
  task_id: string | null; // 空 = 未指定任务
  list_id: string | null;
  start_at: number;
  end_at: number;
  duration_min: number;
  phase: string;
  created_at: number;
}

export interface Goal {
  id: string;
  daily_target_min: number;
}

export interface Notification {
  id: string;
  type: string; // focus_done / break_done / task_remind
  title: string;
  body: string;
  read: number;
  created_at: number;
}

export type TimerPhase = 'idle' | 'focus' | 'break';
export type TimerMode = 'pomodoro' | 'countdown' | 'stopwatch';

export interface TimerState {
  phase: TimerPhase;
  mode: TimerMode;
  task_id: string | null;
  running: boolean;
  start_at: number | null;
  end_at: number | null; // 计划结束时间戳（绝对时间，PRD §8.8）
  paused_remaining_ms: number | null;
}

export interface Settings {
  focus_len_min: number;
  break_len_min: number;
  long_break_len_min: number;
  long_break_every: number;
  daily_target_min: number;
  auto_start_next: boolean;
  theme: 'light' | 'dark';
  language: 'zh' | 'en';
  autostart: boolean;
  notify_enabled: boolean;
  system_notify: boolean;
  noise: string;
  noise_volume: number;
  noise_on_focus: boolean;
  noise_on_break: boolean;
  wallpaper: string;
  /** 座右铭（个人资料，随配置同步到云端） */
  motto: string;
  /** 启动页：'timer' = 番茄钟展开视图（默认）；其余 = 对应侧边栏页面。设置→通用 可改。 */
  startup_page: StartupPage;
}

export const DEFAULT_SETTINGS: Settings = {
  focus_len_min: 25,
  break_len_min: 5,
  long_break_len_min: 15,
  long_break_every: 4,
  daily_target_min: 180,
  auto_start_next: false,
  theme: 'light',
  language: 'zh',
  autostart: false,
  notify_enabled: true,
  system_notify: true,
  noise: 'waves',
  noise_volume: 0.5,
  noise_on_focus: false,
  noise_on_break: false,
  wallpaper: 'waves',
  motto: '',
  startup_page: 'timer',
};

/** 启动页配置值：'timer' = 番茄钟展开视图，其余为侧边栏页面 */
export type StartupPage = 'timer' | SmartKey | 'calendar';

/** 侧边栏 / 路由使用的分类键
 *  - `completed` = 已完成任务归档（所有 completed=1 的任务）
 *  - `records`   = 专注记录（已完成番茄的归档，原「已完成」视图） */
export type SmartKey = 'today' | 'tomorrow' | 'week' | 'scheduled' | 'completed' | 'records' | 'tasks';

/** 系统内置「任务」清单的 id（种子创建，容纳所有演示任务）。
 *  侧边栏自定义清单区排除它，避免与顶部智能分类「任务」重复。 */
export const ALL_TASKS_LIST_ID = 'list_default';

/** 报表 / 详情页的周期 */
export type Period = 'day' | 'week' | 'month' | 'year';

export interface Stats {
  total_focus_min: number;
  week_focus_min: number;
  today_focus_min: number;
  total_done_tasks: number;
  week_done_tasks: number;
  today_done_tasks: number;
  /** 每日目标日历口径 */
  focus_days: number;
  goal_days: number;
  goal_rate: number;
  daily_target_min: number;
}

export interface GridCell {
  date: string; // 'YYYY-MM-DD'
  hour: number; // 0..23
  minutes: number;
  count: number;
}

export interface TaskDuration {
  task_id: string | null;
  title: string;
  minutes: number;
}

export interface ListDistribution {
  list_id: string | null;
  name: string;
  minutes: number;
  percent: number;
}
