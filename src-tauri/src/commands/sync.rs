// 多端同步命令 —— 与 src/lib/syncData.ts 配对。
//
// 边界：本层只负责「本地 SQLite 行 ↔ 中立 JSON 行」的搬运和 LWW 合并，
// 完全不知道 PocketBase 的存在（集合名、网络、实时订阅都在 TS 侧）。
// 这样本地写入、远端事件、定时刷新三类触发点都集中在一个前端引擎里，
// Rust 侧保持无状态、可测试。
//
// 冲突策略：按行的 updated_at（毫秒）做 Last-Write-Wins，平局取远端；
// 本地删除走墓碑（sync_tombstones），云端用 deleted 标志软删。

use rusqlite::types::ValueRef;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, State};

use crate::db::Db;
use crate::error::{AppError, AppResult};

const LISTS_COLS: &[&str] = &[
    "id",
    "name",
    "sort_order",
    "is_smart",
    "icon_type",
    "icon_color",
    "icon_glyph",
    "folder_id",
    "created_at",
    "updated_at",
];

const FOLDERS_COLS: &[&str] = &["id", "name", "color", "sort_order", "created_at", "updated_at"];

const TASKS_COLS: &[&str] = &[
    "id",
    "list_id",
    "title",
    "notes",
    "est_pomodoros",
    "due_date",
    "due_time",
    "url",
    "urgent",
    "repeat",
    "lead_remind",
    "tags",
    "flag",
    "priority",
    "reminded_at",
    "completed",
    "completed_at",
    "sort_order",
    "created_at",
    "updated_at",
];

const RECORDS_COLS: &[&str] = &[
    "id",
    "task_id",
    "list_id",
    "start_at",
    "end_at",
    "duration_min",
    "phase",
    "created_at",
    "updated_at",
];

/// kind → (表名, 参与同步的列)
fn table_and_cols(kind: &str) -> AppResult<(&'static str, &'static [&'static str])> {
    match kind {
        "lists" => Ok(("lists", LISTS_COLS)),
        "folders" => Ok(("folders", FOLDERS_COLS)),
        "tasks" => Ok(("tasks", TASKS_COLS)),
        "records" => Ok(("focus_records", RECORDS_COLS)),
        other => Err(AppError::msg(format!("未知的同步类型：{other}"))),
    }
}

fn value_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(_) => Value::Null,
    }
}

/// 一行 → JSON 对象；extra_pb_id 为真时额外带出 shadow 里的云端记录 id。
fn row_to_json(
    row: &rusqlite::Row<'_>,
    cols: &[&str],
    extra_pb_id: bool,
) -> rusqlite::Result<Value> {
    let mut m = Map::new();
    for (i, name) in cols.iter().enumerate() {
        m.insert((*name).to_string(), value_to_json(row.get_ref(i)?));
    }
    if extra_pb_id {
        let pb: Option<String> = row.get(cols.len())?;
        m.insert(
            "pb_id".to_string(),
            pb.map(Value::from).unwrap_or(Value::Null),
        );
    }
    Ok(Value::Object(m))
}

fn json_to_i64(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.parse::<i64>().ok(),
        Value::Bool(b) => Some(i64::from(*b)),
        _ => None,
    }
}

fn json_to_param(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sv;
    match v {
        Value::Null => Sv::Null,
        Value::Bool(b) => Sv::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Sv::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Sv::Real(f)
            } else {
                Sv::Null
            }
        }
        Value::String(s) => Sv::Text(s.clone()),
        _ => Sv::Null,
    }
}

