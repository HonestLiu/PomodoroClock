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

/** AI LLM 提供方（docs/05-modules/ai.md）：none=未配置；claude/openai 走各自 chat API 格式 */
export type AiProvider = 'none' | 'claude' | 'openai';

/** NL 解析出的澄清问题（歧义时不猜，让用户点选） */
export interface AiClarify {
  id: string;
  text: string;
  options: string[];
  default?: number;
}

export type AiFieldKey = 'title' | 'project' | 'due' | 'est' | 'priority' | 'repeat';
/** 每个抽取字段的置信度与原文片段（前端高亮 + 低置信强调） */
export type AiProvenance = Partial<Record<AiFieldKey, { confidence: number; span: [number, number] }>>;

/** NL 解析出的一个任务候选（预览态；adopt 才落库） */
export interface AiTaskCandidate {
  id: string;
  title: string;
  list_id: string | null;       // 项目（已解析为清单 id）
  list_name: string | null;     // 项目（原始名，便于展示/未匹配提示）
  due_date: string | null;      // 'YYYY-MM-DD'
  due_time: string | null;      // 'HH:MM'
  est_min: number | null;       // 预计总耗时（分钟）
  priority: TaskPriority;
  repeat: Recurrence;
  parent_id: string | null;     // 同批内父任务 candidate id（父子关系）
  raw_due: string;              // 截止时间原文（raw_text）
  prov: AiProvenance;
  raw: string;                  // 整句原文
  clarify?: string;             // 需用户先答的澄清问题 id
}

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
  actual_minutes: number | null; // AI 估时校准：累计实际专注分钟
  parent_id: string | null;      // 子任务归属（AI 拆解/NL 建任务）；null=顶层
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

/** 倒数纪念日类型：days_left=还有 N 天 / days_elapsed=已经 N 天 / yearly=每年重复 */
export type CountdownKind = 'days_left' | 'days_elapsed' | 'yearly';
/** 重复规则：once=一次性 / yearly=每年 / monthly=每月 / custom_days=每 N 天 */
export type CountdownRepeat = 'once' | 'yearly' | 'monthly' | 'custom_days';

/** 倒数纪念日（独立于 tasks/focus_records 统计；通过账号配置快照同步） */
export interface Countdown {
  id: string;
  title: string;
  date: string;          // 'YYYY-MM-DD'（本地时区，必填）
  kind: CountdownKind;
  repeat: CountdownRepeat;
  interval_days: number | null; // repeat='custom_days' 时有效
  note: string;
  color: string;         // 图标色（可选，空=>默认）
  icon: string;          // emoji/字形（可选）
  pinned: number;        // 置顶 0/1
  remind_enabled: number;
  remind_days: number;   // 提前 N 天（0=当天）
  reminded_at: number | null; // 本周期已提醒时间去重（内部）
  sort_order: number;
  created_at: number;
  updated_at: number;
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

export type FloatStyle = 'card' | 'orb' | 'bar';

export interface Settings {
  /** 奖励账本 JSON；通过账号配置快照在设备间同步。 */
  growth_data: string;
  focus_len_min: number;
  break_len_min: number;
  long_break_len_min: number;
  long_break_every: number;
  daily_target_min: number;
  auto_start_next: boolean;
  theme: 'system' | 'light' | 'dark';
  language: 'zh' | 'en';
  autostart: boolean;
  notify_enabled: boolean;
  system_notify: boolean;
  noise: string;
  noise_volume: number;
  noise_on_focus: boolean;
  noise_on_break: boolean;
  float_style: FloatStyle;
  wallpaper: string;
  /** 自定义专注背景列表（JSON 字符串，[{name,data}]，见 lib/wallpaper.ts）；随账号配置同步 */
  wallpapers: string;
  /** 座右铭（个人资料，随配置同步到云端） */
  motto: string;
  /** 启动页：'timer' = 番茄钟展开视图（默认）；其余 = 对应侧边栏页面。设置→通用 可改。 */
  startup_page: StartupPage;
  /** AI 配置（docs/05-modules/ai.md）：provider=none 未配置；api_key 仅本地存储、不同步云端 */
  ai_provider: AiProvider;
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  /** 同步服务器（PocketBase）地址。空 = 用编译期默认（VITE_PB_URL → 内置）。仅在本地存、不入库号。
   *  生效路径见 docs/09-sync-server.md；可用 scripts/set-sync-server.mjs 一键写入本机 DB。 */
  pb_url: string;
}

export const DEFAULT_SETTINGS: Settings = {
  growth_data: '',
  focus_len_min: 25,
  break_len_min: 5,
  long_break_len_min: 15,
  long_break_every: 4,
  daily_target_min: 180,
  auto_start_next: false,
  theme: 'system',
  language: 'zh',
  autostart: false,
  notify_enabled: true,
  system_notify: true,
  noise: 'waves',
  noise_volume: 0.5,
  noise_on_focus: false,
  noise_on_break: false,
  float_style: 'card',
  wallpaper: 'waves',
  wallpapers: '[]',
  motto: '',
  startup_page: 'timer',
  ai_provider: 'none',
  ai_base_url: '',
  ai_api_key: '',
  ai_model: '',
  pb_url: '',
};

/** 启动页配置值：'timer' = 番茄钟展开视图，其余为侧边栏页面 */
export type StartupPage = 'timer' | SmartKey | 'calendar' | 'countdown' | 'ai' | 'quests';

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
