// 通知命令 —— PRD §8.4 / §5.7 FR-N

use rusqlite::params;
use tauri::State;

use crate::db::{new_id, Db};
use crate::error::{AppError, AppResult};
use crate::models::{CreateNotificationArgs, Notification};

fn row_to_notif(r: &rusqlite::Row) -> rusqlite::Result<Notification> {
    Ok(Notification {
        id: r.get(0)?,
        r#type: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        read: r.get(4)?,
        created_at: r.get(5)?,
    })
}

#[tauri::command]
pub fn list_notifications(db: State<'_, Db>) -> AppResult<Vec<Notification>> {
    let conn = db.0.lock();
    let mut stmt = conn.prepare(
        "SELECT id, type, title, body, read, created_at FROM notifications ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_notif)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn replace_notifications(db: State<'_, Db>, items: Vec<Notification>) -> AppResult<()> {
    if items.len() > 20000 { return Err(AppError::msg("通知数量超限")); }
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM notifications", [])?;
    for n in items {
        tx.execute("INSERT INTO notifications(id,type,title,body,read,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![n.id,n.r#type,n.title,n.body,n.read,n.created_at])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn create_notification(
    db: State<'_, Db>,
    args: CreateNotificationArgs,
) -> AppResult<Notification> {
    let conn = db.0.lock();
    let id = new_id("ntf");
    let now = crate::db_now();
    conn.execute(
        "INSERT INTO notifications (id, type, title, body, read, created_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![id, args.r#type, args.title, args.body, now],
    )?;
    conn.query_row(
        "SELECT id, type, title, body, read, created_at FROM notifications WHERE id = ?1",
        params![id],
        row_to_notif,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn mark_notif_read(db: State<'_, Db>, id: String) -> AppResult<()> {
    let conn = db.0.lock();
    conn.execute("UPDATE notifications SET read = 1 WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn mark_all_notifs_read(db: State<'_, Db>) -> AppResult<()> {
    let conn = db.0.lock();
    conn.execute("UPDATE notifications SET read = 1", [])?;
    Ok(())
}
