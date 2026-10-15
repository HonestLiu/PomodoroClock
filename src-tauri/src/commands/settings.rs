// 设置 KV 与计时状态持久化 —— PRD §8.4 / §8.6 / §8.8-1

use rusqlite::params;
use tauri::State;

use crate::db::{load_settings, load_timer_state, Db};
use crate::error::AppResult;
use crate::models::{Settings, TimerState};

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> AppResult<Settings> {
    let conn = db.0.lock();
    load_settings(&conn)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> AppResult<Settings> {
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    // 每日目标同步写入 goals 表，保证报表日历口径一致（PRD §7.2）
    if key == "daily_target_min" {
        if let Ok(min) = value.parse::<i64>() {
            conn.execute(
                "INSERT INTO goals (id, daily_target_min) VALUES ('default', ?1)
                 ON CONFLICT(id) DO UPDATE SET daily_target_min = excluded.daily_target_min",
                params![min],
            )?;
        }
    }
    load_settings(&conn)
}

#[tauri::command]
pub fn get_timer_state(db: State<'_, Db>) -> AppResult<TimerState> {
    let conn = db.0.lock();
    load_timer_state(&conn)
}

/// 计时状态落盘：基于绝对时间戳（end_at），重启后可恢复（PRD §8.8-1）
#[tauri::command]
pub fn set_timer_state(db: State<'_, Db>, state: TimerState) -> AppResult<TimerState> {
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO timer_state (id, phase, mode, task_id, running, start_at, end_at, paused_remaining_ms)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           phase = excluded.phase, mode = excluded.mode, task_id = excluded.task_id,
           running = excluded.running, start_at = excluded.start_at,
           end_at = excluded.end_at, paused_remaining_ms = excluded.paused_remaining_ms",
        params![
            state.phase,
            state.mode,
            state.task_id,
            if state.running { 1 } else { 0 },
            state.start_at,
            state.end_at,
            state.paused_remaining_ms
        ],
    )?;
    load_timer_state(&conn)
}
