// Rust 命令层 —— PRD §8.4 invoke 接口清单

pub mod countdown;
pub mod folders;
pub mod lists;
pub mod notify;
pub mod records;
pub mod quests;
pub mod settings;
pub mod stats;
pub mod sync;
pub mod tasks;
pub mod tray;
pub mod user;

use crate::error::AppError;

/// 所有 invoke 参数的类型校验入口（PRD §8.8-6）
pub fn require_non_empty(field: &str, v: &str) -> Result<(), AppError> {
    if v.trim().is_empty() {
        return Err(AppError::msg(format!("{field} 不能为空")));
    }
    Ok(())
}

// SQL 时间表达式（本地时区，PRD §7.3）
pub const TODAY_START_MS: &str =
    "strftime('%s', date('now','localtime') || ' 00:00:00', 'utc') * 1000";
pub const TODAY_END_MS: &str =
    "strftime('%s', date('now','localtime') || ' 23:59:59', 'utc') * 1000";
/// 本周一 00:00 —— '-6 days' 后取下一个周一，避免当天即周一时回退一周
pub const WEEK_START_MS: &str =
    "strftime('%s', date('now','localtime','-6 days','weekday 1') || ' 00:00:00', 'utc') * 1000";
