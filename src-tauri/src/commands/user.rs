// 用户命令 —— PRD §8.4 / FR-S2

use rusqlite::params;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::User;

fn read_user(conn: &rusqlite::Connection) -> AppResult<User> {
    let mut stmt = conn.prepare(
        "SELECT id, username, email, avatar_path, created_at, updated_at FROM users LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(r) => Ok(User {
            id: r.get(0)?,
            username: r.get(1)?,
            email: r.get(2)?,
            avatar_path: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        }),
        None => Err(AppError::msg("用户不存在")),
    }
}

#[tauri::command]
pub fn get_user(db: State<'_, Db>) -> AppResult<User> {
    let conn = db.0.lock();
    read_user(&conn)
}

#[tauri::command]
pub fn update_user(db: State<'_, Db>, patch: serde_json::Value) -> AppResult<User> {
    let conn = db.0.lock();
    let now = crate::db_now();
    if let Some(v) = patch.get("username").and_then(|v| v.as_str()) {
        super::require_non_empty("用户名", v)?;
        conn.execute("UPDATE users SET username = ?1, updated_at = ?2", params![v, now])?;
    }
    if let Some(v) = patch.get("email").and_then(|v| v.as_str()) {
        conn.execute("UPDATE users SET email = ?1, updated_at = ?2", params![v, now])?;
    }
    if let Some(v) = patch.get("avatar_path").and_then(|v| v.as_str()) {
        conn.execute("UPDATE users SET avatar_path = ?1, updated_at = ?2", params![v, now])?;
    }
    read_user(&conn)
}

/// 头像选择：原生文件对话框（PRD §8.1 tauri-plugin-dialog）
#[tauri::command]
pub async fn pick_avatar(app: tauri::AppHandle) -> AppResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif"])
        .blocking_pick_file();

    match picked {
        Some(path) => {
            let p = path.to_string();
            // 复制到 app_data_dir/avatars，避免依赖原始路径（PRD §8.6）
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::msg(e.to_string()))?
                .join("avatars");
            std::fs::create_dir_all(&dir)?;
            let ext = std::path::Path::new(&p)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let dest = dir.join(format!("{}.{}", new_id("avatar"), ext));
            std::fs::copy(&p, &dest)?;
            Ok(Some(dest.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// 注销账号：清理本地数据（PRD FR-S2）
#[tauri::command]
pub fn logout(db: State<'_, Db>) -> AppResult<()> {
    let mut conn = db.0.lock();
    crate::db::clear_all(&mut conn)?;
    crate::db::ensure_bootstrap(&conn)?;
    Ok(())
}

/// 删除数据：清空全部业务表（PRD FR-S2 / §8.8-4）
#[tauri::command]
pub fn clear_all_data(db: State<'_, Db>) -> AppResult<()> {
    let mut conn = db.0.lock();
    crate::db::clear_all(&mut conn)?;
    crate::db::ensure_bootstrap(&conn)?;
    Ok(())
}
