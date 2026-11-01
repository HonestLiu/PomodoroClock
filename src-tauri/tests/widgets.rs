use focus_pomodoro_lib::{db, widgets};
use rusqlite::params;

fn database() -> rusqlite::Connection {
    let conn = db::open_in_memory().unwrap();
    db::ensure_bootstrap(&conn).unwrap();
    conn
}
fn value(conn: &rusqlite::Connection, now: i64) -> serde_json::Value {
    serde_json::to_value(widgets::snapshot(conn, now).unwrap()).unwrap()
}
fn record(conn: &rusqlite::Connection, id: &str, start: i64, minutes: i64, phase: &str) {
    conn.execute("INSERT INTO focus_records(id,start_at,end_at,duration_min,phase,created_at) VALUES(?1,?2,?2+60000,?3,?4,?2)",
        params![id, start, minutes, phase]).unwrap();
}
#[test]
fn empty_and_private_projection() {
    let conn = database();
    conn.execute("INSERT INTO settings(key,value) VALUES('ai_api_key','secret-key'),('growth_data','private-payment-ledger')", []).unwrap();
    let snapshot = value(&conn, 1_800_000_000_000);
    assert_eq!(snapshot["version"], 1);
    assert_eq!(snapshot["week"].as_array().unwrap().len(), 7);
    assert_eq!(snapshot["todayMinutes"], 0);
    assert_eq!(snapshot["todaySessions"], 0);
    assert_eq!(snapshot["tasks"], serde_json::json!([]));
    let json = snapshot.to_string();
    assert!(!json.contains("secret-key")); assert!(!json.contains("private-payment-ledger"));
    assert!(!json.contains("ai_api_key")); assert!(!json.contains("focus.db"));
}
#[test]
fn excludes_break_invalid_and_future_records_and_rolls_at_midnight() {
    let conn = database();
    // Local noon keeps the small +/- ranges on the same day in every test timezone.
    let now: i64 = conn.query_row("SELECT strftime('%s','2026-10-31 12:00:00','utc') * 1000", [], |r| r.get(0)).unwrap();
    record(&conn, "focus", now-60_000, 25, "focus");
    record(&conn, "break", now-60_000, 5, "break");
    record(&conn, "negative", now-60_000, -10, "focus");
    record(&conn, "future", now+60_000, 80, "focus");
    record(&conn, "old", now-9*86_400_000, 100, "focus");
    let snapshot = value(&conn, now);
    assert_eq!(snapshot["day"], "2026-10-31");
    assert_eq!(snapshot["todayMinutes"], 25); assert_eq!(snapshot["todaySessions"], 1);
    assert_eq!(snapshot["week"].as_array().unwrap().iter().map(|day| day["minutes"].as_i64().unwrap()).sum::<i64>(), 25);
    assert_eq!(value(&conn, now+86_400_000)["todayMinutes"], 0);
}
#[test]
fn tasks_are_bounded_and_completed_or_future_tasks_are_hidden() {
    let conn = database();
    for (id, due, completed) in [("today", Some("2026-10-31"), 0), ("later", Some("2026-11-02"), 0),
        ("done", None, 1), ("free", None, 0), ("overdue", Some("2026-10-29"), 0), ("fourth", None, 0)] {
        conn.execute("INSERT INTO tasks(id,title,due_date,completed,created_at,updated_at) VALUES(?1,?1,?2,?3,1,1)", params![id,due,completed]).unwrap();
    }
    conn.execute("UPDATE timer_state SET task_id='free' WHERE id=1", []).unwrap();
    let now: i64 = conn.query_row("SELECT strftime('%s','2026-10-31 12:00:00','utc') * 1000", [], |r| r.get(0)).unwrap();
    let snapshot = value(&conn, now);
    assert_eq!(snapshot["tasks"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["tasks"][0]["id"], "free"); assert_eq!(snapshot["taskTitle"], "free");
    assert_eq!(snapshot["tasks"][1]["id"], "today"); assert_eq!(snapshot["tasks"][2]["id"], "overdue");
}
#[test]
fn paused_stopwatch_and_goal_table_survive_projection() {
    let conn = database();
    conn.execute("UPDATE timer_state SET phase='focus',mode='stopwatch',running=0,start_at=1000,paused_remaining_ms=300000", []).unwrap();
    conn.execute("UPDATE goals SET daily_target_min=90", []).unwrap();
    let snapshot = value(&conn, 1_800_000_000_000);
    assert_eq!(snapshot["mode"], "stopwatch"); assert_eq!(snapshot["running"], false);
    assert_eq!(snapshot["frozenMs"], 300000); assert_eq!(snapshot["targetMinutes"], 90);
}
#[test]
fn clearing_data_clears_the_next_widget_snapshot() {
    let mut conn = database();
    record(&conn, "record", 1_800_000_000_000-60_000, 25, "focus");
    assert_eq!(value(&conn, 1_800_000_000_000)["todayMinutes"], 25);
    db::clear_all(&mut conn).unwrap(); db::ensure_bootstrap(&conn).unwrap();
    assert_eq!(value(&conn, 1_800_000_000_000)["todayMinutes"], 0);
}
