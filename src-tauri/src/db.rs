// SQLite 连接、迁移与首次运行数据 —— PRD §6.2 / §6.3 / §8.6
//
// 数据库位于 app_data_dir/focus.db，启动时执行迁移（PRD §8.6）。

use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::path::Path;

use crate::error::AppResult;
use crate::models::{Settings, TimerState};

pub struct Db(pub Mutex<Connection>);

/// 表结构 —— 与 PRD §6.2 逐字对应
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL DEFAULT '',
  email       TEXT DEFAULT '',
  avatar_path TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  is_smart    INTEGER DEFAULT 0,
  icon_type   TEXT NOT NULL DEFAULT 'dot',
  icon_color  TEXT NOT NULL DEFAULT '',
  icon_glyph  TEXT NOT NULL DEFAULT '',
  folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  list_id       TEXT REFERENCES lists(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  notes         TEXT DEFAULT '',
  est_pomodoros REAL DEFAULT 0,
  due_date      TEXT DEFAULT NULL,
  due_time      TEXT DEFAULT NULL,
  url           TEXT NOT NULL DEFAULT '',
  urgent        INTEGER NOT NULL DEFAULT 0,
  repeat        TEXT NOT NULL DEFAULT 'none',
  lead_remind   TEXT NOT NULL DEFAULT 'none',
  tags          TEXT NOT NULL DEFAULT '[]',
  flag          INTEGER NOT NULL DEFAULT 0,
  priority      TEXT NOT NULL DEFAULT 'none',
  reminded_at   INTEGER DEFAULT NULL,
  completed     INTEGER DEFAULT 0,
  completed_at  INTEGER DEFAULT NULL,
  sort_order    INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed, completed_at);

