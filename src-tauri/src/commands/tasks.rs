// 任务命令 —— PRD §8.4 / FR-T1…FR-T4

use rusqlite::{params, params_from_iter, types::Value};
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::{CreateTaskArgs, ListTasksArgs, Task, UpdateTaskPatch};

const TASK_COLS: &str =
    "id, list_id, title, notes, est_pomodoros, due_date, completed, completed_at, sort_order, created_at, updated_at";

fn row_to_task(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        list_id: r.get(1)?,
        title: r.get(2)?,
        notes: r.get(3)?,
        est_pomodoros: r.get(4)?,
        due_date: r.get(5)?,
        completed: r.get(6)?,
        completed_at: r.get(7)?,
        sort_order: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

fn read_task(conn: &rusqlite::Connection, id: &str) -> AppResult<Task> {
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
        params![id],
        row_to_task,
    )
    .map_err(|_| AppError::msg("任务不存在"))
}

#[tauri::command]
pub fn list_tasks(db: State<'_, Db>, args: Option<ListTasksArgs>) -> AppResult<Vec<Task>> {
    let conn = db.0.lock();
    list_tasks_impl(&conn, args)
}

/// 可测试的查询实现：与浏览器侧 local.ts list_tasks 使用同一套过滤组合。
pub fn list_tasks_impl(
    conn: &rusqlite::Connection,
    args: Option<ListTasksArgs>,
) -> AppResult<Vec<Task>> {
    let a = args.unwrap_or_default();

    let mut sql = format!("SELECT {TASK_COLS} FROM tasks WHERE 1=1");
    let mut binds: Vec<Value> = Vec::new();

    if let Some(list_id) = a.list_id {
        sql.push_str(" AND list_id = ?");
        binds.push(Value::Text(list_id));
        // 与浏览器侧 tasksInList(listId) 对齐：只看清单、未显式指定 completed 时
        // 默认只返回未完成任务（已完成的靠 completed=true 或「已完成」视图取）。
        if a.completed.is_none() {
            sql.push_str(" AND completed = 0");
        }
    }
    if let Some(done) = a.completed {
        sql.push_str(" AND completed = ?");
        binds.push(Value::Integer(if done { 1 } else { 0 }));
    }
    if let Some(q) = a.search {
        // 转义 LIKE 通配符，让搜索按字面量匹配（与浏览器侧 includes 一致）
        let needle = q
            .trim()
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        sql.push_str(" AND lower(title) LIKE ? ESCAPE '\\'");
        binds.push(Value::Text(format!("%{needle}%")));
    }
    if let Some(from) = a.due_from {
        sql.push_str(" AND due_date IS NOT NULL AND due_date >= ?");
        binds.push(Value::Text(from));
    }
    if let Some(to) = a.due_to {
        sql.push_str(" AND due_date IS NOT NULL AND due_date <= ?");
        binds.push(Value::Text(to));
    }
    sql.push_str(" ORDER BY sort_order, created_at");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(binds), row_to_task)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn create_task(db: State<'_, Db>, args: CreateTaskArgs) -> AppResult<Task> {
    let conn = db.0.lock();
    create_task_impl(&conn, args)
}