/// 按主键 upsert 一行（只写 obj 里出现的列）。
fn upsert_row(
    conn: &Connection,
    table: &str,
    cols: &[&str],
    obj: &Map<String, Value>,
) -> AppResult<()> {
    let Some(id) = obj.get("id").and_then(Value::as_str) else {
        return Ok(());
    };
    let keys: Vec<&str> = cols
        .iter()
        .copied()
        .filter(|c| obj.contains_key(*c))
        .collect();
    if keys.is_empty() {
        return Ok(());
    }

    let exists: bool = conn
        .query_row(&format!("SELECT 1 FROM {table} WHERE id = ?1"), [id], |_| {
            Ok(true)
        })
        .optional()?
        .unwrap_or(false);

    if exists {
        let set_cols: Vec<&str> = keys.iter().copied().filter(|k| *k != "id").collect();
        if set_cols.is_empty() {
            return Ok(());
        }
        let sets = set_cols
            .iter()
            .map(|k| format!("{k} = ?"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut vals: Vec<rusqlite::types::Value> =
            set_cols.iter().map(|k| json_to_param(&obj[*k])).collect();
        vals.push(rusqlite::types::Value::Text(id.to_string()));
        conn.execute(
            &format!("UPDATE {table} SET {sets} WHERE id = ?"),
            params_from_iter(vals),
        )?;
    } else {
        let ph = (1..=keys.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let vals: Vec<rusqlite::types::Value> =
            keys.iter().map(|k| json_to_param(&obj[*k])).collect();
        conn.execute(
            &format!("INSERT INTO {table} ({}) VALUES ({ph})", keys.join(", ")),
            params_from_iter(vals),
        )?;
    }
    Ok(())
}

/// kind → 需要容忍缺失的外键列
fn fks_for(kind: &str) -> &'static [&'static str] {
    match kind {
        "lists" => &["folder_id"],
        "tasks" => &["list_id"],
        "records" => &["task_id", "list_id"],
        _ => &[],
    }
}

/// 在 savepoint 里 upsert 一行，失败可单独回滚，不影响同批其他行。
fn try_upsert(conn: &Connection, table: &str, cols: &[&str], obj: &Map<String, Value>) -> AppResult<()> {
    conn.execute_batch("SAVEPOINT sync_row")?;
    match upsert_row(conn, table, cols, obj) {
        Ok(()) => {
            conn.execute_batch("RELEASE sync_row")?;
            Ok(())
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO sync_row; RELEASE sync_row")?;
            Err(e)
        }
    }
}

/// 应用一行远端数据：先整体写入；若因外键（父行本地不存在）失败，退一步把外键置空重试。
/// 返回是否可以认为该行已在本地落地。
fn apply_remote_row(
    conn: &Connection,
    table: &str,
    cols: &[&str],
    kind: &str,
    obj: &Map<String, Value>,
    remote_updated: i64,
) -> AppResult<bool> {
    let id = obj.get("id").and_then(Value::as_str).unwrap_or_default();
    let pb_id = obj.get("pb_id").and_then(Value::as_str).unwrap_or("");

    // 同一版本已经落地过（shadow 里记的服务端时间 >= 本次）：不必重写行、也不要算作“有变更”，
    // 否则每一轮拉取都会 upsert 一次并 emit data://changed，把同步引擎自激成死循环。
    let known: Option<i64> = conn
        .query_row(
            "SELECT remote_updated_at FROM sync_shadow WHERE kind = ?1 AND id = ?2",
            params![kind, id],
            |r| r.get(0),
        )
        .optional()?;
    if known.map(|k| k >= remote_updated).unwrap_or(false) {
        conn.execute(
            "DELETE FROM sync_dirty WHERE kind = ?1 AND id = ?2",
            params![kind, id],
        )?;
        return Ok(false);
    }

    let mut row = obj.clone();
    if try_upsert(conn, table, cols, &row).is_err() {
        let fks = fks_for(kind);
        if fks.is_empty() {
            return Ok(false);
        }
        for fk in fks {
            row.insert((*fk).to_string(), Value::Null);
        }
        if try_upsert(conn, table, cols, &row).is_err() {
            return Ok(false);
        }
    }

    conn.execute(
        "DELETE FROM sync_dirty WHERE kind = ?1 AND id = ?2",
        params![kind, id],
    )?;
    conn.execute(
        "INSERT INTO sync_shadow (kind, id, remote_id, remote_updated_at) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(kind, id) DO UPDATE SET \
           remote_id = excluded.remote_id, remote_updated_at = excluded.remote_updated_at",
        params![kind, id, pb_id, remote_updated],
    )?;
    Ok(true)
}

#[derive(Serialize)]
pub struct DirtyBatch {
    rows: Vec<Value>,
    tombstones: Vec<Value>,
}

/// 取一批待上传的行 + 待同步的删除墓碑。
#[tauri::command]
pub fn sync_dirty_batch(db: State<'_, Db>, kind: String, limit: i64) -> AppResult<DirtyBatch> {
    let (table, cols) = table_and_cols(&kind)?;
    let limit = limit.clamp(1, 500);
    let conn = db.0.lock();

    let sel = cols
        .iter()
        .map(|c| format!("t.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {sel}, s.remote_id FROM {table} t \
         LEFT JOIN sync_shadow s ON s.kind = ?1 AND s.id = t.id \
         WHERE t.id IN (SELECT id FROM sync_dirty WHERE kind = ?1 LIMIT ?2) \
         ORDER BY t.updated_at"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![kind, limit], |r| row_to_json(r, cols, true))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tstmt = conn.prepare(
        "SELECT x.id, x.updated_at, s.remote_id FROM sync_tombstones x \
         LEFT JOIN sync_shadow s ON s.kind = x.kind AND s.id = x.id \
         WHERE x.kind = ?1 ORDER BY x.updated_at LIMIT ?2",
    )?;
    let tombstones = tstmt
        .query_map(params![kind, limit], |r| {
            let id: String = r.get(0)?;
            let updated_at: i64 = r.get(1)?;
            let remote_id: Option<String> = r.get(2)?;
            Ok(serde_json::json!({
                "id": id,
                "updated_at": updated_at,
                "pb_id": remote_id,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(DirtyBatch { rows, tombstones })
}

/// 按 id 批量取本地行（推送时补齐被引用但尚未上传的父行，如清单/清单夹）。
#[tauri::command]
pub fn sync_rows_by_ids(
    db: State<'_, Db>,
    kind: String,
    ids: Vec<String>,
) -> AppResult<Vec<Value>> {
    let (table, cols) = table_and_cols(&kind)?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.0.lock();
    let sel = cols
        .iter()
        .map(|c| format!("t.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let ph = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("SELECT {sel} FROM {table} t WHERE t.id IN ({ph})");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(ids), |r| row_to_json(r, cols, false))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[derive(Serialize)]
pub struct ApplyReport {
    applied: i64,
    skipped: i64,
    deleted: i64,
}

/// 应用一批远端行（LWW）与远端删除。写库期间置 guard，避免触发器把它们当成本地改动。
#[tauri::command]
pub fn sync_apply(
    app: AppHandle,
    db: State<'_, Db>,
    kind: String,
    rows: Vec<Value>,
    deleted_ids: Vec<String>,
) -> AppResult<ApplyReport> {
    let (table, cols) = table_and_cols(&kind)?;
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    tx.execute("UPDATE sync_guard SET active = 1 WHERE id = 1", [])?;

    let mut report = ApplyReport {
        applied: 0,
        skipped: 0,
        deleted: 0,
    };

    for row in &rows {
        let Some(obj) = row.as_object() else {
            report.skipped += 1;
            continue;
        };
        let Some(id) = obj.get("id").and_then(Value::as_str) else {
            report.skipped += 1;
            continue;
        };
        let remote_updated = obj.get("updated_at").and_then(json_to_i64).unwrap_or(0);
        let local_updated: Option<i64> = tx
            .query_row(
                &format!("SELECT updated_at FROM {table} WHERE id = ?1"),
                [id],
                |r| r.get(0),
            )
            .optional()?;
        // 本地更新更晚 → 保留本地（它仍是脏行，稍后会上传）。
        if let Some(local) = local_updated {
            if local > remote_updated {
                report.skipped += 1;
                continue;
            }
        }
        // 用服务端记录的 `updated`（PB 自己维护的版本时间）判断“这一版是否已落地”，
        // 不能用业务字段 updated_at：别的端只改标题、不改 updated_at 时那是不变的。
        let server_updated = obj
            .get("server_updated")
            .and_then(json_to_i64)
            .unwrap_or(remote_updated);
        if apply_remote_row(&tx, table, cols, &kind, obj, server_updated)? {
            report.applied += 1;
        } else {
            report.skipped += 1;
        }
    }

    for id in &deleted_ids {
        let n = tx.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;
        for sql in [
            "DELETE FROM sync_dirty WHERE kind = ?1 AND id = ?2",
            "DELETE FROM sync_shadow WHERE kind = ?1 AND id = ?2",
            "DELETE FROM sync_tombstones WHERE kind = ?1 AND id = ?2",
        ] {
            tx.execute(sql, params![kind, id])?;
        }
        if n > 0 {
            report.deleted += 1;
        }
    }

    tx.execute("UPDATE sync_guard SET active = 0 WHERE id = 1", [])?;
    tx.commit()?;

    if report.applied > 0 || report.deleted > 0 {
        let _ = app.emit("data://changed", serde_json::json!({ "table": table }));
    }
    Ok(report)
}

#[derive(serde::Deserialize)]
pub struct AckEntry {
    pub id: String,
    #[serde(default)]
    pub remote_id: String,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

/// 上传成功后回执：清脏标记/墓碑，记录本地 id ↔ 云端记录 id 映射。
#[tauri::command]
pub fn sync_ack(db: State<'_, Db>, kind: String, entries: Vec<AckEntry>) -> AppResult<()> {
    let _ = table_and_cols(&kind)?;
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    for e in &entries {
        tx.execute(
            "DELETE FROM sync_dirty WHERE kind = ?1 AND id = ?2",
            params![kind, e.id],
        )?;
        tx.execute(
            "DELETE FROM sync_tombstones WHERE kind = ?1 AND id = ?2",
            params![kind, e.id],
        )?;
        if e.deleted {
            tx.execute(
                "DELETE FROM sync_shadow WHERE kind = ?1 AND id = ?2",
                params![kind, e.id],
            )?;
        } else if !e.remote_id.is_empty() {
            tx.execute(
                "INSERT INTO sync_shadow (kind, id, remote_id, remote_updated_at) \
                 VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(kind, id) DO UPDATE SET \
                   remote_id = excluded.remote_id, remote_updated_at = excluded.remote_updated_at",
                params![kind, e.id, e.remote_id, e.updated_at],
            )?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[derive(Serialize)]
pub struct PendingCounts {
    dirty: i64,
    tombstones: i64,
}

/// 待同步规模（诊断/自检用）。
#[tauri::command]
pub fn sync_pending_counts(db: State<'_, Db>) -> AppResult<PendingCounts> {
    let conn = db.0.lock();
    let dirty: i64 = conn.query_row("SELECT COUNT(*) FROM sync_dirty", [], |r| r.get(0))?;
    let tombstones: i64 =
        conn.query_row("SELECT COUNT(*) FROM sync_tombstones", [], |r| r.get(0))?;
    Ok(PendingCounts { dirty, tombstones })
}

/// 清空本机业务数据与同步痕迹（guard 期间写库，不会生成脏标记/墓碑）。
/// 用于「首次在本机登录一个云端已有数据的账号」：以云端为准，先清掉本机的示例/临时数据，
/// 否则本机刚播种的示例数据 updated_at 更新，会反向覆盖云端同名记录。
#[tauri::command]
pub fn sync_reset_rows(db: State<'_, Db>) -> AppResult<()> {
    let mut conn = db.0.lock();
    let tx = conn.transaction()?;
    tx.execute("UPDATE sync_guard SET active = 1 WHERE id = 1", [])?;
    for table in ["focus_records", "tasks", "lists", "folders"] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    for table in ["sync_dirty", "sync_tombstones", "sync_shadow"] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute("UPDATE sync_guard SET active = 0 WHERE id = 1", [])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use serde_json::json;

    fn obj(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    fn fresh() -> Connection {
        let conn = open_in_memory().unwrap();
        conn.execute("DELETE FROM sync_dirty", []).unwrap();
        conn.execute("DELETE FROM sync_tombstones", []).unwrap();
        conn.execute("DELETE FROM sync_shadow", []).unwrap();
        conn
    }

    fn dirty(conn: &Connection, kind: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM sync_dirty WHERE kind = ?1",
            [kind],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn local_insert_marks_dirty_and_guard_suppresses_it() {
        let conn = fresh();
        conn.execute(
            "INSERT INTO lists (id, name, sort_order, created_at, updated_at) VALUES ('l1','a',0,1,1)",
            [],
        )
        .unwrap();
        assert_eq!(dirty(&conn, "lists"), 1);

        // guard 打开期间（应用远端/清空数据）不应产生脏行
        conn.execute("UPDATE sync_guard SET active = 1 WHERE id = 1", []).unwrap();
        conn.execute(
            "INSERT INTO lists (id, name, sort_order, created_at, updated_at) VALUES ('l2','b',0,1,1)",
            [],
        )
        .unwrap();
        assert_eq!(dirty(&conn, "lists"), 1);
    }

    #[test]
    fn local_delete_writes_tombstone() {
        let conn = fresh();
        conn.execute(
            "INSERT INTO tasks (id, title, tags, created_at, updated_at) VALUES ('t1','x','[]',1,1)",
            [],
        )
        .unwrap();
        conn.execute("DELETE FROM tasks WHERE id = 't1'", []).unwrap();
        let tombstones: i64 = conn
            .query_row("SELECT COUNT(*) FROM sync_tombstones WHERE kind = 'tasks'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tombstones, 1);
        assert_eq!(dirty(&conn, "tasks"), 0);
    }

    #[test]
    fn apply_remote_clears_dirty_and_records_shadow() {
        let conn = fresh();
        conn.execute(
            "INSERT INTO lists (id, name, sort_order, created_at, updated_at) VALUES ('l1','local',0,1,1)",
            [],
        )
        .unwrap();
        assert_eq!(dirty(&conn, "lists"), 1);

        let row = obj(json!({
            "id": "l1", "name": "remote", "sort_order": 3,
            "created_at": 1, "updated_at": 99, "pb_id": "pbl1"
        }));
        assert!(apply_remote_row(&conn, "lists", LISTS_COLS, "lists", &row, 99).unwrap());
        assert_eq!(dirty(&conn, "lists"), 0);

        let name: String = conn
            .query_row("SELECT name FROM lists WHERE id = 'l1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "remote");
        let shadow: String = conn
            .query_row(
                "SELECT remote_id FROM sync_shadow WHERE kind = 'lists' AND id = 'l1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(shadow, "pbl1");
    }

    #[test]
    fn missing_parent_foreign_key_falls_back_to_null() {
        let conn = fresh();
        let row = obj(json!({
            "id": "t1", "list_id": "ghost_list", "title": "x", "tags": "[]",
            "created_at": 5, "updated_at": 5, "pb_id": "pbt1"
        }));
        assert!(apply_remote_row(&conn, "tasks", TASKS_COLS, "tasks", &row, 5).unwrap());
        let list_id: Option<String> = conn
            .query_row("SELECT list_id FROM tasks WHERE id = 't1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(list_id, None);
    }

    #[test]
    fn focus_records_carry_updated_at() {
        let conn = fresh();
        conn.execute(
            "INSERT INTO focus_records (id, start_at, end_at, duration_min, created_at, updated_at) \
             VALUES ('fr1', 1, 2, 25, 1, 1)",
            [],
        )
        .unwrap();
        assert_eq!(dirty(&conn, "records"), 1);
        let row: Option<String> = conn
            .query_row(
                "SELECT updated_at FROM focus_records WHERE id = 'fr1'",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap()
            .map(|v: i64| v.to_string());
        assert_eq!(row.as_deref(), Some("1"));
    }
}
