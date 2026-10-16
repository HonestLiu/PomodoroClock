// macOS 菜单栏番茄钟 —— Tray 菜单 + 倒计时（PRD §5.4 FR-P3）
// 前端通过 invoke 驱动菜单栏文字/图标更新；菜单事件通过 emit 通知前端。

use tauri::menu::MenuItem;
use tauri::{AppHandle, State};
use crate::error::AppResult;

/// Tray 菜单中需要动态更新文字的「开始/暂停」菜单项
pub struct TrayState {
    pub toggle: MenuItem<tauri::Wry>,
}

/// 更新菜单栏 Tray 图标旁的倒计时文字（空字符串清空）
#[tauri::command]
pub fn update_tray_title(app: AppHandle, text: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let title: Option<&str> = if text.is_empty() { None } else { Some(&text) };
        let _ = tray.set_title(title);
    }
    Ok(())
}

/// 更新 Tray 菜单中「开始/暂停」菜单项的文字
#[tauri::command]
pub fn update_tray_toggle(state: State<'_, TrayState>, text: String) -> AppResult<()> {
    state.toggle.set_text(text).map_err(|e| crate::error::AppError::msg(e.to_string()))?;
    Ok(())
}

/// 切换菜单栏图标颜色：focus=红 / break=蓝（PRD §5.4）
#[tauri::command]
pub fn set_tray_phase(app: AppHandle, phase: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let icon = if phase == "break" {
            tauri::include_image!("icons/tray-break.png")
        } else {
            tauri::include_image!("icons/tray-focus.png")
        };
        let _ = tray.set_icon(Some(icon));
    }
    Ok(())
}