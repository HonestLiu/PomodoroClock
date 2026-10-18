// 统计聚合 —— PRD §7.2 统计口径 / §7.3 日期分组
// 全部由 SQL 实时聚合，不做缓存（PRD §8.8-3）。

use rusqlite::params;
use tauri::State;

use crate::db::Db;
use crate::error::AppResult;
use crate::models::{
    Goal, GridCell, ListDistribution, ListDistributionItem, PomodoroGrid, Stats, TaskDuration,
    TaskDurations,
};

/// 生成区间边界 SQL：返回 (起点毫秒表达式, 终点毫秒表达式)，?1 为本地日期键
fn period_bounds(period: &str) -> (&'static str, &'static str) {
    match period {
        "week" => (
            "strftime('%s', date(?1,'-6 days','weekday 1') || ' 00:00:00','utc') * 1000",
            "strftime('%s', date(?1,'-6 days','weekday 1','+6 days') || ' 23:59:59','utc') * 1000",
        ),
        "month" => (
            "strftime('%s', date(?1,'start of month') || ' 00:00:00','utc') * 1000",
            "strftime('%s', date(?1,'start of month','+1 month','-1 day') || ' 23:59:59','utc') * 1000",
        ),
        "year" => (
            "strftime('%s', date(?1,'start of year') || ' 00:00:00','utc') * 1000",
            "strftime('%s', date(?1,'start of year','+1 year','-1 day') || ' 23:59:59','utc') * 1000",
        ),
        _ => (
            "strftime('%s', date(?1) || ' 00:00:00','utc') * 1000",
            "strftime('%s', date(?1) || ' 23:59:59','utc') * 1000",
        ),
    }
}

/// 6 统计卡片 + 每日目标派生指标（PRD §7.2 / FR-R2 / FR-R6）
#[tauri::command]
pub fn get_stats(db: State<'_, Db>) -> AppResult<Stats> {
    let conn = db.0.lock();
    compute_stats(&conn)
}

/// 纯统计口径（可测试）：接受 &Connection，与 get_stats 共用同一 SQL
pub fn compute_stats(conn: &rusqlite::Connection) -> AppResult<Stats> {
    let today_start = super::TODAY_START_MS;
    let today_end = super::TODAY_END_MS;
    let week_start = super::WEEK_START_MS;

    let total_focus_min: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration_min),0) FROM focus_records", [], |r| r.get(0))?;
    let week_focus_min: i64 = conn.query_row(
        &format!("SELECT COALESCE(SUM(duration_min),0) FROM focus_records WHERE start_at >= {week_start}"),
        [], |r| r.get(0))?;
    let today_focus_min: i64 = conn.query_row(
        &format!("SELECT COALESCE(SUM(duration_min),0) FROM focus_records WHERE start_at BETWEEN {today_start} AND {today_end}"),
        [], |r| r.get(0))?;

    let total_done_tasks: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE completed = 1", [], |r| r.get(0))?;
    let week_done_tasks: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM tasks WHERE completed = 1 AND completed_at >= {week_start}"),
        [], |r| r.get(0))?;
    let today_done_tasks: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM tasks WHERE completed = 1 AND completed_at BETWEEN {today_start} AND {today_end}"),
        [], |r| r.get(0))?;

    let daily_target_min: i64 = conn
        .query_row("SELECT daily_target_min FROM goals WHERE id = 'default'", [], |r| r.get(0))
        .unwrap_or(180);

    // 专注天数 / 完成目标天数（PRD §7.2）
    let mut stmt = conn.prepare(
        "SELECT date(start_at/1000,'unixepoch','localtime') AS d, SUM(duration_min)
         FROM focus_records GROUP BY d",
    )?;
    let days = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let focus_days = days.len() as i64;
    let goal_days = days.iter().filter(|(_, m)| *m >= daily_target_min).count() as i64;
    let goal_rate = if focus_days == 0 {
        0
    } else {
        ((goal_days as f64 / focus_days as f64) * 100.0).round() as i64
    };

    Ok(Stats {
        total_focus_min,
        week_focus_min,
        today_focus_min,
        total_done_tasks,
        week_done_tasks,
        today_done_tasks,
        focus_days,
        goal_days,
        goal_rate,
        daily_target_min,
    })
}

#[tauri::command]
pub fn get_goal(db: State<'_, Db>) -> AppResult<Goal> {
    let conn = db.0.lock();
    get_goal_impl(&conn)
}

pub fn get_goal_impl(conn: &rusqlite::Connection) -> AppResult<Goal> {
    let min = conn
        .query_row("SELECT daily_target_min FROM goals WHERE id = 'default'", [], |r| r.get(0))
        .unwrap_or(180);
    Ok(Goal { id: "default".into(), daily_target_min: min })
}

#[tauri::command]
pub fn set_goal(db: State<'_, Db>, minutes: f64) -> AppResult<Goal> {
    let conn = db.0.lock();
    set_goal_impl(&conn, minutes)
}

pub fn set_goal_impl(conn: &rusqlite::Connection, minutes: f64) -> AppResult<Goal> {
    // 与浏览器端 Math.max(0, Math.round(minutes)) 对齐：四舍五入后再夹紧
    let m = minutes.round().max(0.0) as i64;
    conn.execute(
        "INSERT INTO goals (id, daily_target_min) VALUES ('default', ?1)
         ON CONFLICT(id) DO UPDATE SET daily_target_min = excluded.daily_target_min",
        params![m],
    )?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('daily_target_min', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![m.to_string()],
    )?;
    Ok(Goal { id: "default".into(), daily_target_min: m })
}