pub fn create_task_impl(conn: &rusqlite::Connection, args: CreateTaskArgs) -> AppResult<Task> {
    super::require_non_empty("任务名称", &args.title)?;
    let now = crate::db_now();
    let id = new_id("task");

    // P1：未指定清单时优先用默认清单（default_list_id 设置），否则按序取第一个
    let list_id = match args.list_id {
        Some(l) => Some(l),
        None => {
            let def: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key='default_list_id'",
                    [],
                    |r| r.get(0),
                )
                .ok();
            match def {
                Some(d) if conn
                    .query_row("SELECT 1 FROM lists WHERE id = ?1", params![d], |_| Ok(()))
                    .is_ok() => Some(d),
                _ => conn
                    .query_row("SELECT id FROM lists ORDER BY sort_order LIMIT 1", [], |r| {
                        r.get::<_, String>(0)
                    })
                    .ok(),
            }
        }
    };

    let order: i64 = match &list_id {
        Some(l) => conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE list_id = ?1",
            params![l],
            |r| r.get(0),
        )?,
        // 未指定清单时只统计「未指定清单」分组，与浏览器侧
        // d.tasks.filter(x => x.list_id === listId).length 对齐。
        None => conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE list_id IS NULL",
            [],
            |r| r.get(0),
        )?,
    };

    conn.execute(
        "INSERT INTO tasks (id, list_id, title, notes, est_pomodoros, due_date, completed, completed_at, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, NULL, ?7, ?8, ?8)",
        params![
            id,
            list_id,
            args.title.trim(),
            args.notes.unwrap_or_default(),
            args.est_pomodoros.unwrap_or(0.0),
            args.due_date,
            order,
            now
        ],
    )?;
    read_task(&conn, &id)
}

#[tauri::command]
pub fn update_task(db: State<'_, Db>, id: String, patch: UpdateTaskPatch) -> AppResult<Task> {
    let conn = db.0.lock();
    update_task_impl(&conn, &id, patch)
}

pub fn update_task_impl(
    conn: &rusqlite::Connection,
    id: &str,
    patch: UpdateTaskPatch,
) -> AppResult<Task> {
    if let Some(t) = &patch.title {
        super::require_non_empty("任务名称", t)?;
    }
    let now = crate::db_now();

    if let Some(v) = patch.title {
        conn.execute("UPDATE tasks SET title = ?1 WHERE id = ?2", params![v.trim(), id])?;
    }
    if let Some(v) = patch.list_id {
        conn.execute("UPDATE tasks SET list_id = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = patch.due_date {
        conn.execute("UPDATE tasks SET due_date = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = patch.est_pomodoros {
        conn.execute("UPDATE tasks SET est_pomodoros = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = patch.notes {
        conn.execute("UPDATE tasks SET notes = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = patch.sort_order {
        conn.execute("UPDATE tasks SET sort_order = ?1 WHERE id = ?2", params![v, id])?;
    }
    conn.execute("UPDATE tasks SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
    read_task(conn, id)
}

/// 完成/未完成切换，写入 completed_at（PRD FR-T3）
#[tauri::command]
pub fn toggle_task(db: State<'_, Db>, id: String) -> AppResult<Task> {
    let conn = db.0.lock();
    toggle_task_impl(&conn, &id)
}

pub fn toggle_task_impl(conn: &rusqlite::Connection, id: &str) -> AppResult<Task> {
    let now = crate::db_now();
    let cur: i64 = conn
        .query_row("SELECT completed FROM tasks WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(|_| AppError::msg("任务不存在"))?;
    let next = if cur == 1 { 0 } else { 1 };
    conn.execute(
        "UPDATE tasks SET completed = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![next, if next == 1 { Some(now) } else { None }, now, id],
    )?;
    read_task(&conn, &id)
}

#[tauri::command]
pub fn reorder_tasks(db: State<'_, Db>, ids: Vec<String>) -> AppResult<()> {
    let conn = db.0.lock();
    reorder_tasks_impl(&conn, &ids)
}

pub fn reorder_tasks_impl(conn: &rusqlite::Connection, ids: &[String]) -> AppResult<()> {
    // 与浏览器侧重排一致：只改 sort_order，不刷新 updated_at（不是内容修改）。
    let mut stmt = conn.prepare("UPDATE tasks SET sort_order = ?1 WHERE id = ?2")?;
    for (i, id) in ids.iter().enumerate() {
        stmt.execute(params![i as i64, id])?;
    }
    Ok(())
}

/// 删除任务：关联记录 task_id 置空（PRD §6.2 ON DELETE SET NULL）
#[tauri::command]
pub fn delete_task(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    delete_task_impl(&conn, &id)
}

pub fn delete_task_impl(conn: &rusqlite::Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE focus_records SET task_id = NULL WHERE task_id = ?1", params![id])?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}
