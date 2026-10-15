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
pub struct TaskList {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub is_smart: i64,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskArgs {
    pub title: String,
    pub list_id: Option<String>,
    pub due_date: Option<String>,
    pub est_pomodoros: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    pub list_id: Option<Option<String>>,
    pub due_date: Option<Option<String>>,
    pub est_pomodoros: Option<f64>,
    pub notes: Option<String>,
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
