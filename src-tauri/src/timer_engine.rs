// 计时引擎 —— PRD §7.1 状态机 / §8.5 事件 / §8.8-1 计时可靠性
//
// 约定：剩余时间一律由绝对时间戳推导（remaining = end_at - now），Rust 侧每
// 250ms 广播一次 `timer://tick` 作为权威时钟源；阶段切换（写 focus_record、
// 进入休息）由前端状态机统一执行，保证单一属主、不重复归档。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::load_timer_state;
use crate::models::{Settings, TimerPhase, TimerState};

#[derive(Debug, Clone, Serialize)]
pub struct TickPayload {
    pub phase: String,
    pub running: bool,
    pub remaining_ms: i64,
    pub end_at: Option<i64>,
}

/// 阶段时长（毫秒）—— mode=stopwatch 时为 0（正计时）
pub fn phase_duration_ms(
    phase: &TimerPhase,
    mode: &str,
    settings: &Settings,
    completed_pomodoros: i64,
) -> i64 {
    if mode == "stopwatch" {
        return 0;
    }
    match phase {
        TimerPhase::Focus => settings.focus_len_min * 60_000,
        TimerPhase::Break => {
            let every = settings.long_break_every;
            let is_long = every > 0 && completed_pomodoros > 0 && completed_pomodoros % every == 0;
            if is_long {
                settings.long_break_len_min * 60_000
            } else {
                settings.break_len_min * 60_000
            }
        }
        TimerPhase::Idle => settings.focus_len_min * 60_000,
    }
}

/// 当前剩余毫秒
pub fn remaining_ms(state: &TimerState, now: i64) -> i64 {
    if state.mode == "stopwatch" {
        // 正计时：running 时返回「已用时长」，暂停/未开始时返回冻结值
        // （原先暂停直接返回 0，会让菜单栏倒计时归零，与前端 displayMs 不一致）
        return match (state.running, state.start_at) {
            (true, Some(s)) => (now - s).max(0),
            _ => state.paused_remaining_ms.unwrap_or(0),
        };
    }
    if state.running {
        if let Some(end) = state.end_at {
            return (end - now).max(0);
        }
    }
    state.paused_remaining_ms.unwrap_or(0)
}

/// 是否已到期
pub fn is_expired(state: &TimerState, now: i64) -> bool {
    state.running && state.mode != "stopwatch" && matches!(state.end_at, Some(e) if now >= e)
}

/// 启动 `timer://tick` 广播线程（PRD §8.5）
pub fn spawn_ticker(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let payload = {
            let db = match app.try_state::<crate::db::Db>() {
                Some(db) => db,
                None => continue,
            };
            let conn = db.0.lock();
            match load_timer_state(&conn) {
                Ok(state) => {
                    let now = crate::db_now();
                    TickPayload {
                        phase: state.phase.clone(),
                        running: state.running,
                        remaining_ms: remaining_ms(&state, now),
                        end_at: state.end_at,
                    }
                }
                Err(_) => continue,
            }
        };
        let _ = app.emit("timer://tick", payload);
    });
}
