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

export interface Task {
  id: string;
  list_id: string | null;
  title: string;
  notes: string;
  est_pomodoros: number; // 预估番茄数（7.8）
  due_date: string | null; // 'YYYY-MM-DD'
  completed: number; // 0/1
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
};

/** 侧边栏 / 路由使用的分类键 */
export type SmartKey = 'today' | 'tomorrow' | 'week' | 'scheduled' | 'completed' | 'tasks';

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
