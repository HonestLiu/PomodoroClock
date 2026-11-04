//! An independent desktop timer. Main webview owns all timer mutations and audio.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use crate::error::{AppError, AppResult};

const LABEL: &str = "desktop-orb";
fn dimensions(style: &str) -> (f64, f64) {
    match style { "orb" => (148.0, 168.0), "bar" => (124.0, 44.0), _ => (216.0, 134.0) }
}
#[derive(Default)]
pub struct OrbCache(pub Mutex<Option<serde_json::Value>>);
#[derive(Clone, Copy, Serialize, Deserialize)]
struct Position { x: i32, y: i32 }
fn require(window: &WebviewWindow, label: &str) -> AppResult<()> {
    if window.label() != label { return Err(AppError::msg("Window not allowed")); }
    Ok(())
}
/// Keep the entire small window on a connected monitor, including negative-coordinate displays.
fn clamp_position(p: Position, origin: (i32, i32), area: (u32, u32), size: (u32, u32)) -> Position {
    Position { x: p.x.clamp(origin.0, origin.0 + area.0.saturating_sub(size.0) as i32), y: p.y.clamp(origin.1, origin.1 + area.1.saturating_sub(size.1) as i32) }
}
fn position_orb(app: &AppHandle, window: &WebviewWindow, dimensions: (f64, f64)) -> AppResult<()> {
    let path = app.path().app_data_dir().map_err(|e| AppError::msg(e.to_string()))?.join("orb-position.json");
    let saved = std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice::<Position>(&bytes).ok());
    let monitors = window.available_monitors().map_err(|e| AppError::msg(e.to_string()))?;
    let monitor = saved.and_then(|p| monitors.iter().find(|m| {
        let area = m.work_area();
        p.x >= area.position.x && p.y >= area.position.y && p.x < area.position.x + area.size.width as i32 && p.y < area.position.y + area.size.height as i32
    })).cloned().or(window.primary_monitor().map_err(|e| AppError::msg(e.to_string()))?).or_else(|| monitors.first().cloned());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let size = ((dimensions.0 * scale).round() as u32, (dimensions.1 * scale).round() as u32);
        let default = Position { x: area.position.x + area.size.width as i32 - size.0 as i32 - (24.0 * scale) as i32, y: area.position.y + (96.0 * scale) as i32 };
        let p = clamp_position(saved.unwrap_or(default), (area.position.x, area.position.y), (area.size.width, area.size.height), size);
        window.set_position(PhysicalPosition::new(p.x, p.y)).map_err(|e| AppError::msg(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn orb_set_visible(app: AppHandle, window: WebviewWindow, visible: bool, style: Option<String>) -> AppResult<()> {
    require(&window, "main")?;
    if !visible {
        if let Some(orb) = app.get_webview_window(LABEL) { let _ = save_position(&app, &orb); orb.hide().map_err(|e| AppError::msg(e.to_string()))?; }
        return Ok(());
    }
    let size = dimensions(style.as_deref().unwrap_or("card"));
    let orb = match app.get_webview_window(LABEL) {
        Some(orb) => {
            let _ = save_position(&app, &orb);
            orb.set_size(tauri::LogicalSize::new(size.0, size.1)).map_err(|e| AppError::msg(e.to_string()))?;
            orb
        },
        None => WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("orb.html".into()))
            .title("FocusPomodoro Desktop Timer").inner_size(size.0, size.1)
            .decorations(false).transparent(true).background_color(tauri::window::Color(0, 0, 0, 0))
            .always_on_top(true).visible_on_all_workspaces(true).skip_taskbar(true)
            .resizable(false).maximizable(false).minimizable(false).shadow(false)
            .focused(false).accept_first_mouse(true).visible(false)
            .build().map_err(|e| AppError::msg(e.to_string()))?,
    };
    position_orb(&app, &orb, size)?;
    // Updating an already visible style must not take focus from the Settings radio group.
    if !orb.is_visible().map_err(|e| AppError::msg(e.to_string()))? {
        orb.show().map_err(|e| AppError::msg(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub fn orb_publish(app: AppHandle, window: WebviewWindow, cache: tauri::State<'_, OrbCache>, snapshot: serde_json::Value) -> AppResult<()> {
    require(&window, "main")?;
    let mut cache = cache.0.lock();
    let mut full = snapshot.clone();
    // Large custom wallpapers travel only when changed; retain one in the initial-load cache.
    if full.get("wallpaper").is_none() {
        if let Some(wallpaper) = cache.as_ref().and_then(|old| old.get("wallpaper")) {
            full["wallpaper"] = wallpaper.clone();
        }
    }
    *cache = Some(full);
    drop(cache);
    if app.get_webview_window(LABEL).is_some() {
        app.emit_to(LABEL, "orb://state", snapshot).map_err(|e| AppError::msg(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub fn orb_snapshot(window: WebviewWindow, cache: tauri::State<'_, OrbCache>) -> AppResult<Option<serde_json::Value>> {
    require(&window, LABEL)?;
    Ok(cache.0.lock().clone())
}
#[tauri::command]
pub fn orb_action(app: AppHandle, window: WebviewWindow, action: String) -> AppResult<()> {
    require(&window, LABEL)?;
    if !["toggle", "open", "hide"].contains(&action.as_str()) { return Err(AppError::msg("Unknown timer action")); }
    if action == "open" {
        let main = app.get_webview_window("main").ok_or_else(|| AppError::msg("Main window unavailable"))?;
        main.unminimize().map_err(|e| AppError::msg(e.to_string()))?;
        main.show().map_err(|e| AppError::msg(e.to_string()))?;
        main.set_focus().map_err(|e| AppError::msg(e.to_string()))?;
    }
    if action == "hide" { let _ = save_position(&app, &window); window.hide().map_err(|e| AppError::msg(e.to_string()))?; }
    app.emit_to("main", "orb://action", action).map_err(|e| AppError::msg(e.to_string()))?;
    Ok(())
}
#[tauri::command]
pub fn orb_save_position(app: AppHandle, window: WebviewWindow) -> AppResult<()> {
    require(&window, LABEL)?;
    save_position(&app, &window)
}
fn save_position(app: &AppHandle, window: &WebviewWindow) -> AppResult<()> {
    let p = window.outer_position().map_err(|e| AppError::msg(e.to_string()))?;
    let path = app.path().app_data_dir().map_err(|e| AppError::msg(e.to_string()))?.join("orb-position.json");
    std::fs::write(path, serde_json::to_vec(&Position { x: p.x, y: p.y })?)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn each_style_has_a_compact_native_frame() {
        assert_eq!(dimensions("card"), (216.0, 134.0));
        assert_eq!(dimensions("orb"), (148.0, 168.0));
        assert_eq!(dimensions("bar"), (124.0, 44.0));
        assert_eq!(dimensions("unknown"), dimensions("card"));
    }
    #[test]
    fn saved_position_is_clamped_to_real_monitor_bounds() {
        let p = clamp_position(Position { x: 4000, y: -100 }, (0, 40), (1920, 1040), (148, 168));
        assert_eq!((p.x, p.y), (1772, 40));
        let p = clamp_position(Position { x: -3000, y: 3000 }, (-1920, -200), (1920, 1080), (148, 168));
        assert_eq!((p.x, p.y), (-1920, 712));
        let p = clamp_position(Position { x: 99, y: 99 }, (0, 0), (100, 100), (148, 168));
        assert_eq!((p.x, p.y), (0, 0));
    }
}
