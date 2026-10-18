// 清单夹命令 —— 容纳多个 todo 清单（FR 新增：清单夹 / 文件夹）

use rusqlite::params;
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::Folder;

fn read_folder(conn: &rusqlite::Connection, id: &str) -> AppResult<Folder> {
    conn.query_row(
        "SELECT id, name, color, sort_order, created_at, updated_at FROM folders WHERE id = ?1",
        params![id],
        |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                sort_order: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        },
    )
    .map_err(|_| AppError::msg("清单夹不存在"))
}

#[tauri::command]
pub fn list_folders(db: State<'_, Db>) -> AppResult<Vec<Folder>> {
    let conn = db.0.lock();
    let mut stmt = conn.prepare(
        "SELECT id, name, color, sort_order, created_at, updated_at
         FROM folders ORDER BY sort_order, created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Folder {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            sort_order: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn create_folder(db: State<'_, Db>, name: String, color: String) -> AppResult<Folder> {
    super::require_non_empty("清单夹名称", &name)?;
    let conn = db.0.lock();
    let now = crate::db_now();
    let id = new_id("folder");
    let order: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO folders (id, name, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, name.trim(), color.trim(), order, now],
    )?;
    read_folder(&conn, &id)
}

#[tauri::command]
pub fn rename_folder(db: State<'_, Db>, id: String, name: String) -> AppResult<Folder> {
    super::require_non_empty("清单夹名称", &name)?;
    let conn = db.0.lock();
    conn.execute(
        "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name.trim(), crate::db_now(), id],
    )?;
    read_folder(&conn, &id)
}

/// 编辑清单夹：名称 + 颜色
#[tauri::command]
pub fn update_folder(db: State<'_, Db>, id: String, name: String, color: String) -> AppResult<Folder> {
    super::require_non_empty("清单夹名称", &name)?;
    let conn = db.0.lock();
    conn.execute(
        "UPDATE folders SET name = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
        params![name.trim(), color.trim(), crate::db_now(), id],
    )?;
    read_folder(&conn, &id)
}

/// 删除清单夹：夹内清单归还到顶层（list.folder_id = NULL）
#[tauri::command]
pub fn delete_folder(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    conn.execute("UPDATE lists SET folder_id = NULL WHERE folder_id = ?1", params![id])?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn reorder_folders(db: State<'_, Db>, ids: Vec<String>) -> AppResult<()> {
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE folders SET sort_order = ?1 WHERE id = ?2", params![i as i64, id])?;
    }
    tx.commit()?;
    Ok(())
}
