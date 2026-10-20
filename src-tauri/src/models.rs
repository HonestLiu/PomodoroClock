// 实体模型 —— 对应 PRD §6.2 表定义与前端 src/types.ts

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub email: String,
    pub avatar_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskList {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub is_smart: i64,
    /// 自定义清单图标：单色原点 | 字体图标
    pub icon_type: String,
    pub icon_color: String,
    pub icon_glyph: String,
    /// 所属清单夹；None=顶层
    pub folder_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub list_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub est_pomodoros: f64,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub url: String,
    pub urgent: i64,
    pub repeat: String,
    pub lead_remind: String,
    pub tags: Vec<String>,
    pub flag: i64,
    pub priority: String,
    pub reminded_at: Option<i64>,
    pub completed: i64,
    pub completed_at: Option<i64>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusRecord {
    pub id: String,
    pub task_id: Option<String>,
    pub list_id: Option<String>,
    pub start_at: i64,
    pub end_at: i64,
    pub duration_min: i64,
    pub phase: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub daily_target_min: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub body: String,
    pub read: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerPhase {
    Idle,
    Focus,
    Break,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerState {
    pub phase: String,
    pub mode: String,
    pub task_id: Option<String>,
    pub running: bool,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub paused_remaining_ms: Option<i64>,
}

impl Default for TimerState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            mode: "pomodoro".into(),
            task_id: None,
            running: false,
            start_at: None,
            end_at: None,
            paused_remaining_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub focus_len_min: i64,
    pub break_len_min: i64,
    pub long_break_len_min: i64,
    pub long_break_every: i64,
    pub daily_target_min: i64,
    pub auto_start_next: bool,
    pub theme: String,
    pub language: String,
    pub autostart: bool,
    pub notify_enabled: bool,
    pub system_notify: bool,
    pub noise: String,
    pub noise_volume: f64,
    pub noise_on_focus: bool,
    pub noise_on_break: bool,
    pub wallpaper: String,
    /// 座右铭：浏览器侧 Settings 有该键，Rust 侧此前缺字段会把远端配置静默丢弃
    pub motto: String,
    /// 启动页：'timer' = 番茄钟展开视图（默认）；其余为侧边栏页面键
    pub startup_page: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            focus_len_min: 25,
            break_len_min: 5,
            long_break_len_min: 15,
            long_break_every: 4,
            daily_target_min: 180,
            auto_start_next: false,
            theme: "light".into(),
            language: "zh".into(),
            autostart: false,
            notify_enabled: true,
            system_notify: true,
            noise: "waves".into(),
            noise_volume: 0.5,
            noise_on_focus: false,
            noise_on_break: false,
            wallpaper: "waves".into(),
            motto: String::new(),
            startup_page: "timer".into(),
        }
    }
}

// ── 命令入参 ────────────────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksArgs {
    pub list_id: Option<String>,
    pub completed: Option<bool>,
    pub search: Option<String>,
    pub due_from: Option<String>,
    pub due_to: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskArgs {
    pub title: String,
    pub list_id: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub url: Option<String>,
    pub urgent: Option<i64>,
    pub repeat: Option<String>,
    pub lead_remind: Option<String>,
    pub tags: Option<Vec<String>>,
    pub flag: Option<i64>,
    pub priority: Option<String>,
    pub est_pomodoros: Option<f64>,
    pub notes: Option<String>,
}

/// 区分「字段缺席」与「显式 null」：缺席 -> None，null -> Some(None)。
/// serde 默认把 JSON null 解成外层 None，会让「把 list_id / due_date 清空」
/// 在桌面端变成静默无效。
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// 更新补丁：前端 `src/api/types.ts` 的 `UpdateTaskPatch` 用 **snake_case**
/// （list_id / due_date / est_pomodoros / sort_order），此前这里用 camelCase
/// 反序列化，未知键被 serde 忽略，导致这些字段的修改在桌面端全部丢失。
/// 显式接受 snake_case 为主口径，并保留 camelCase 别名兼容旧调用方。
#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    #[serde(default, alias = "listId", deserialize_with = "double_option")]
    pub list_id: Option<Option<String>>,
    #[serde(default, alias = "dueDate", deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, alias = "dueTime", deserialize_with = "double_option")]
    pub due_time: Option<Option<String>>,
    pub url: Option<String>,
    pub urgent: Option<i64>,
    pub repeat: Option<String>,
    pub lead_remind: Option<String>,
    pub tags: Option<Vec<String>>,
    pub flag: Option<i64>,
    pub priority: Option<String>,
    /// 到时提醒去重标记（内部由前端巡检写入）
    pub reminded_at: Option<i64>,
    #[serde(default, alias = "estPomodoros")]
    pub est_pomodoros: Option<f64>,
    pub notes: Option<String>,
    #[serde(default, alias = "sortOrder")]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecordArgs {
    pub task_id: Option<String>,
    pub list_id: Option<String>,
    pub start_at: i64,
    pub end_at: i64,
    pub duration_min: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRecordsArgs {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotificationArgs {
    pub r#type: String,
    pub title: String,
    pub body: String,
}

// ── 统计派生结构（PRD §7.2） ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub total_focus_min: i64,
    pub week_focus_min: i64,
    pub today_focus_min: i64,
    pub total_done_tasks: i64,
    pub week_done_tasks: i64,
    pub today_done_tasks: i64,
    pub focus_days: i64,
    pub goal_days: i64,
    pub goal_rate: i64,
    pub daily_target_min: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GridCell {
    pub date: String,
    pub hour: i64,
    pub minutes: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PomodoroGrid {
    pub dates: Vec<String>,
    pub cells: Vec<GridCell>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDuration {
    pub task_id: Option<String>,
    pub title: String,
    pub minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDurations {
    pub items: Vec<TaskDuration>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListDistributionItem {
    pub list_id: Option<String>,
    pub name: String,
    pub minutes: i64,
    pub percent: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListDistribution {
    pub items: Vec<ListDistributionItem>,
    pub total: i64,
}
