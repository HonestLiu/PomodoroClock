//! Local quest ledger. Compare-and-swap and ordinary archives commit in one SQLite transaction.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::{db::Db, error::{AppError, AppResult}};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifeGoal { id: String, title: String, description: String, budget: i64, paused: bool, created_at: i64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quest { id: String, goal_id: String, title: String, acceptance: String, minutes: i64, requires: Vec<String>, coins: i64, xp: i64, completed_at: Option<i64>, published_day: Option<String>, next_day: String, order: i64 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session { id: String, start_at: i64, end_at: i64, duration_min: f64 }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt { id: String, quest_id: String, day: String, accepted_at: i64, expires_at: i64, status: String, sessions: Vec<Session> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QuestData { version: i64, revision: i64, goals: Vec<LifeGoal>, quests: Vec<Quest>, attempts: Vec<Attempt> }
impl Default for QuestData {
    fn default() -> Self { Self { version: 1, revision: 0, goals: vec![], quests: vec![], attempts: vec![] } }
}
fn invalid() -> AppError { AppError::msg("quest.invalidPlan") }
fn setup(conn: &Connection) -> AppResult<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS quest_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);")?;
    Ok(())
}
pub fn load_impl(conn: &Connection) -> AppResult<QuestData> {
    setup(conn)?;
    let raw: Option<String> = conn.query_row("SELECT data FROM quest_state WHERE id=1", [], |r| r.get(0)).optional()?;
    match raw { Some(s) => Ok(serde_json::from_str(&s)?), None => Ok(QuestData::default()) }
}
fn validate(old: &QuestData, next: &QuestData, now: i64) -> AppResult<()> {
    use std::collections::HashSet;
    if next.version != 1 || next.revision != old.revision + 1 || next.goals.len() > 100 || next.quests.len() > 3000 { return Err(invalid()); }
    if next.goals.iter().map(|g| &g.id).collect::<HashSet<_>>().len() != next.goals.len()
        || next.quests.iter().map(|q| &q.id).collect::<HashSet<_>>().len() != next.quests.len()
        || next.attempts.iter().map(|a| &a.id).collect::<HashSet<_>>().len() != next.attempts.len() { return Err(invalid()); }
    for g in &next.goals {
        if g.title.trim().is_empty() || !(5..=480).contains(&g.budget) { return Err(invalid()); }
    }
    for q in &next.quests {
        let g = next.goals.iter().find(|g| g.id == q.goal_id).ok_or_else(invalid)?;
        if q.title.trim().is_empty() || q.acceptance.trim().is_empty() || q.minutes < 5 || q.minutes > g.budget
            || q.coins != ((q.minutes + 9) / 10).clamp(1, 10) || q.xp != (q.minutes * 2).clamp(10, 100) { return Err(invalid()); }
        // Every dependency must precede this node in a valid topological ordering (separate traversal below handles arbitrary order).
        let mut visiting = HashSet::new();
        fn visit<'a>(id: &'a str, all: &'a [Quest], path: &mut HashSet<&'a str>) -> bool {
            if !path.insert(id) { return false; }
            let ok = all.iter().find(|p| p.id == id).map(|p| p.requires.iter().all(|dep| visit(dep, all, path))).unwrap_or(false);
            path.remove(id); ok
        }
        if !visit(&q.id, &next.quests, &mut visiting) { return Err(invalid()); }
    }
    for q in &old.quests {
        let n = next.quests.iter().find(|n| n.id == q.id).ok_or_else(invalid)?;
        if q.goal_id != n.goal_id || q.title != n.title || q.acceptance != n.acceptance || q.minutes != n.minutes || q.requires != n.requires
            || (q.completed_at.is_some() && q.completed_at != n.completed_at) { return Err(invalid()); }
    }
    for a in &next.attempts {
        let q = next.quests.iter().find(|q| q.id == a.quest_id).ok_or_else(invalid)?;
        if !["accepted", "expired", "completed"].contains(&a.status.as_str()) || a.expires_at <= a.accepted_at { return Err(invalid()); }
        if a.status == "accepted" && next.attempts.iter().filter(|p| p.quest_id == a.quest_id && p.status == "accepted").count() != 1 { return Err(invalid()); }
        if a.status == "completed" && (q.completed_at.is_none() || next.attempts.iter().filter(|p| p.quest_id == a.quest_id && p.status == "completed").count() != 1) { return Err(invalid()); }
        if let Some(p) = old.attempts.iter().find(|p| p.id == a.id) {
            if p.quest_id != a.quest_id || p.accepted_at != a.accepted_at || p.expires_at != a.expires_at || p.day != a.day
                || (p.status != "accepted" && (p.status != a.status || p.sessions != a.sessions))
                || !p.sessions.iter().all(|s| a.sessions.contains(s)) { return Err(invalid()); }
            if a.status == "completed" && p.status != "completed" {
                if now >= a.expires_at || now < a.accepted_at || q.completed_at.map_or(true, |at| at < a.accepted_at || at >= a.expires_at || at > now + 1000)
                    || !q.requires.iter().all(|id| old.quests.iter().any(|p| &p.id == id && p.completed_at.is_some())) { return Err(AppError::msg("quest.expired")); }
            }
        } else {
            if a.status != "accepted" || now >= a.expires_at || a.accepted_at > now + 1000 || q.completed_at.is_some()
                || q.published_day.as_deref() != Some(&a.day)
                || !q.requires.iter().all(|id| old.quests.iter().any(|p| &p.id == id && p.completed_at.is_some())) { return Err(invalid()); }
        }
        let mut ends = a.accepted_at;
        let mut sessions = a.sessions.clone(); sessions.sort_by_key(|s| s.start_at);
        for s in &sessions {
            if s.start_at < ends || s.end_at <= s.start_at || s.end_at > a.expires_at || s.end_at > now + 1000 || !s.duration_min.is_finite()
                || s.duration_min <= 0.0 || s.duration_min.fract() != 0.0 || s.duration_min > (s.end_at - s.start_at) as f64 / 60000.0 + 0.0001 { return Err(invalid()); }
            ends = s.end_at;
        }
    }
    if !old.attempts.iter().all(|a| next.attempts.iter().any(|p| p.id == a.id)) { return Err(invalid()); }
    for q in &next.quests {
        if q.completed_at.is_some() && !next.attempts.iter().any(|a| a.quest_id == q.id && a.status == "completed") { return Err(invalid()); }
    }
    Ok(())
}
pub fn commit_impl(conn: &mut Connection, expected: i64, next: QuestData, now: i64) -> AppResult<QuestData> {
    setup(conn)?;
    let tx = conn.transaction()?;
    let old = load_impl(&tx)?;
    if old.revision != expected { return Err(AppError::msg("quest.conflict")); }
    validate(&old, &next, now)?;
    for a in next.attempts.iter().filter(|a| a.status == "completed" && !old.attempts.iter().any(|p| p.id == a.id && p.status == "completed")) {
        let q = next.quests.iter().find(|q| q.id == a.quest_id).ok_or_else(invalid)?;
        let task_id = format!("quest_archive_{}", q.id);
        let duration: i64 = a.sessions.iter().map(|s| s.duration_min as i64).sum();
        tx.execute("INSERT INTO tasks(id,list_id,title,notes,est_pomodoros,due_date,completed,completed_at,actual_minutes,created_at,updated_at) VALUES(?1,NULL,?2,?3,?4,?5,1,?6,?7,?8,?6)",
            params![task_id,q.title,q.acceptance,q.minutes as f64 / 25.0,a.day,q.completed_at,duration,a.accepted_at])?;
        for s in &a.sessions {
            tx.execute("INSERT INTO focus_records(id,task_id,list_id,start_at,end_at,duration_min,phase,created_at) VALUES(?1,?2,NULL,?3,?4,?5,'focus',?6)",
                params![format!("quest_focus_{}",s.id),task_id,s.start_at,s.end_at,s.duration_min as i64,q.completed_at])?;
        }
    }
    tx.execute("INSERT INTO quest_state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&next)?])?;
    tx.commit()?;
    Ok(next)
}
#[tauri::command]
pub fn quest_load(db: State<'_, Db>) -> AppResult<QuestData> { load_impl(&db.0.lock()) }
#[tauri::command]
pub fn quest_commit(db: State<'_, Db>, expected_revision: i64, next: QuestData) -> AppResult<QuestData> {
    commit_impl(&mut db.0.lock(), expected_revision, next, crate::db_now())
}

/// Replace this account's quest snapshot after config-sync conflict resolution.
#[tauri::command]
pub fn quest_apply_remote(db: State<'_, Db>, data: QuestData) -> AppResult<()> {
    if data.version != 1 || data.goals.len() > 100 || data.quests.len() > 3000 || data.attempts.len() > 10000 {
        return Err(invalid());
    }
    let conn = db.0.lock();
    setup(&conn)?;
    conn.execute("INSERT INTO quest_state(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&data)?])?;
    Ok(())
}
