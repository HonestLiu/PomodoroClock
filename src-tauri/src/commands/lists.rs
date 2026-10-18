// 清单命令 —— PRD §8.4 / FR-S3「清单管理」

use rusqlite::params;
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::TaskList;

fn read_list(conn: &rusqlite::Connection, id: &str) -> AppResult<TaskList> {
    conn.query_row(
        "SELECT id, name, sort_order, is_smart, icon_type, icon_color, icon_glyph, folder_id, created_at, updated_at
         FROM lists WHERE id = ?1",
        params![id],
        |r| {
            Ok(TaskList {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
                is_smart: r.get(3)?,
                icon_type: r.get(4)?,
                icon_color: r.get(5)?,
                icon_glyph: r.get(6)?,
                folder_id: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        },
    )
    .map_err(|_| AppError::msg("清单不存在"))
}

#[tauri::command]
pub fn list_lists(db: State<'_, Db>) -> AppResult<Vec<TaskList>> {
    let conn = db.0.lock();
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order, is_smart, icon_type, icon_color, icon_glyph, folder_id, created_at, updated_at
         FROM lists ORDER BY sort_order, created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TaskList {
            id: r.get(0)?,
            name: r.get(1)?,
            sort_order: r.get(2)?,
            is_smart: r.get(3)?,
            icon_type: r.get(4)?,
            icon_color: r.get(5)?,
            icon_glyph: r.get(6)?,
            folder_id: r.get(7)?,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn create_list(
    db: State<'_, Db>,
    name: String,
    icon_type: Option<String>,
    icon_color: Option<String>,
    icon_glyph: Option<String>,
) -> AppResult<TaskList> {
    super::require_non_empty("清单名称", &name)?;
    let conn = db.0.lock();
    let now = crate::db_now();
    let id = new_id("list");
    let order: i64 = conn.query_row("SELECT COUNT(*) FROM lists", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO lists (id, name, sort_order, is_smart, icon_type, icon_color, icon_glyph, folder_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, NULL, ?7, ?7)",
        params![
            id,
            name.trim(),
            order,
            icon_type.as_deref().unwrap_or("dot"),
            icon_color.as_deref().unwrap_or(""),
            icon_glyph.as_deref().unwrap_or(""),
            now
        ],
    )?;
    read_list(&conn, &id)
}

/// 把清单归档到清单夹（folderId=None 表示移出到顶层）
#[tauri::command]
pub fn set_list_folder(
    db: State<'_, Db>,
    list_id: String,
    folder_id: Option<String>,
) -> AppResult<TaskList> {
    let conn = db.0.lock();
    if let Some(fid) = &folder_id {
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1)", params![fid], |r| r.get(0))
            .unwrap_or(false);
        if !exists { return Err(AppError::msg("清单夹不存在")); }
    }
    conn.execute(
        "UPDATE lists SET folder_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![folder_id, crate::db_now(), list_id],
    )?;
    read_list(&conn, &list_id)
}

/// 编辑清单图标（单色原点 / 字体图标）
#[tauri::command]
pub fn set_list_icon(
    db: State<'_, Db>,
    list_id: String,
    icon_type: String,
    icon_color: String,
    icon_glyph: String,
) -> AppResult<TaskList> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE lists SET icon_type = ?1, icon_color = ?2, icon_glyph = ?3, updated_at = ?4 WHERE id = ?5",
        params![icon_type, icon_color, icon_glyph, crate::db_now(), list_id],
    )?;
    read_list(&conn, &list_id)
}

#[tauri::command]
pub fn rename_list(db: State<'_, Db>, id: String, name: String) -> AppResult<TaskList> {
    super::require_non_empty("清单名称", &name)?;
    let conn = db.0.lock();
    conn.execute(
        "UPDATE lists SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name.trim(), crate::db_now(), id],
    )?;
    read_list(&conn, &id)
}

/// 为一个清单设置默认标记（P1：默认清单，写入 settings）
#[tauri::command]
pub fn set_default_list(db: State<'_, Db>, id: Option<String>) -> AppResult<()> {
    let conn = db.0.lock();
    match id {
        Some(list_id) => {
            let exists: bool = conn
                .query_row("SELECT EXISTS(SELECT 1 FROM lists WHERE id = ?1)", params![list_id], |r| r.get(0))
                .unwrap_or(false);
            if !exists { return Err(AppError::msg("清单不存在")); }
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('default_list_id', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![list_id],
            )?;
        }
        None => {
            conn.execute("DELETE FROM settings WHERE key = 'default_list_id'", [])?;
        }
    }
    Ok(())
}

/// 按新顺序重排清单（P1）：传入完整有序 id 列表
#[tauri::command]
pub fn get_default_list(db: State<'_, Db>) -> AppResult<Option<String>> {
    let conn = db.0.lock();
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = 'default_list_id'", [], |r| r.get(0))
        .ok()
        .flatten())
}

#[tauri::command]
pub fn reorder_lists(db: State<'_, Db>, ids: Vec<String>) -> AppResult<()> {
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE lists SET sort_order = ?1 WHERE id = ?2", params![i as i64, id])?;
    }
    tx.commit()?;
    Ok(())
}

/// 删除清单：任务 list_id 置空（PRD §6.2 ON DELETE SET NULL）
#[tauri::command]
pub fn delete_list(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    conn.execute("UPDATE tasks SET list_id = NULL WHERE list_id = ?1", params![id])?;
    conn.execute("DELETE FROM lists WHERE id = ?1", params![id])?;
    Ok(())
}
