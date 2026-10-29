// FocusPomodoro —— Tauri 2.x 桌面应用后端
// 分层：commands（§8.4 invoke 接口）/ db（§6.2 迁移）/ timer_engine（§7.1）

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod timer_engine;

use tauri::{Emitter, Manager};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;

/// 当前本地时间戳（毫秒）
pub fn db_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 应用菜单栏（macOS 原生：Cmd+, 设置、Cmd+N 新建任务、Cmd+R 报表等）。
/// 点击项通过 `menu://command` 事件转发给前端（仅转发自定义 menu-* id，
/// 其余为系统角色项由 OS 原生处理）。
fn setup_app_menu(app: &tauri::App) -> tauri::Result<()> {
    let settings = MenuItemBuilder::with_id("menu-settings", "设置…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let new_task = MenuItemBuilder::with_id("menu-new-task", "新建任务")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_list = MenuItemBuilder::with_id("menu-new-list", "新建清单")
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let new_folder = MenuItemBuilder::with_id("menu-new-folder", "新建清单夹")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let report = MenuItemBuilder::with_id("menu-report", "报表")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    // 应用菜单（macOS 首个子菜单即应用名菜单，承载 关于/设置/退出）
    let app_menu = SubmenuBuilder::new(app, "FocusPomodoro")
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(&settings)
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "文件")
        .item(&new_task)
        .item(&new_list)
        .item(&new_folder)
        .separator()
        .item(&report)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "视图")
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "窗口")
        .minimize()
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // 开机自启（PRD FR-S3 通用页）：macOS 用 LaunchAgent，Windows 注册表 Run，Linux autostart
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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

            // 应用菜单栏：设置(Cmd+,) / 新建任务(Cmd+N) / 报表(Cmd+R) 等（替代 Tauri 默认菜单）
            setup_app_menu(app)?;

            // macOS: titleBarStyle:Overlay 保留系统红黄绿 + 圆角；
            // Windows/Linux: 去掉系统标题栏，改用前端自绘按钮（PRD §8.7）
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_decorations(false);
                }
            }

            // macOS 菜单栏番茄钟：图标 + 倒计时文字 + 功能菜单（PRD §5.4 FR-P3）
            let toggle_item = MenuItemBuilder::with_id("tray-toggle", "开始专注")
                .build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .text("tray-open", "打开主窗口")
                .separator()
                .item(&toggle_item)
                .text("tray-skip", "跳过当前阶段")
                .text("tray-open-timer", "专注界面")
                .separator()
                .text("tray-new-task", "新建任务")
                .text("tray-new-list", "新建清单")
                .text("tray-new-folder", "新建清单夹")
                .separator()
                .text("tray-report", "报表")
                .text("tray-settings", "设置")
                .separator()
                .quit_with_text("退出")
                .build()?;

            app.manage(commands::tray::TrayState {
                toggle: toggle_item,
                last_phase: std::sync::Mutex::new(String::new()),
            });

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
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            // 仅转发自定义项（menu-*）；系统角色项（关于/退出/最小化…）由 OS 原生处理
            if id.starts_with("menu-") {
                let _ = app.emit("menu://command", id.to_string());
            }
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
            commands::lists::set_list_folder,
            commands::lists::set_list_icon,
            // 倒数纪念日（独立数据域，本地优先）
            commands::countdown::list_countdowns,
            commands::countdown::create_countdown,
            commands::countdown::update_countdown,
            commands::countdown::delete_countdown,
            commands::countdown::reorder_countdowns,
            commands::countdown::mark_countdown_reminded,
            // 清单夹
            commands::folders::list_folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::update_folder,
            commands::folders::delete_folder,
            commands::folders::reorder_folders,
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
            // 多端同步
            commands::sync::sync_dirty_batch,
            commands::sync::sync_rows_by_ids,
            commands::sync::sync_apply,
            commands::sync::sync_ack,
            commands::sync::sync_pending_counts,
            commands::sync::sync_reset_rows,
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
