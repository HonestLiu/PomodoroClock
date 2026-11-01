//! Read-only WidgetKit projection. No database path, settings secrets, or payment data
//! cross the extension boundary. The timer's existing owner remains unchanged.
use rusqlite::Connection;
use serde::Serialize;
use crate::error::AppResult;

#[derive(Serialize)]
pub struct WidgetTask { id: String, title: String }
#[derive(Serialize)]
pub struct WidgetDay { date: String, minutes: i64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    version: u8,
    updated_at: i64,
    day: String,
    language: String,
    phase: String,
    mode: String,
    running: bool,
    start_at: Option<i64>,
    end_at: Option<i64>,
    frozen_ms: i64,
    focus_minutes: i64,
    target_minutes: i64,
    today_minutes: i64,
    today_sessions: i64,
    task_title: Option<String>,
    tasks: Vec<WidgetTask>,
    week: Vec<WidgetDay>,
}

/// `now` is injected so midnight, future data, and local-time grouping are testable.
pub fn snapshot(conn: &Connection, now: i64) -> AppResult<WidgetSnapshot> {
    let settings = crate::db::load_settings(conn)?;
    let state = crate::db::load_timer_state(conn)?;
    let day: String = conn.query_row("SELECT date(?1/1000,'unixepoch','localtime')", [now], |row| row.get(0))?;
    let mut stmt = conn.prepare(
        "WITH RECURSIVE days(d) AS (
            SELECT date(?1,'-6 days') UNION ALL SELECT date(d,'+1 day') FROM days WHERE d < ?1
         ) SELECT d, COALESCE(SUM(r.duration_min),0), COUNT(r.id) FROM days
         LEFT JOIN focus_records r ON r.start_at >= strftime('%s',d || ' 00:00:00','utc') * 1000
            AND r.start_at < strftime('%s',date(d,'+1 day') || ' 00:00:00','utc') * 1000
            AND r.phase = 'focus' AND r.duration_min > 0 AND r.start_at <= ?2
         GROUP BY d ORDER BY d")?;
    let rows = stmt.query_map(rusqlite::params![day, now], |row| Ok((
        row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?
    )))?.collect::<Result<Vec<_>, _>>()?;
    let today = rows.last().map(|(_, min, n)| (*min, *n)).unwrap_or((0, 0));
    let task_title = state.task_id.as_ref().and_then(|id| conn.query_row(
        "SELECT title FROM tasks WHERE id=?1", [id], |row| row.get::<_, String>(0)).ok());
    let mut stmt = conn.prepare(
        "SELECT id,title FROM tasks WHERE completed=0 AND (due_date IS NULL OR due_date <= ?1)
         ORDER BY CASE WHEN id=?2 THEN 0 ELSE 1 END,
           CASE WHEN due_date=?1 THEN 0 WHEN due_date IS NOT NULL THEN 1 ELSE 2 END,
           due_date, due_time, sort_order, created_at LIMIT 3")?;
    let tasks = stmt.query_map(rusqlite::params![day, state.task_id], |row|
        Ok(WidgetTask { id: row.get(0)?, title: row.get(1)? }))?.collect::<Result<Vec<_>, _>>()?;
    // Read the actual goal table too: editing the report goal uses a separate command.
    let target: i64 = conn.query_row("SELECT daily_target_min FROM goals WHERE id='default'", [], |r| r.get(0))
        .unwrap_or(settings.daily_target_min);
    Ok(WidgetSnapshot { version: 1, updated_at: 0, day, language: settings.language,
        phase: state.phase, mode: state.mode, running: state.running, start_at: state.start_at,
        end_at: state.end_at, frozen_ms: state.paused_remaining_ms.unwrap_or(settings.focus_len_min * 60_000).max(0),
        focus_minutes: settings.focus_len_min.max(1), target_minutes: target.max(1),
        today_minutes: today.0, today_sessions: today.1, task_title, tasks,
        week: rows.into_iter().map(|(date, minutes, _)| WidgetDay { date, minutes }).collect() })
}

#[cfg(target_os = "macos")]
pub fn spawn_publisher(app: tauri::AppHandle) {
    use tauri::Manager;
    extern "C" { fn focus_widget_publish(bytes: *const u8, length: usize) -> i32; }
    std::thread::spawn(move || {
        let mut previous = Vec::new();
        let mut last_warning = 0;
        loop {
            let result = (|| -> AppResult<()> {
                let mut value = {
                    let db = app.state::<crate::db::Db>();
                    let conn = db.0.lock();
                    snapshot(&conn, crate::db_now())?
                }; // Release SQLite before calling WidgetKit / doing file I/O.
                let signature = serde_json::to_vec(&value)?;
                if signature != previous {
                    value.updated_at = crate::db_now();
                    let bytes = serde_json::to_vec(&value)?;
                    let status = unsafe { focus_widget_publish(bytes.as_ptr(), bytes.len()) };
                    if status == 0 { previous = signature; }
                    else if crate::db_now() - last_warning > 60_000 {
                        eprintln!("[WidgetKit] Shared container unavailable (status {status}); check App Group signing.");
                        last_warning = crate::db_now();
                    }
                }
                Ok(())
            })();
            if let Err(error) = result { eprintln!("[WidgetKit] Snapshot failed: {error}"); }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

/// Cold launch URL actions are retained until the webview has finished booting.
#[derive(Default)]
pub struct WidgetLaunch(pub std::sync::Mutex<bool>);

#[tauri::command]
pub fn take_widget_launch(state: tauri::State<'_, WidgetLaunch>) -> bool {
    std::mem::take(&mut *state.0.lock().unwrap())
}
