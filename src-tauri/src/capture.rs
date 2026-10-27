//! Hides windows from screen capture (Panopto, OBS, Teams, Zoom, Snipping Tool...).
//!
//! Windows 10 2004+ supports WDA_EXCLUDEFROMCAPTURE: the window stays visible on
//! the monitor but every capture API (BitBlt, DXGI duplication, Windows.Graphics.Capture)
//! sees whatever is behind it instead.

use std::ffi::c_void;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

const WDA_NONE: u32 = 0x0;
const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;

#[link(name = "user32")]
extern "system" {
    fn SetWindowDisplayAffinity(hwnd: *mut c_void, affinity: u32) -> i32;
    fn GetWindowDisplayAffinity(hwnd: *mut c_void, affinity: *mut u32) -> i32;
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct CaptureState {
    /// What Windows reports right now for this window.
    pub hidden: bool,
    /// Raw affinity value (0 = none, 0x11 = excluded from capture, 0x1 = shows as black).
    pub affinity: u32,
}

fn read_affinity(window: &WebviewWindow) -> Result<u32, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut value: u32 = 0;
    let ok = unsafe { GetWindowDisplayAffinity(hwnd.0 as *mut c_void, &mut value) };
    if ok == 0 {
        return Err("GetWindowDisplayAffinity failed".into());
    }
    Ok(value)
}

fn write_affinity(window: &WebviewWindow, hidden: bool) -> Result<u32, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let wanted = if hidden { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as *mut c_void, wanted) };
    if ok == 0 {
        return Err(
            "Windows refused to change capture visibility (needs Windows 10 version 2004 or newer)"
                .into(),
        );
    }
    read_affinity(window)
}

/// Runs a closure on the UI thread (the thread that owns the windows) and waits for the result.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "Timed out talking to the window".to_string())?
}

pub fn set_hidden(app: &AppHandle, label: &str, hidden: bool) -> Result<CaptureState, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No window named {label}"))?;
    on_main(app, move || {
        let affinity = write_affinity(&window, hidden)?;
        Ok(CaptureState {
            hidden: affinity == WDA_EXCLUDEFROMCAPTURE,
            affinity,
        })
    })
}

pub fn get_state(app: &AppHandle, label: &str) -> Result<CaptureState, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No window named {label}"))?;
    on_main(app, move || {
        let affinity = read_affinity(&window)?;
        Ok(CaptureState {
            hidden: affinity == WDA_EXCLUDEFROMCAPTURE,
            affinity,
        })
    })
}

#[tauri::command]
pub async fn set_capture_hidden(
    app: AppHandle,
    label: String,
    hidden: bool,
) -> Result<CaptureState, String> {
    set_hidden(&app, &label, hidden)
}

#[tauri::command]
pub async fn capture_state(app: AppHandle, label: String) -> Result<CaptureState, String> {
    get_state(&app, &label)
}
