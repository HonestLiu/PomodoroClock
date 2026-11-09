// 倒数纪念日命令 —— 独立于任务的数据域（docs/05-modules/countdown.md）
// 保存在本地表，由账号配置快照负责跨设备同步。

use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::{Countdown, CreateCountdownArgs};

const COLS: &str = "id, title, date, kind, repeat, interval_days, note, color, icon, pinned, \
                    remind_enabled, remind_days, reminded_at, sort_order, created_at, updated_at";

fn row_to_cd(r: &rusqlite::Row<'_>) -> rusqlite::Result<Countdown> {
    Ok(Countdown {
        id: r.get(0)?,
        title: r.get(1)?,
        date: r.get(2)?,
        kind: r.get(3)?,
        repeat: r.get(4)?,
        interval_days: r.get(5)?,
        note: r.get(6)?,
        color: r.get(7)?,
        icon: r.get(8)?,
        pinned: r.get(9)?,
        remind_enabled: r.get(10)?,
        remind_days: r.get(11)?,
        reminded_at: r.get(12)?,
        sort_order: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

fn validate(title: &str, date: &str, kind: &str, repeat: &str, interval_days: Option<i64>) -> AppResult<()> {
    super::require_non_empty("纪念日名称", title)?;
    super::require_non_empty("日期", date)?;
    if !matches!(kind, "days_left" | "days_elapsed" | "yearly") {
        return Err(AppError::msg("未知类型"));
    }
    if !matches!(repeat, "once" | "yearly" | "monthly" | "custom_days") {
        return Err(AppError::msg("未知重复规则"));
    }
    if repeat == "custom_days" && interval_days.map(|d| d < 1).unwrap_or(true) {
        return Err(AppError::msg("自定义间隔须 >= 1 天"));
    }
    // 严格校验 YYYY-MM-DD
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[2].len() != 2
        || parts.iter().any(|p| !p.chars().all(|c| c.is_ascii_digit()))
    {
        return Err(AppError::msg("日期格式须为 YYYY-MM-DD"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_countdowns(db: State<'_, Db>) -> AppResult<Vec<Countdown>> {
    let conn = db.0.lock();
    list_countdowns_impl(&conn)
}

pub fn list_countdowns_impl(conn: &rusqlite::Connection) -> AppResult<Vec<Countdown>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM countdowns ORDER BY sort_order, created_at"
    ))?;
    let rows = stmt.query_map([], row_to_cd)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn replace_countdowns(db: State<'_, Db>, items: Vec<Countdown>) -> AppResult<()> {
    if items.len() > 5000 { return Err(AppError::msg("倒数纪念日数量超限")); }
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM countdowns", [])?;
    for c in items {
        validate(&c.title, &c.date, &c.kind, &c.repeat, c.interval_days)?;
        tx.execute("INSERT INTO countdowns (id,title,date,kind,repeat,interval_days,note,color,icon,pinned,remind_enabled,remind_days,reminded_at,sort_order,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![c.id,c.title,c.date,c.kind,c.repeat,c.interval_days,c.note,c.color,c.icon,c.pinned,c.remind_enabled,c.remind_days,c.reminded_at,c.sort_order,c.created_at,c.updated_at])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn create_countdown(db: State<'_, Db>, args: CreateCountdownArgs) -> AppResult<Countdown> {
    let conn = db.0.lock();
    create_countdown_impl(&conn, args)
}

/// 供测试与命令层共用
pub fn create_countdown_impl(conn: &rusqlite::Connection, args: CreateCountdownArgs) -> AppResult<Countdown> {
    validate(&args.title, &args.date, &args.kind, &args.repeat, args.interval_days)?;
    let now = crate::db_now();
    let id = new_id("cd");
    let order: i64 = conn.query_row("SELECT COUNT(*) FROM countdowns", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO countdowns (id, title, date, kind, repeat, interval_days, note, color, icon, \
         pinned, remind_enabled, remind_days, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
        params![
            id,
            args.title.trim(),
            args.date,
            args.kind,
            args.repeat,
            args.interval_days,
            args.note.unwrap_or_default(),
            args.color.unwrap_or_default(),
            args.icon.unwrap_or_default(),
            args.pinned,
            args.remind_enabled,
            args.remind_days,
            order,
            now,
        ],
    )?;
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM countdowns WHERE id = ?1"))?;
    Ok(stmt.query_row(params![id], row_to_cd)?)
}

#[tauri::command]
pub fn update_countdown(db: State<'_, Db>, id: String, args: CreateCountdownArgs) -> AppResult<Countdown> {
    let conn = db.0.lock();
    update_countdown_impl(&conn, id, args)
}

/// 供测试与命令层共用：改日期/提前天数/开关任一变化即重新武装提醒（reminded_at -> NULL）
pub fn update_countdown_impl(conn: &rusqlite::Connection, id: String, args: CreateCountdownArgs) -> AppResult<Countdown> {
    validate(&args.title, &args.date, &args.kind, &args.repeat, args.interval_days)?;
    // 提醒去重键：日期 / 提前天数 / 开关任一变化即重新武装（reminded_at -> NULL）
    let old: Option<(String, i64, i64)> = conn
        .query_row(
            "SELECT date, remind_days, remind_enabled FROM countdowns WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let rearm = match &old {
        Some((od, or_days, or_on)) => {
            od != &args.date || *or_days != args.remind_days || (*or_on != 0) != (args.remind_enabled != 0)
        }
        None => true,
    };
    let n = conn.execute(
        "UPDATE countdowns SET title=?2, date=?3, kind=?4, repeat=?5, interval_days=?6, note=?7, \
         color=?8, icon=?9, pinned=?10, remind_enabled=?11, remind_days=?12, \
         reminded_at=CASE WHEN ?13 THEN NULL ELSE reminded_at END, updated_at=?14 WHERE id=?1",
        params![
            id,
            args.title.trim(),
            args.date,
            args.kind,
            args.repeat,
            args.interval_days,
            args.note.unwrap_or_default(),
            args.color.unwrap_or_default(),
            args.icon.unwrap_or_default(),
            args.pinned,
            args.remind_enabled,
            args.remind_days,
            rearm,
            crate::db_now(),
        ],
    )?;
    if n == 0 {
        return Err(AppError::msg("纪念日不存在"));
    }
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM countdowns WHERE id = ?1"))?;
    Ok(stmt.query_row(params![id], row_to_cd)?)
}

#[tauri::command]
pub fn delete_countdown(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    delete_countdown_impl(&conn, id)
}

pub fn delete_countdown_impl(conn: &rusqlite::Connection, id: String) -> AppResult<()> {
    conn.execute("DELETE FROM countdowns WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn reorder_countdowns(db: State<'_, Db>, ids: Vec<String>) -> AppResult<()> {
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE countdowns SET sort_order = ?1 WHERE id = ?2",
            params![i as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 提醒落地用：把某条纪念日的 reminded_at 置为当前时间（去重标记）
#[tauri::command]
pub fn mark_countdown_reminded(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE countdowns SET reminded_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, crate::db_now()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn args(title: &str, date: &str, kind: &str, repeat: &str) -> CreateCountdownArgs {
        CreateCountdownArgs {
            title: title.into(),
            date: date.into(),
            kind: kind.into(),
            repeat: repeat.into(),
            interval_days: if repeat == "custom_days" { Some(7) } else { None },
            note: Some("n".into()),
            color: Some("#4A7DE0".into()),
            icon: Some("🎂".into()),
            pinned: 0,
            remind_enabled: 1,
            remind_days: 1,
        }
    }

    impl CreateCountdownArgs {
        fn with_repeat(mut self, r: &str) -> Self { self.repeat = r.into(); self }
        fn no_interval(mut self) -> Self { self.interval_days = None; self }
    }

    #[test]
    fn create_and_list_round_trip() {
        let conn = open_in_memory().unwrap();
        let c = create_countdown_impl(&conn, args("生日", "2026-12-31", "days_left", "once")).unwrap();
        assert_eq!(c.title, "生日");
        assert_eq!(c.date, "2026-12-31");
        assert_eq!(c.kind, "days_left");
        assert_eq!(c.pinned, 0);
        assert_eq!(c.remind_enabled, 1);
        assert_eq!(c.remind_days, 1);
        assert_eq!(c.interval_days, None);
        assert!(c.reminded_at.is_none());
        let all = list_countdowns_impl(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, c.id);
    }

    #[test]
    fn update_rearms_reminder_when_date_changes() {
        let conn = open_in_memory().unwrap();
        let c = create_countdown_impl(&conn, args("纪念日", "2026-11-01", "days_left", "once")).unwrap();
        // 模拟提醒已去重
        conn.execute(
            "UPDATE countdowns SET reminded_at = 99 WHERE id = ?1",
            params![c.id],
        )
        .unwrap();
        // 未改日期/提前天数/开关 → 保留 reminded_at
        let same = update_countdown_impl(&conn, c.id.clone(), args("纪念日", "2026-11-01", "days_left", "once")).unwrap();
        assert_eq!(same.reminded_at, Some(99));
        // 改日期 → 重新武装
        let moved = update_countdown_impl(&conn, c.id.clone(), args("纪念日", "2026-11-02", "days_left", "once")).unwrap();
        assert!(moved.reminded_at.is_none());
    }

    #[test]
    fn validate_rejects_bad_date_and_interval() {
        let conn = open_in_memory().unwrap();
        assert!(create_countdown_impl(&conn, args("x", "2026-1-1", "days_left", "once")).is_err());
        assert!(create_countdown_impl(&conn, args("x", "2026-01-01", "nope", "once")).is_err());
        // custom_days 缺 interval_days（None）→ 拒绝
        assert!(create_countdown_impl(&conn, args("x", "2026-01-01", "days_left", "once").with_repeat("custom_days").no_interval()).is_err());
        // custom_days 带合法间隔 → 通过
        assert!(create_countdown_impl(&conn, args("x", "2026-01-01", "days_left", "custom_days")).is_ok());
    }

    #[test]
    fn delete_removes_row() {
        let conn = open_in_memory().unwrap();
        let c = create_countdown_impl(&conn, args("a", "2026-01-01", "yearly", "yearly")).unwrap();
        assert_eq!(c.kind, "yearly");
        delete_countdown_impl(&conn, c.id).unwrap();
        assert!(list_countdowns_impl(&conn).unwrap().is_empty());
    }
}