CREATE TABLE IF NOT EXISTS focus_records (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  list_id     TEXT,
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  phase       TEXT DEFAULT 'focus',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_focus_start ON focus_records(start_at);
CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_records(task_id);

CREATE TABLE IF NOT EXISTS goals (
  id               TEXT PRIMARY KEY DEFAULT 'default',
  daily_target_min INTEGER DEFAULT 180
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  title      TEXT,
  body       TEXT,
  read       INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS countdowns (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  date          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'days_left',
  repeat        TEXT NOT NULL DEFAULT 'once',
  interval_days INTEGER,
  note          TEXT DEFAULT '',
  color         TEXT DEFAULT '',
  icon          TEXT DEFAULT '',
  pinned        INTEGER NOT NULL DEFAULT 0,
  remind_enabled INTEGER NOT NULL DEFAULT 0,
  remind_days   INTEGER NOT NULL DEFAULT 0,
  reminded_at   INTEGER,
  sort_order    INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_countdowns_date ON countdowns(date);

CREATE TABLE IF NOT EXISTS timer_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  phase      TEXT NOT NULL DEFAULT 'idle',
  mode       TEXT NOT NULL DEFAULT 'pomodoro',
  task_id    TEXT,
  running    INTEGER NOT NULL DEFAULT 0,
  start_at   INTEGER,
  end_at     INTEGER,
  paused_remaining_ms INTEGER
);

-- ── 多端同步元信息（引擎见 src/lib/syncData.ts）───────────────────────────
-- sync_dirty      待上传的行（kind = lists / folders / tasks / records）
-- sync_tombstones 本地已删除、待通知云端删除的行（硬删 + 墓碑）
-- sync_shadow     本地 id ↔ 云端记录 id 映射（含上次同步时的 updated_at）
-- sync_guard      单行开关：应用云端数据/清空数据库时置 1，触发器据此不再标脏
CREATE TABLE IF NOT EXISTS sync_dirty (
  kind TEXT NOT NULL,
  id   TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS sync_shadow (
  kind              TEXT NOT NULL,
  id                TEXT NOT NULL,
  remote_id         TEXT,
  remote_updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS sync_guard (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync_guard (id, active) VALUES (1, 0);

-- 触发器：普通写入即标脏；删除则记墓碑（云端稍后按墓碑删除）
CREATE TRIGGER IF NOT EXISTS trg_sync_lists_ins AFTER INSERT ON lists
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('lists', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_lists_upd AFTER UPDATE ON lists
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('lists', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_lists_del AFTER DELETE ON lists
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN
  DELETE FROM sync_dirty WHERE kind = 'lists' AND id = OLD.id;
  INSERT INTO sync_tombstones (kind, id, updated_at)
    VALUES ('lists', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(kind, id) DO UPDATE SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_folders_ins AFTER INSERT ON folders
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('folders', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_folders_upd AFTER UPDATE ON folders
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('folders', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_folders_del AFTER DELETE ON folders
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN
  DELETE FROM sync_dirty WHERE kind = 'folders' AND id = OLD.id;
  INSERT INTO sync_tombstones (kind, id, updated_at)
    VALUES ('folders', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(kind, id) DO UPDATE SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_tasks_ins AFTER INSERT ON tasks
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('tasks', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_tasks_upd AFTER UPDATE ON tasks
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('tasks', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_tasks_del AFTER DELETE ON tasks
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN
  DELETE FROM sync_dirty WHERE kind = 'tasks' AND id = OLD.id;
  INSERT INTO sync_tombstones (kind, id, updated_at)
    VALUES ('tasks', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(kind, id) DO UPDATE SET updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_sync_records_ins AFTER INSERT ON focus_records
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('records', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_records_upd AFTER UPDATE ON focus_records
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN INSERT OR IGNORE INTO sync_dirty (kind, id) VALUES ('records', NEW.id); END;
CREATE TRIGGER IF NOT EXISTS trg_sync_records_del AFTER DELETE ON focus_records
WHEN (SELECT active FROM sync_guard WHERE id = 1) = 0
BEGIN
  DELETE FROM sync_dirty WHERE kind = 'records' AND id = OLD.id;
  INSERT INTO sync_tombstones (kind, id, updated_at)
    VALUES ('records', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(kind, id) DO UPDATE SET updated_at = excluded.updated_at;
END;
"#;

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    migrate_list_icon(&conn)?;
    migrate_task_columns(&conn)?;
    migrate_sync_columns(&conn)?;
    repair_empty_refs(&conn)?;
    Ok(conn)
}

/// 内存数据库（测试用）：应用相同迁移
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;
    migrate_list_icon(&conn)?;
    migrate_task_columns(&conn)?;
    repair_empty_refs(&conn)?;
    Ok(conn)
}

/// 增量迁移：给旧库的 lists 表补上 icon / folder 三（四）列（CREATE TABLE IF NOT EXISTS 不会改已有表）。
/// 新库在 SCHEMA 里已含这些列，此处即空操作。
fn migrate_list_icon(conn: &Connection) -> AppResult<()> {
    let mut cols: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(lists)")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            cols.push(r.get(1)?);
        }
    }
    for (col, ddl) in [
        ("icon_type", "ALTER TABLE lists ADD COLUMN icon_type TEXT NOT NULL DEFAULT 'dot'"),
        ("icon_color", "ALTER TABLE lists ADD COLUMN icon_color TEXT NOT NULL DEFAULT ''"),
        ("icon_glyph", "ALTER TABLE lists ADD COLUMN icon_glyph TEXT NOT NULL DEFAULT ''"),
        ("folder_id", "ALTER TABLE lists ADD COLUMN folder_id TEXT"),
    ] {
        if !cols.iter().any(|c| c == col) {
            conn.execute_batch(ddl)?;
        }
    }
    Ok(())
}

/// 增量迁移：给旧库的 tasks 表补「提醒事项」字段列。
/// 新库在 SCHEMA 里已含这些列，此处即空操作。
fn migrate_task_columns(conn: &Connection) -> AppResult<()> {
    let mut cols: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(tasks)")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            cols.push(r.get(1)?);
        }
    }
    for (col, ddl) in [
        ("due_time", "ALTER TABLE tasks ADD COLUMN due_time TEXT"),
        ("url", "ALTER TABLE tasks ADD COLUMN url TEXT NOT NULL DEFAULT ''"),
        ("urgent", "ALTER TABLE tasks ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0"),
        ("repeat", "ALTER TABLE tasks ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'"),
        ("lead_remind", "ALTER TABLE tasks ADD COLUMN lead_remind TEXT NOT NULL DEFAULT 'none'"),
        ("tags", "ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"),
        ("flag", "ALTER TABLE tasks ADD COLUMN flag INTEGER NOT NULL DEFAULT 0"),
        ("priority", "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'"),
        ("reminded_at", "ALTER TABLE tasks ADD COLUMN reminded_at INTEGER"),
    ] {
        if !cols.iter().any(|c| c == col) {
            conn.execute_batch(ddl)?;
        }
    }
    Ok(())
}

/// 同步相关迁移：focus_records 补 updated_at（老库没有该列）
fn migrate_sync_columns(conn: &Connection) -> AppResult<()> {
    let mut cols: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA table_info(focus_records)")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            cols.push(r.get(1)?);
        }
    }
    if !cols.iter().any(|c| c == "updated_at") {
        conn.execute_batch(
            "ALTER TABLE focus_records ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    conn.execute_batch(
        "UPDATE focus_records SET updated_at = created_at WHERE updated_at = 0;",
    )?;
    Ok(())
}

/// 修复脏数据：外键列里的**空串**一律还原成 NULL。
///
/// 为什么会脏：同步层把行推给 PocketBase 时，`folder_id` / `list_id` / `task_id`
/// 为 NULL 的列会被 PB 的文本字段规范化成 `""`；下次拉取再原样写回 SQLite。
/// 而侧边栏只认 `folder_id == null` 为「顶层清单」，`""` 既不属于任何清单夹、
/// 也不算顶层 → 清单在侧边栏凭空消失（数据其实还在库里）。
///
/// 幂等：只更新真正是空串的行，第二次启动即为空操作。
fn repair_empty_refs(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "UPDATE lists SET folder_id = NULL WHERE folder_id = '';
         UPDATE tasks SET list_id = NULL WHERE list_id = '';
         UPDATE focus_records SET task_id = NULL WHERE task_id = '';
         UPDATE focus_records SET list_id = NULL WHERE list_id = '';",
    )?;
    Ok(())
}

/// 当前本地时间戳（毫秒）
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

/// 首次运行初始化：默认用户 + 默认设置 + 计时状态（PRD §8.4 get_user）
pub fn ensure_bootstrap(conn: &Connection) -> AppResult<()> {
    let now = now_ms();
    conn.execute(
        "INSERT OR IGNORE INTO users (id, username, email, avatar_path, created_at, updated_at)
         VALUES ('u_local', 'honestliu', 'honestliu@icloud.com', '', ?1, ?1)",
        params![now],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO goals (id, daily_target_min) VALUES ('default', 180)",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO timer_state (id, phase, mode, running) VALUES (1, 'idle', 'pomodoro', 0)",
        [],
    )?;
    Ok(())
}

/// 是否已有业务数据（用于判断是否需要写入截图还原数据）
pub fn is_empty(conn: &Connection) -> AppResult<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM lists", [], |r| r.get(0))?;
    Ok(n == 0)
}

/// 是否已完成过首启播种（与浏览器侧 settings.demo_seeded 语义对齐）。
///
/// `is_empty` 只看 lists 计数：用户「删除数据」后它又会变空，单靠它会在每次启动
/// 重新播种。因此播种标记是唯一的防重播守卫（docs/03「同一种子数据」红线）。
pub fn demo_seeded(conn: &Connection) -> AppResult<bool> {
    let seeded: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key='demo_seeded'", [], |r| r.get(0))
        .ok();
    Ok(seeded.as_deref() == Some("1"))
}

/// 写入播种标记；首次播种、「删除数据」与「注销」后都要写，保证重启不再播种。
pub fn mark_demo_seeded(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('demo_seeded', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )?;
    Ok(())
}

/// 截图还原数据 —— PRD §6.3
///
/// 派生目标值：总专注 8小时59分钟(539min) / 本周 8小时59分钟 / 今日 20分钟
///            专注天数 3、完成目标天数 2、每日目标 3小时、未读通知 25
pub fn seed_demo(conn: &mut Connection) -> AppResult<()> {
    let now = now_ms();
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT OR IGNORE INTO lists (id, name, sort_order, is_smart, created_at, updated_at)
         VALUES ('list_default', '任务', 0, 0, ?1, ?1)",
        params![now],
    )?;

    // 任务到期日 10月13日（截图当日 10月14日 -> 昨天）
    let tasks = [
        ("task_math", "数学真题", 7.8_f64, 0_i64),
        ("task_cs408", "408真题", 2.0, 1),
        ("task_words", "单词", 1.5, 2),
    ];
    for (id, title, est, sort) in tasks {
        tx.execute(
            "INSERT OR IGNORE INTO tasks
               (id, list_id, title, notes, est_pomodoros, due_date, completed, completed_at, sort_order, created_at, updated_at)
             VALUES (?1, 'list_default', ?2, '', ?3, date('now','localtime','-1 day'), 0, NULL, ?4, ?5, ?5)",
            params![id, title, est, sort, now],
        )?;
    }

    // (task_id, 天偏移, 起, 止, 分钟)
    let records: [(&str, i64, &str, &str, i64); 22] = [
        ("task_math", 0, "09:24", "09:44", 20),
        ("task_words", -1, "07:22", "07:41", 19),
        ("task_words", -1, "07:44", "08:09", 25),
        ("task_math", -1, "08:30", "08:55", 25),
        ("task_cs408", -1, "09:10", "09:35", 25),
        ("task_cs408", -1, "10:00", "10:25", 25),
        ("task_math", -1, "14:00", "14:25", 25),
        ("task_math", -1, "14:30", "14:55", 25),
        ("task_cs408", -1, "15:10", "15:35", 25),
        ("task_words", -1, "16:00", "16:25", 25),
        ("task_math", -1, "19:00", "19:40", 40),
        ("task_math", -2, "08:00", "08:25", 25),
        ("task_math", -2, "08:30", "08:55", 25),
        ("task_cs408", -2, "09:00", "09:25", 25),
        ("task_cs408", -2, "09:30", "09:55", 25),
        ("task_words", -2, "10:00", "10:25", 25),
        ("task_words", -2, "10:30", "10:55", 25),
        ("task_math", -2, "14:00", "14:25", 25),
        ("task_math", -2, "14:30", "14:55", 25),
        ("task_cs408", -2, "15:00", "15:25", 25),
        ("task_cs408", -2, "15:30", "15:55", 25),
        ("", -2, "16:00", "16:10", 10),
    ];

    for (i, (task_id, day, from, to, min)) in records.iter().enumerate() {
        let task: Option<&str> = if task_id.is_empty() { None } else { Some(task_id) };
        let list: Option<&str> = if task_id.is_empty() { None } else { Some("list_default") };
        let day_mod = format!("{} day", day);
        // 'utc' 修饰符：把输入按本地时间解释后转 UTC 秒
        let start_expr = format!(
            "strftime('%s', date('now','localtime','{}') || ' {}:00', 'utc') * 1000",
            day_mod, from
        );
        let end_expr = format!(
            "strftime('%s', date('now','localtime','{}') || ' {}:00', 'utc') * 1000",
            day_mod, to
        );
        let sql = format!(
            "INSERT OR IGNORE INTO focus_records
               (id, task_id, list_id, start_at, end_at, duration_min, phase, created_at)
             VALUES (?1, ?2, ?3, {}, {}, ?4, 'focus', {})",
            start_expr, end_expr, start_expr
        );
        tx.execute(&sql, params![format!("fr_{:04}", i + 1), task, list, min])?;
    }

    // 未读通知 25（S5 铃铛角标）
    let notif_templates = [
        ("focus_done", "番茄完成", "你完成了一个专注番茄，休息一下吧。"),
        ("break_done", "休息结束", "休息结束，开始下一个专注番茄。"),
        ("task_remind", "任务到期提醒", "你有任务今天到期，记得完成。"),
    ];
    for i in 0..25 {
        let (t, title, body) = notif_templates[i % notif_templates.len()];
        tx.execute(
            "INSERT OR IGNORE INTO notifications (id, type, title, body, read, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![format!("ntf_{:04}", i + 1), t, title, body, now - (i as i64) * 3_600_000],
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// 读取设置 KV 并与默认值合并（PRD §8.6 tauri-plugin-store 的等价实现）
pub fn load_settings(conn: &Connection) -> AppResult<Settings> {
    let mut s = Settings::default();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (k, v) = row?;
        match k.as_str() {
            "focus_len_min" => s.focus_len_min = v.parse().unwrap_or(s.focus_len_min),
            "break_len_min" => s.break_len_min = v.parse().unwrap_or(s.break_len_min),
            "long_break_len_min" => {
                s.long_break_len_min = v.parse().unwrap_or(s.long_break_len_min)
            }
            "long_break_every" => s.long_break_every = v.parse().unwrap_or(s.long_break_every),
            "daily_target_min" => s.daily_target_min = v.parse().unwrap_or(s.daily_target_min),
            "auto_start_next" => s.auto_start_next = v == "true",
            "autostart" => s.autostart = v == "true",
            "notify_enabled" => s.notify_enabled = v == "true",
            "system_notify" => s.system_notify = v == "true",
            "noise_on_focus" => s.noise_on_focus = v == "true",
            "noise_on_break" => s.noise_on_break = v == "true",
            "noise_volume" => s.noise_volume = v.parse().unwrap_or(s.noise_volume),
            "theme" => s.theme = v,
            "language" => s.language = v,
            "noise" => s.noise = v,
            "wallpaper" => s.wallpaper = v,
            "motto" => s.motto = v,
            "startup_page" => s.startup_page = v,
            _ => {}
        }
    }
    Ok(s)
}

pub fn load_timer_state(conn: &Connection) -> AppResult<TimerState> {
    let mut stmt = conn.prepare(
        "SELECT phase, mode, task_id, running, start_at, end_at, paused_remaining_ms
         FROM timer_state WHERE id = 1",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(r) = rows.next()? {
        Ok(TimerState {
            phase: r.get(0)?,
            mode: r.get(1)?,
            task_id: r.get(2)?,
            running: r.get::<_, i64>(3)? != 0,
            start_at: r.get(4)?,
            end_at: r.get(5)?,
            paused_remaining_ms: r.get(6)?,
        })
    } else {
        Ok(TimerState::default())
    }
}

/// 清空业务数据（PRD FR-S2「删除数据」/ §8.8-4）
pub fn clear_all(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    // 清空属于「仅本地」操作：云端数据保留。用 guard 抑制触发器，
    // 避免把本次批量删除当成墓碑上传（那会删掉云端数据）。
    tx.execute("UPDATE sync_guard SET active = 1 WHERE id = 1", [])?;
    tx.execute("DELETE FROM focus_records", [])?;
    tx.execute("DELETE FROM tasks", [])?;
    tx.execute("DELETE FROM lists", [])?;
    tx.execute("DELETE FROM notifications", [])?;
    tx.execute("DELETE FROM settings", [])?;
    tx.execute("DELETE FROM users", [])?;
    tx.execute("DELETE FROM goals", [])?;
    tx.execute("DELETE FROM timer_state", [])?;
    tx.execute("DELETE FROM countdowns", [])?;
    // 簿记一并清掉：本地已无这些行，墓碑/脏标记/shadow 都失去意义。
    // folders 不参与 clear_all（沿用原行为），故保留 folders 的 shadow。
    tx.execute("DELETE FROM sync_dirty", [])?;
    tx.execute("DELETE FROM sync_tombstones", [])?;
    tx.execute("DELETE FROM sync_shadow WHERE kind IN ('lists', 'tasks', 'records')", [])?;
    tx.execute("UPDATE sync_guard SET active = 0 WHERE id = 1", [])?;
    tx.commit()?;
    Ok(())
}
