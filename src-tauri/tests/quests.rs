use focus_pomodoro_lib::{commands::{quests::{commit_impl, load_impl}, tasks::{toggle_task_impl, delete_task_impl}}, db};
use serde_json::Value;
fn fixtures() -> Vec<Value> { serde_json::from_str(include_str!("../../tools/fixtures/quests.json")).unwrap() }
fn count(conn: &rusqlite::Connection, table: &str) -> i64 { conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap() }
#[test]
fn quest_completion_is_atomic_and_compare_and_swap_is_durable() {
    let mut conn = db::open_in_memory().unwrap(); db::ensure_bootstrap(&conn).unwrap();
    let fixtures = fixtures();
    for (i, f) in fixtures.iter().enumerate() {
        commit_impl(&mut conn, f["expected"].as_i64().unwrap(), serde_json::from_value(f["next"].clone()).unwrap(), f["now"].as_i64().unwrap()).unwrap();
        assert_eq!(count(&conn, "tasks"), if i == 3 { 1 } else { 0 });
        assert_eq!(count(&conn, "focus_records"), if i == 3 { 1 } else { 0 });
    }
    let last = &fixtures[3];
    assert!(commit_impl(&mut conn, 3, serde_json::from_value(last["next"].clone()).unwrap(), last["now"].as_i64().unwrap()).is_err());
    assert_eq!(count(&conn, "tasks"), 1);
    let minutes: i64 = conn.query_row("SELECT duration_min FROM focus_records", [], |r| r.get(0)).unwrap(); assert_eq!(minutes, 20);
    assert_eq!(focus_pomodoro_lib::commands::stats::compute_stats(&conn).unwrap().total_focus_min, 20);
    assert!(toggle_task_impl(&conn, "quest_archive_test_goal_a").is_err());
    assert!(delete_task_impl(&conn, "quest_archive_test_goal_a").is_err());
    db::clear_all(&mut conn).unwrap();
    assert_eq!(serde_json::to_value(load_impl(&conn).unwrap()).unwrap()["revision"], 0);
}
#[test]
fn expired_or_invalid_completion_does_not_leak_tasks_records_or_rewards() {
    let mut conn = db::open_in_memory().unwrap(); db::ensure_bootstrap(&conn).unwrap();
    let fixtures = fixtures();
    for f in &fixtures[..3] { commit_impl(&mut conn, f["expected"].as_i64().unwrap(), serde_json::from_value(f["next"].clone()).unwrap(), f["now"].as_i64().unwrap()).unwrap(); }
    let mut next = fixtures[3]["next"].clone();
    let expiry = next["attempts"][0]["expiresAt"].as_i64().unwrap();
    assert!(commit_impl(&mut conn, 3, serde_json::from_value(next.clone()).unwrap(), expiry).is_err());
    assert_eq!(count(&conn, "tasks"), 0); assert_eq!(count(&conn, "focus_records"), 0);
    assert_eq!(serde_json::to_value(load_impl(&conn).unwrap()).unwrap()["revision"], 3);
    next["quests"][0]["coins"] = 999.into();
    assert!(commit_impl(&mut conn, 3, serde_json::from_value(next).unwrap(), fixtures[3]["now"].as_i64().unwrap()).is_err());
    assert_eq!(count(&conn, "tasks"), 0);
}
