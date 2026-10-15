// 数据层口径测试：直接对真 SQLite 跑 PRD §7.2 统计，验证与截图数据一致。
// 运行：cargo test（在 src-tauri 目录下）

use focus_pomodoro_lib::db;

fn seeded(db: &mut rusqlite::Connection) {
    db::ensure_bootstrap(&db).unwrap();
    db::seed_demo(db).unwrap();
}

#[test]
fn stats_match_screenshot_spec() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let s = focus_pomodoro_lib::commands::stats::compute_stats(&db).unwrap();

    assert_eq!(s.total_focus_min, 539, "总专注 8小时59分钟");
    assert_eq!(s.today_focus_min, 20, "今日 20 分钟");
    assert_eq!(s.week_focus_min, 539, "本周 = 总");
    assert_eq!(s.total_done_tasks, 0, "总完成任务 0");
    assert_eq!(s.today_done_tasks, 0);
    assert_eq!(s.focus_days, 3, "专注天数 3");
    assert_eq!(s.goal_days, 2, "完成目标天数 2");
    assert_eq!(s.daily_target_min, 180, "每日目标 3 小时");
}

#[test]
fn today_durations_reflect_seed() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let key = local_today_key(&db);
    let td = focus_pomodoro_lib::commands::stats::task_durations_impl(&db, "day", &key).unwrap();
    assert_eq!(td.total, 20);
    assert_eq!(td.items.len(), 1);
    assert_eq!(td.items[0].title, "数学真题");
    assert_eq!(td.items[0].minutes, 20);

    let dist = focus_pomodoro_lib::commands::stats::list_distribution_impl(&db, "day", &key).unwrap();
    assert_eq!(dist.total, 20);
    assert_eq!(dist.items[0].name, "任务");
    assert_eq!(dist.items[0].percent, 100);
}

#[test]
fn grid_covers_14_days_with_cells() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let g = focus_pomodoro_lib::commands::stats::pomodoro_grid_impl(&db, Some(14)).unwrap();
    assert_eq!(g.dates.len(), 14);
    assert!(g.cells.len() >= 12, "应有多个网格单元，实际 {}", g.cells.len());
    // 今天(蓝色行)应有 09 时的 20 分钟
    assert!(g.cells.iter().any(|c| c.date == g.dates[0] && c.minutes == 20));
}

#[test]
fn set_goal_writes_settings() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let g = focus_pomodoro_lib::commands::stats::set_goal_impl(&db, 120).unwrap();
    assert_eq!(g.daily_target_min, 120);
    let back = focus_pomodoro_lib::commands::stats::get_goal_impl(&db).unwrap();
    assert_eq!(back.daily_target_min, 120);
    // settings 键也应同步（对话一致性）
    let s: i64 = db.query_row(
        "SELECT CAST(value AS INTEGER) FROM settings WHERE key='daily_target_min'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(s, 120);
}

#[test]
fn reorder_tasks_persists_order() {
    use focus_pomodoro_lib::commands::tasks::reorder_tasks_impl;
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    // 种子数学真题在前；逆序后应能读出新序
    let order = vec!["task_words".to_string(), "task_math".to_string()];
    reorder_tasks_impl(&db, &order).unwrap();
    let w: i64 = db.query_row("SELECT sort_order FROM tasks WHERE id='task_words'", [], |r| r.get(0)).unwrap();
    let m: i64 = db.query_row("SELECT sort_order FROM tasks WHERE id='task_math'", [], |r| r.get(0)).unwrap();
    assert!(w < m, "单词应排在数学之前，实际 单词={w}, 数学={m}");
}

#[test]
fn system_notify_setting_roundtrip() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    db.execute(
        "INSERT INTO settings (key, value) VALUES ('system_notify', 'false')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .unwrap();
    let s = focus_pomodoro_lib::db::load_settings(&db).unwrap();
    assert_eq!(s.system_notify, false, "应能读到 system_notify=false");
    assert_eq!(s.notify_enabled, true);
}