/// 番茄记录图数据 —— PRD FR-R3
/// 每条记录映射到其开始时刻所在的 (本地日期, 小时) 网格单元。
#[tauri::command]
pub fn get_pomodoro_grid(db: State<'_, Db>, days: Option<i64>) -> AppResult<PomodoroGrid> {
    let conn = db.0.lock();
    pomodoro_grid_impl(&conn, days)
}

pub fn pomodoro_grid_impl(conn: &rusqlite::Connection, days: Option<i64>) -> AppResult<PomodoroGrid> {
    let n = days.unwrap_or(14).clamp(1, 90);

    // 近 n 天日期轴（今天起倒序）
    let mut stmt = conn.prepare(
        "WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i < ?1 - 1)
         SELECT date('now','localtime','-' || i || ' day') FROM seq",
    )?;
    let dates = stmt
        .query_map(params![n], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let wanted: std::collections::HashSet<&str> = dates.iter().map(|d| d.as_str()).collect();

    // 按 rowid/插入顺序取记录，与浏览器侧遍历 getDB().focus_records 的顺序一致。
    let modifier = format!("-{} day", n - 1);
    let mut stmt = conn.prepare(
        "SELECT date(start_at/1000,'unixepoch','localtime'), start_at, end_at
         FROM focus_records
         WHERE date(start_at/1000,'unixepoch','localtime') >= date('now','localtime',?1)
         ORDER BY rowid",
    )?;
    let records = stmt
        .query_map(params![modifier], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // 与浏览器侧 pomodoroGrid 逐字对齐：记录按分钟摊到每个经过的小时格，
    // 每个格子的 count 是「落进该格的记录片段数」；日期固定取记录开始日
    // （跨零点时仍归属开始日，与 TS 的 const dk = toDateKey(r.start_at) 一致）。
    let mut clock = conn.prepare(
        "SELECT CAST(strftime('%H', ?1/1000,'unixepoch','localtime') AS INTEGER),
                strftime('%s', strftime('%Y-%m-%d %H:59:59', ?1/1000,'unixepoch','localtime'), 'utc') * 1000 + 999",
    )?;
    let mut cells: Vec<GridCell> = Vec::new();
    let mut index: std::collections::HashMap<(String, i64), usize> = std::collections::HashMap::new();

    for (date_key, start_at, end_at) in records {
        if !wanted.contains(date_key.as_str()) {
            continue;
        }
        let mut cursor = start_at;
        let mut guard = 0;
        while cursor < end_at && guard < 1000 {
            guard += 1;
            let (hour, hour_end): (i64, i64) =
                clock.query_row(params![cursor], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let slice_end = end_at.min(hour_end);
            let mins = ((slice_end - cursor) as f64 / 60_000.0).round().max(1.0) as i64;
            let key = (date_key.clone(), hour);
            match index.get(&key) {
                Some(&i) => {
                    cells[i].minutes += mins;
                    cells[i].count += 1;
                }
                None => {
                    index.insert(key, cells.len());
                    cells.push(GridCell { date: date_key.clone(), hour, minutes: mins, count: 1 });
                }
            }
            cursor = slice_end + 1;
        }
    }

    Ok(PomodoroGrid { dates, cells })
}

/// 周期内按任务聚合专注时长 —— PRD FR-R4
#[tauri::command]
pub fn get_task_durations(
    db: State<'_, Db>,
    period: String,
    anchor_date: String,
) -> AppResult<TaskDurations> {
    let conn = db.0.lock();
    task_durations_impl(&conn, &period, &anchor_date)
}

pub fn task_durations_impl(
    conn: &rusqlite::Connection,
    period: &str,
    anchor_iso: &str,
) -> AppResult<TaskDurations> {
    let (from_expr, to_expr) = period_bounds(period);
    let sql = format!(
        "SELECT r.task_id, COALESCE(t.title,'未指定任务'), SUM(r.duration_min)
         FROM focus_records r LEFT JOIN tasks t ON t.id = r.task_id
         WHERE r.start_at BETWEEN {from_expr} AND {to_expr}
         GROUP BY r.task_id
         ORDER BY SUM(r.duration_min) DESC, MIN(r.start_at) ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let items = stmt
        .query_map(params![anchor_iso], |r| {
            Ok(TaskDuration {
                task_id: r.get(0)?,
                title: r.get(1)?,
                minutes: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let total = items.iter().map(|i| i.minutes).sum();
    Ok(TaskDurations { items, total })
}

/// 周期内按清单聚合专注时长 —— PRD FR-R5
#[tauri::command]
pub fn get_list_distribution(
    db: State<'_, Db>,
    period: String,
    anchor_date: String,
) -> AppResult<ListDistribution> {
    let conn = db.0.lock();
    list_distribution_impl(&conn, &period, &anchor_date)
}

pub fn list_distribution_impl(
    conn: &rusqlite::Connection,
    period: &str,
    anchor_iso: &str,
) -> AppResult<ListDistribution> {
    let (from_expr, to_expr) = period_bounds(period);
    let sql = format!(
        "SELECT r.list_id, COALESCE(l.name,'未指定任务'), SUM(r.duration_min)
         FROM focus_records r LEFT JOIN lists l ON l.id = r.list_id
         WHERE r.start_at BETWEEN {from_expr} AND {to_expr}
         GROUP BY r.list_id
         ORDER BY SUM(r.duration_min) DESC, MIN(r.start_at) ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let raw = stmt
        .query_map(params![anchor_iso], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let total: i64 = raw.iter().map(|(_, _, m)| *m).sum();
    let items = raw
        .into_iter()
        .map(|(list_id, name, minutes)| ListDistributionItem {
            list_id,
            name,
            minutes,
            percent: if total == 0 { 0 } else { ((minutes as f64 / total as f64) * 100.0).round() as i64 },
        })
        .collect();

    Ok(ListDistribution { items, total })
}
