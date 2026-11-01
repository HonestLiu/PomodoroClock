// 原生托盘菜单：计时操作留在后台，导航操作由 lib.rs 唤起主窗口。
use serde::Deserialize;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, State};
use crate::error::AppResult;

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayTask {
    id: String,
    title: String,
    selected: bool,
}
#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuSnapshot {
    status: String,
    today: String,
    toggle: String,
    finish: String,
    controls_enabled: bool,
    finish_enabled: bool,
    task_menu_enabled: bool,
    task_menu_title: String,
    no_task_label: String,
    no_task_selected: bool,
    task_browse_label: String,
    tasks: Vec<TrayTask>,
    float_label: String,
    float_checked: bool,
    noise_label: String,
    noise_checked: bool,
    open_timer_label: String,
    today_label: String,
    report_label: String,
    settings_label: String,
    quit_label: String,
}
pub struct TrayState {
    status: MenuItem<tauri::Wry>,
    today: MenuItem<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    finish: MenuItem<tauri::Wry>,
    tasks: Submenu<tauri::Wry>,
    float: CheckMenuItem<tauri::Wry>,
    noise: CheckMenuItem<tauri::Wry>,
    navigation: Vec<MenuItem<tauri::Wry>>,
    last_snapshot: std::sync::Mutex<Option<TrayMenuSnapshot>>,
    /// 已设置阶段（红色番茄 / 蓝色双叶），避免重复替换图标。
    pub last_phase: std::sync::Mutex<String>,
}
pub fn build_menu(app: &tauri::App) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::Manager;
    let status = MenuItemBuilder::with_id("tray-status", "正在载入计时状态…").enabled(false).build(app)?;
    let today = MenuItemBuilder::with_id("tray-summary", "今日专注 —").enabled(false).build(app)?;
    let toggle = MenuItemBuilder::with_id("tray-toggle", "开始专注").enabled(false).build(app)?;
    let finish = MenuItemBuilder::with_id("tray-finish", "结束本次专注并保存").enabled(false).build(app)?;
    let tasks = SubmenuBuilder::with_id(app, "tray-task-menu", "选择任务开始专注").enabled(false).build()?;
    let float = CheckMenuItemBuilder::with_id("tray-float", "悬浮计时窗").checked(true).build(app)?;
    let noise = CheckMenuItemBuilder::with_id("tray-noise", "白噪音").checked(false).build(app)?;
    let navigation = [
        ("tray-open-timer", "打开专注面板"), ("tray-today", "今日任务"),
        ("tray-report", "专注报表"), ("tray-settings", "设置…"), ("tray-quit", "退出应用"),
    ].into_iter().map(|(id, label)| MenuItemBuilder::with_id(id, label).build(app)).collect::<tauri::Result<Vec<_>>>()?;
    let menu = MenuBuilder::new(app)
        .item(&status).item(&today).separator()
        .item(&toggle).item(&finish).item(&tasks).separator()
        .item(&float).item(&noise).separator()
        .item(&navigation[0]).item(&navigation[1]).item(&navigation[2]).item(&navigation[3])
        .separator().item(&navigation[4]).build()?;
    app.manage(TrayState { status, today, toggle, finish, tasks, float, noise, navigation,
        last_snapshot: std::sync::Mutex::new(None), last_phase: std::sync::Mutex::new(String::new()) });
    Ok(menu)
}