fn local_today_key(conn: &rusqlite::Connection) -> String {
    conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0)).unwrap()
}

// ── P1 写入链路：create/toggle/delete + 序列化边界 ─────────────────

use focus_pomodoro_lib::models::CreateTaskArgs;

#[test]
fn create_task_write_path() {
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let t = focus_pomodoro_lib::commands::tasks::create_task_impl(
        &db,
        CreateTaskArgs {
            title: "写入测试".into(),
            list_id: Some("list_default".into()),
            due_date: Some("2026-12-31".into()),
            est_pomodoros: Some(3.5),
            notes: Some("备注".into()),
        },
    )
    .unwrap();
    assert_eq!(t.title, "写入测试");
    assert_eq!(t.est_pomodoros, 3.5);
    assert_eq!(t.due_date.as_deref(), Some("2026-12-31"));

    // 读回
    let n: i64 = db.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 4);

    // 切换完成
    let toggled = focus_pomodoro_lib::commands::tasks::toggle_task_impl(&db, &t.id).unwrap();
    assert_eq!(toggled.completed, 1);
    assert!(toggled.completed_at.is_some());

    // 删除：任务消失，其记录 task_id 置空（种子数学真题有记录）
    let _ = focus_pomodoro_lib::commands::tasks::delete_task_impl(&db, "task_math").unwrap();
    let math_exists: i64 = db.query_row("SELECT COUNT(*) FROM tasks WHERE id='task_math'", [], |r| r.get(0)).unwrap();
    assert_eq!(math_exists, 0);
    let orphan: i64 = db.query_row("SELECT COUNT(*) FROM focus_records WHERE task_id IS NULL", [], |r| r.get(0)).unwrap();
    assert!(orphan >= 2, "数学真题的记录应转未指定，实际 {orphan}");
}

#[test]
fn create_task_args_deserialize_from_camelcase() {
    // 模拟前端 invoke 发送的负载（AddTask 只带 title + listId；copy 带全字段）
    let v = serde_json::json!({
        "title": "验证任务",
        "listId": "list_default",
        "estPomodoros": 2.0,
        "dueDate": "2026-12-31",
        "notes": "n"
    });
    let args: CreateTaskArgs = serde_json::from_value(v).expect("camelCase 反序列化应成功");
    assert_eq!(args.title, "验证任务");
    assert_eq!(args.list_id.as_deref(), Some("list_default"));
    assert_eq!(args.est_pomodoros, Some(2.0));
    assert_eq!(args.due_date.as_deref(), Some("2026-12-31"));
}

#[test]
fn missing_optional_args_are_none() {
    // 前端只传 title 时，其余字段应为 None（不会报缺字段）
    use focus_pomodoro_lib::models::CreateTaskArgs;
    let v = serde_json::json!({ "title": "only-title" });
    let args: CreateTaskArgs = serde_json::from_value(v).unwrap();
    assert_eq!(args.title, "only-title");
    assert!(args.list_id.is_none());
    assert!(args.due_date.is_none());
    assert!(args.est_pomodoros.is_none());
    assert!(args.notes.is_none());
}

#[test]
fn focus_record_create_path() {
    use focus_pomodoro_lib::models::CreateRecordArgs;
    let mut db = db::open_in_memory().unwrap();
    seeded(&mut db);
    let now = focus_pomodoro_lib::db_now();
    let r = focus_pomodoro_lib::commands::records::create_focus_record_impl(
        &db,
        CreateRecordArgs {
            task_id: Some("task_words".into()),
            list_id: Some("list_default".into()),
            start_at: now - 25 * 60_000,
            end_at: now,
            duration_min: 25,
        },
    )
    .unwrap();
    assert_eq!(r.duration_min, 25);
    assert_eq!(r.task_id.as_deref(), Some("task_words"));
}

