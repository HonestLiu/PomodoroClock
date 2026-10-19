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

    // 「本周 = 本周一 00:00 起」（PRD §7.2）。种子按「今天/-1/-2」生成，
    // 今天是周一或周二时更早的种子日会落到上一周，本周**合法地**小于总时长。
    // 因此窗口在此用另一种写法独立重述一遍（`(dow+6)%7` 回推本周一，而非生产实现的
    // `'-6 days','weekday 1'`），而不是硬编码 539 —— 硬编码只在周三~周日成立。
    let week_start: i64 = db
        .query_row(
            "SELECT strftime('%s', date('now','localtime','-'
                || ((CAST(strftime('%w','now','localtime') AS INTEGER) + 6) % 7)
                || ' days') || ' 00:00:00','utc') * 1000",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let week_expected: i64 = db
        .query_row(
            "SELECT COALESCE(SUM(duration_min),0) FROM focus_records WHERE start_at >= ?1",
            [week_start],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(s.week_focus_min, week_expected, "本周 = 本周一 00:00 起的记录之和");
    // 本地星期几（0=周日）—— 测试自取，不依赖任何日期库
    let dow: i64 = db
        .query_row("SELECT CAST(strftime('%w','now','localtime') AS INTEGER)", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        s.week_focus_min == s.total_focus_min,
        dow > 2,
        "种子三天应落在同一周（今天是周{}时跨周，本周<总）",
        dow,
    );
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
    let g = focus_pomodoro_lib::commands::stats::set_goal_impl(&db, 120.0).unwrap();
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
            ..Default::default()
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

// ── 首启播种守卫 / 桌面端口径回归（docs/03「同一种子数据」红线） ─────────

#[test]
fn fresh_launch_seeds_screenshot_data_once() {
    let mut conn = db::open_in_memory().unwrap();
    db::ensure_bootstrap(&conn).unwrap();
    assert!(db::is_empty(&conn).unwrap(), "刚建库应为空");
    assert!(!db::demo_seeded(&conn).unwrap(), "刚建库还没播种");

    // 复刻 lib.rs setup 的播种判断
    if db::is_empty(&conn).unwrap() && !db::demo_seeded(&conn).unwrap() {
        db::seed_demo(&mut conn).unwrap();
        db::mark_demo_seeded(&conn).unwrap();
    }

    let count = |t: &str| -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(count("lists"), 1, "种子清单");
    assert_eq!(count("tasks"), 3, "种子任务");
    assert_eq!(count("focus_records"), 22, "种子专注记录");
    assert_eq!(count("notifications"), 25, "未读通知角标");

    let s = focus_pomodoro_lib::commands::stats::compute_stats(&conn).unwrap();
    assert_eq!(s.total_focus_min, 539);
    assert_eq!(s.today_focus_min, 20);

    // 「删除数据」后是空库，但 demo_seeded 必须阻止重启再次播种
    db::clear_all(&mut conn).unwrap();
    db::ensure_bootstrap(&conn).unwrap();
    db::mark_demo_seeded(&conn).unwrap();
    assert!(db::is_empty(&conn).unwrap());
    let should_seed = db::is_empty(&conn).unwrap() && !db::demo_seeded(&conn).unwrap();
    assert!(!should_seed, "清库后重启不应重新播种");
}

#[test]
fn update_task_patch_accepts_snake_case_fields() {
    use focus_pomodoro_lib::models::UpdateTaskPatch;
    let mut conn = db::open_in_memory().unwrap();
    seeded(&mut conn);

    // 前端 src/api/types.ts 的 UpdateTaskPatch 是 snake_case
    let patch: UpdateTaskPatch = serde_json::from_value(serde_json::json!({
        "list_id": null,
        "due_date": "2026-01-02",
        "est_pomodoros": 4.5,
        "sort_order": 9
    }))
    .expect("snake_case 补丁必须可反序列化");

    let t = focus_pomodoro_lib::commands::tasks::update_task_impl(&conn, "task_math", patch).unwrap();
    assert!(t.list_id.is_none(), "list_id=null 应写入 NULL");
    assert_eq!(t.due_date.as_deref(), Some("2026-01-02"));
    assert_eq!(t.est_pomodoros, 4.5);
    assert_eq!(t.sort_order, 9);
}

#[test]
fn reminder_fields_round_trip() {
    use focus_pomodoro_lib::models::{CreateTaskArgs, UpdateTaskPatch};
    let mut conn = db::open_in_memory().unwrap();
    seeded(&mut conn);

    // 建带全部提醒字段的任务（tags 走 Vec<String> -> JSON 落库）
    let created = focus_pomodoro_lib::commands::tasks::create_task_impl(
        &conn,
        CreateTaskArgs {
            title: "带提醒任务".into(),
            due_date: Some("2026-02-03".into()),
            due_time: Some("09:30".into()),
            url: Some("https://example.com".into()),
            urgent: Some(1),
            repeat: Some("weekly".into()),
            lead_remind: Some("1d".into()),
            tags: Some(vec!["重要".into(), "复习".into()]),
            flag: Some(1),
            priority: Some("high".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(created.due_time.as_deref(), Some("09:30"));
    assert_eq!(created.url, "https://example.com");
    assert_eq!(created.urgent, 1);
    assert_eq!(created.repeat, "weekly");
    assert_eq!(created.lead_remind, "1d");
    assert_eq!(created.tags, vec!["重要".to_string(), "复习".to_string()], "tags 应存为 JSON 并能解回");
    assert_eq!(created.flag, 1);
    assert_eq!(created.priority, "high");
    assert!(created.reminded_at.is_none(), "reminded_at 初始为 NULL");

    // patch 改部分字段（snake_case），tags 清空、due_time 置空
    let patch: UpdateTaskPatch = serde_json::from_value(serde_json::json!({
        "urgent": 0,
        "repeat": "daily",
        "tags": [],
        "due_time": null,
        "priority": "low",
        "reminded_at": 1770000000000i64
    }))
    .unwrap();
    let t = focus_pomodoro_lib::commands::tasks::update_task_impl(&conn, &created.id, patch).unwrap();
    assert_eq!(t.urgent, 0);
    assert_eq!(t.repeat, "daily");
    assert!(t.tags.is_empty(), "tags=[] 应清空");
    assert!(t.due_time.is_none(), "due_time=null 应写 NULL");
    assert_eq!(t.priority, "low");
    assert_eq!(t.reminded_at, Some(1770000000000), "reminded_at 写入去重标记");
    assert_eq!(t.url, "https://example.com", "未改字段保持不变");
}

#[test]
fn list_tasks_list_id_defaults_to_unfinished() {
    use focus_pomodoro_lib::models::ListTasksArgs;
    let mut conn = db::open_in_memory().unwrap();
    seeded(&mut conn);
    focus_pomodoro_lib::commands::tasks::toggle_task_impl(&conn, "task_words").unwrap();

    let args = ListTasksArgs {
        list_id: Some("list_default".into()),
        ..Default::default()
    };
    let rows = focus_pomodoro_lib::commands::tasks::list_tasks_impl(&conn, Some(args)).unwrap();
    assert_eq!(rows.len(), 2, "清单视图默认只返回未完成");
    assert!(rows.iter().all(|t| t.completed == 0));

    // 显式 completed=true 才取已完成
    let done_args = ListTasksArgs {
        list_id: Some("list_default".into()),
        completed: Some(true),
        ..Default::default()
    };
    let done = focus_pomodoro_lib::commands::tasks::list_tasks_impl(&conn, Some(done_args)).unwrap();
    assert_eq!(done.len(), 1);
    assert_eq!(done[0].id, "task_words");
}

#[test]
fn list_tasks_search_treats_wildcards_literally() {
    use focus_pomodoro_lib::models::ListTasksArgs;
    let mut conn = db::open_in_memory().unwrap();
    seeded(&mut conn);

    let wildcard = ListTasksArgs { search: Some("%".into()), ..Default::default() };
    let rows = focus_pomodoro_lib::commands::tasks::list_tasks_impl(&conn, Some(wildcard)).unwrap();
    assert!(rows.is_empty(), "%% 应按字面量匹配，不能命中全部任务");

    let hit = ListTasksArgs { search: Some("真题".into()), ..Default::default() };
    let rows = focus_pomodoro_lib::commands::tasks::list_tasks_impl(&conn, Some(hit)).unwrap();
    assert_eq!(rows.len(), 2);
}

#[test]
fn create_task_without_list_counts_null_group() {
    use focus_pomodoro_lib::models::CreateTaskArgs;
    let conn = db::open_in_memory().unwrap();
    db::ensure_bootstrap(&conn).unwrap();
    for i in 0..2 {
        conn.execute(
            "INSERT INTO tasks (id, list_id, title, sort_order, created_at, updated_at)
             VALUES (?1, NULL, 'x', 0, 0, 0)",
            rusqlite::params![format!("t{i}")],
        )
        .unwrap();
    }
    let t = focus_pomodoro_lib::commands::tasks::create_task_impl(
        &conn,
        CreateTaskArgs {
            title: "无清单".into(),
            list_id: None,
            due_date: None,
            est_pomodoros: None,
            notes: None,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(t.list_id.is_none());
    assert_eq!(t.sort_order, 2, "只统计未指定清单分组");
}

#[test]
fn grid_splits_record_across_hours_like_browser() {
    let conn = db::open_in_memory().unwrap();
    db::ensure_bootstrap(&conn).unwrap();
    let (start, end): (i64, i64) = conn.query_row(
        "SELECT strftime('%s', date('now','localtime') || ' 09:30:00','utc') * 1000,
                strftime('%s', date('now','localtime') || ' 10:30:00','utc') * 1000",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap();
    conn.execute(
        "INSERT INTO focus_records (id, start_at, end_at, duration_min, created_at)
         VALUES ('fr_split', ?1, ?2, 60, ?1)",
        rusqlite::params![start, end],
    )
    .unwrap();

    let g = focus_pomodoro_lib::commands::stats::pomodoro_grid_impl(&conn, Some(1)).unwrap();
    let at = |h: i64| g.cells.iter().find(|c| c.hour == h).map(|c| (c.minutes, c.count));
    assert_eq!(at(9), Some((30, 1)), "09 点格摊 30 分钟");
    assert_eq!(at(10), Some((30, 1)), "10 点格摊 30 分钟");
}

