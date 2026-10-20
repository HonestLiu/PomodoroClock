// 专注记录命令 —— PRD §8.4 / FR-P5

use rusqlite::{params, params_from_iter, types::Value};
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};

/// 外键列空串 → None（同步层会把 NULL 拉成 ""，见 db::repair_empty_refs）
fn blank(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

use crate::models::{CreateRecordArgs, FocusRecord, ListRecordsArgs};

const COLS: &str = "id, task_id, list_id, start_at, end_at, duration_min, phase, created_at";

fn row_to_record(r: &rusqlite::Row) -> rusqlite::Result<FocusRecord> {
    Ok(FocusRecord {
        id: r.get(0)?,
        task_id: blank(r.get(1)?),
        list_id: blank(r.get(2)?),
        start_at: r.get(3)?,
        end_at: r.get(4)?,
        duration_min: r.get(5)?,
        phase: r.get(6)?,
        created_at: r.get(7)?,
    })
}

/// 番茄完成归档（PRD §7.1：FOCUS 倒计时结束写入一条记录）
#[tauri::command]
pub fn create_focus_record(db: State<'_, Db>, args: CreateRecordArgs) -> AppResult<FocusRecord> {
    let conn = db.0.lock();
    create_focus_record_impl(&conn, args)
}

pub fn create_focus_record_impl(conn: &rusqlite::Connection, args: CreateRecordArgs) -> AppResult<FocusRecord> {
    if args.end_at < args.start_at {
        return Err(AppError::msg("结束时间早于开始时间"));
    }
    let now = crate::db_now();
    let id = new_id("fr");

    // list_id 冗余，便于报表按清单聚合（PRD §6.2）
    let list_id = match args.list_id {
        Some(l) => Some(l),
        None => match &args.task_id {
            Some(t) => conn
                .query_row("SELECT list_id FROM tasks WHERE id = ?1", params![t], |r| {
                    r.get::<_, Option<String>>(0)
                })
                .ok()
                .flatten(),
            None => None,
        },
    };

    conn.execute(
        "INSERT INTO focus_records (id, task_id, list_id, start_at, end_at, duration_min, phase, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'focus', ?7)",
        params![id, args.task_id, list_id, args.start_at, args.end_at, args.duration_min, now],
    )?;

    conn.query_row(
        &format!("SELECT {COLS} FROM focus_records WHERE id = ?1"),
        params![id],
        row_to_record,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn list_focus_records(
    db: State<'_, Db>,
    args: Option<ListRecordsArgs>,
) -> AppResult<Vec<FocusRecord>> {
    let conn = db.0.lock();
    let a = args.unwrap_or_default();
    let mut sql = format!("SELECT {COLS} FROM focus_records WHERE 1=1");
    let mut binds: Vec<Value> = Vec::new();

    if let Some(from) = a.from {
        sql.push_str(" AND start_at >= ?");
        binds.push(Value::Integer(from));
    }
    if let Some(to) = a.to {
        sql.push_str(" AND start_at <= ?");
        binds.push(Value::Integer(to));
    }
    if let Some(t) = a.task_id {
        sql.push_str(" AND task_id = ?");
        binds.push(Value::Text(t));
    }
    sql.push_str(" ORDER BY start_at");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(binds), row_to_record)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
