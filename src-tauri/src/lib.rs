// FocusPomodoro —— Tauri 2.x 桌面应用后端
// 分层：commands（§8.4 invoke 接口）/ db（§6.2 迁移）/ timer_engine（§7.1）

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod timer_engine;

use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

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
            let mut conn = db::open(&dir.join("focus.db"))?;

            // 迁移后初始化默认用户 / 每日目标 / 计时状态（PRD §6.2）
            db::ensure_bootstrap(&conn)?;

            // 首启还原 PRD §6.3 截图数据（与浏览器侧 buildSeed 同一种子）。
            // 守卫：只有「空库 + 从未播种」才写；删除数据/注销会写 demo_seeded=1，
            // 避免用户清库后每次启动又被重新播种。
            if db::is_empty(&conn)? && !db::demo_seeded(&conn)? {
                db::seed_demo(&mut conn)?;
                db::mark_demo_seeded(&conn)?;
            }

            app.manage(db::Db(parking_lot::Mutex::new(conn)));

            // macOS: titleBarStyle:Overlay 保留系统红黄绿 + 圆角；
            // Windows/Linux: 去掉系统标题栏，改用前端自绘按钮（PRD §8.7）
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_decorations(false);
                }
            }

            // macOS 菜单栏番茄钟：图标 + 倒计时文字 + 简化功能菜单（PRD §5.4 FR-P3）
            let toggle_item = MenuItemBuilder::with_id("tray-toggle", "开始专注")
                .build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .text("tray-open", "打开主窗口")
                .separator()
                .item(&toggle_item)
                .text("tray-skip", "跳过当前阶段")
                .separator()
                .text("tray-report", "报表")
                .text("tray-settings", "设置")
                .separator()
                .quit_with_text("退出")
                .build()?;

            app.manage(commands::tray::TrayState { toggle: toggle_item });

            let _tray = TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray-focus.png"))
                .icon_as_template(false) // 彩色图标：红=专注 蓝=休息
                .tooltip("FocusPomodoro")
                .menu(&tray_menu)
                .show_menu_on_left_click(true) // 单击弹出菜单
                .on_menu_event(|app, event| {
                    match event.id().0.as_str() {
                        "tray-open" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "tray-quit" => app.exit(0),
                        // 其余动作转交前端处理（toggle / skip / report / settings）
                        other => {
                            let _ = app.emit("tray://menu", other.to_string());
                        }
                    }
                })
                .build(app)?;

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
            // 菜单栏番茄钟
            commands::tray::update_tray_title,
            commands::tray::update_tray_toggle,
            commands::tray::set_tray_phase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusPomodoro");
}