/// 前端仅在快照变化时同步；原生侧再逐字段去重，避免计时中反复重建菜单。
#[tauri::command]
pub fn update_tray_menu(app: AppHandle, state: State<'_, TrayState>, snapshot: TrayMenuSnapshot, force: bool) -> AppResult<()> {
    apply_snapshot(app, &state, snapshot, force).map_err(|_| crate::error::AppError::msg("菜单栏更新失败"))
}
fn apply_snapshot(app: AppHandle, state: &TrayState, snapshot: TrayMenuSnapshot, force: bool) -> tauri::Result<()> {
    let mut cached = state.last_snapshot.lock().unwrap();
    let old = if force { None } else { cached.as_ref() };
    macro_rules! text {
        ($item:expr, $field:ident) => {
            if old.map(|s| &s.$field) != Some(&snapshot.$field) { $item.set_text(snapshot.$field.replace('&', "&&"))?; }
        };
    }
    text!(state.status, status);
    text!(state.today, today);
    text!(state.toggle, toggle);
    text!(state.finish, finish);
    text!(state.tasks, task_menu_title);
    text!(state.float, float_label);
    text!(state.noise, noise_label);
    let labels = [&snapshot.open_timer_label, &snapshot.today_label, &snapshot.report_label, &snapshot.settings_label, &snapshot.quit_label];
    let prior = old.map(|s| [&s.open_timer_label, &s.today_label, &s.report_label, &s.settings_label, &s.quit_label]);
    for (index, label) in labels.iter().enumerate() {
        if prior.as_ref().map(|p| p[index]) != Some(*label) { state.navigation[index].set_text(label)?; }
    }
    if old.map(|s| s.controls_enabled) != Some(snapshot.controls_enabled) { state.toggle.set_enabled(snapshot.controls_enabled)?; }
    if old.map(|s| s.finish_enabled) != Some(snapshot.finish_enabled) { state.finish.set_enabled(snapshot.finish_enabled)?; }
    if old.map(|s| s.task_menu_enabled) != Some(snapshot.task_menu_enabled) { state.tasks.set_enabled(snapshot.task_menu_enabled)?; }
    if old.map(|s| s.float_checked) != Some(snapshot.float_checked) { state.float.set_checked(snapshot.float_checked)?; }
    if old.map(|s| s.noise_checked) != Some(snapshot.noise_checked) { state.noise.set_checked(snapshot.noise_checked)?; }
    if old.map(|s| (&s.tasks, &s.no_task_label, s.no_task_selected, &s.task_browse_label))
        != Some((&snapshot.tasks, &snapshot.no_task_label, snapshot.no_task_selected, &snapshot.task_browse_label)) {
        while state.tasks.remove_at(0)?.is_some() {}
        state.tasks.append(&CheckMenuItemBuilder::with_id("tray-task:none", &snapshot.no_task_label).checked(snapshot.no_task_selected).build(&app)?)?;
        for task in snapshot.tasks.iter().take(6) {
            state.tasks.append(&CheckMenuItemBuilder::with_id(format!("tray-task:{}", task.id), task.title.replace('&', "&&")).checked(task.selected).build(&app)?)?;
        }
        state.tasks.append(&tauri::menu::PredefinedMenuItem::separator(&app)?)?;
        state.tasks.append(&MenuItemBuilder::with_id("tray-tasks", &snapshot.task_browse_label).build(&app)?)?;
    }
    *cached = Some(snapshot);
    Ok(())
}

#[tauri::command]
pub fn update_tray_title(app: AppHandle, text: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_title(if text.is_empty() { None } else { Some(text.as_str()) }).map_err(|_| crate::error::AppError::msg("菜单栏更新失败"))?;
    }
    Ok(())
}
#[tauri::command]
pub fn set_tray_phase(app: AppHandle, state: State<'_, TrayState>, phase: String) -> AppResult<()> {
    let phase = if phase == "break" { "break" } else { "focus" };
    let mut last = state.last_phase.lock().unwrap();
    if *last == phase { return Ok(()); }
    if let Some(tray) = app.tray_by_id("main") {
        let icon = if phase == "break" { tauri::include_image!("icons/tray-break.png") } else { tauri::include_image!("icons/tray-focus.png") };
        tray.set_icon(Some(icon)).map_err(|_| crate::error::AppError::msg("菜单栏图标更新失败"))?;
        *last = phase.to_string();
    }
    Ok(())
}
