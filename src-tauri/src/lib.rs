// FocusPomodoro —— Tauri 2.x 桌面应用后端
// 分层：commands（§8.4 invoke 接口）/ db（§6.2 迁移）/ timer_engine（§7.1）

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod timer_engine;

use tauri::Manager;

/// 当前本地时间戳（毫秒）
pub fn db_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // SQLite 位于 app_data_dir/focus.db（PRD §8.6）
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("focus.db"))?;

            // 迁移后初始化默认用户；不再写入截图演示数据，报表/清单展示真实数据（PRD §6.2 / §8.8-3）
            db::ensure_bootstrap(&conn)?;

            app.manage(db::Db(parking_lot::Mutex::new(conn)));

            // macOS: titleBarStyle:Overlay 保留系统红黄绿 + 圆角；
            // Windows/Linux: 去掉系统标题栏，改用前端自绘按钮（PRD §8.7）
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_decorations(false);
                }
            }

            // 计时时钟源（PRD §8.5）
            timer_engine::spawn_ticker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 用户
            commands::user::get_user,
            commands::user::update_user,
            commands::user::pick_avatar,
            commands::user::logout,
            commands::user::clear_all_data,
            // 清单
            commands::lists::list_lists,
            commands::lists::create_list,
            commands::lists::rename_list,
            commands::lists::delete_list,
            commands::lists::reorder_lists,
            commands::lists::get_default_list,
            commands::lists::set_default_list,
            // 任务
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::toggle_task,
            commands::tasks::reorder_tasks,
            commands::tasks::delete_task,
            // 专注记录
            commands::records::create_focus_record,
            commands::records::list_focus_records,
            // 统计
            commands::stats::get_stats,
            commands::stats::get_goal,
            commands::stats::set_goal,
            commands::stats::get_pomodoro_grid,
            commands::stats::get_task_durations,
            commands::stats::get_list_distribution,
            // 设置与计时
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::settings::get_timer_state,
            commands::settings::set_timer_state,
            // 通知
            commands::notify::list_notifications,
            commands::notify::create_notification,
            commands::notify::mark_notif_read,
            commands::notify::mark_all_notifs_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusPomodoro");
}
