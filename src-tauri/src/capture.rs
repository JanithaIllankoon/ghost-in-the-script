//! Hides windows from screen capture (Panopto, OBS, Teams, Zoom, Snipping Tool...).
//!
//! Windows 10 2004+ supports WDA_EXCLUDEFROMCAPTURE: the window stays visible on
//! the monitor but every capture API (BitBlt, DXGI duplication, Windows.Graphics.Capture)
//! sees whatever is behind it instead.

use std::ffi::c_void;
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

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

fn read_affinity<R: Runtime>(window: &WebviewWindow<R>) -> Result<u32, String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let mut value: u32 = 0;
    let ok = unsafe { GetWindowDisplayAffinity(hwnd.0 as *mut c_void, &mut value) };
    if ok == 0 {
        return Err("GetWindowDisplayAffinity failed".into());
    }
    Ok(value)
}

fn write_affinity<R: Runtime>(window: &WebviewWindow<R>, hidden: bool) -> Result<u32, String> {
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
fn on_main<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
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

/// What the person asked for (the hide settings) and whether a screenshot window is open.
pub struct CaptureWanted(Mutex<Wanted>);

struct Wanted {
    prompter: bool,
    main: bool,
    seconds: u64,
    /// True while the windows are temporarily capturable for a screenshot.
    open: bool,
    /// Bumped on every screenshot request, so an older timer doesn't re-hide a newer window.
    generation: u64,
}

impl Default for CaptureWanted {
    fn default() -> Self {
        CaptureWanted(Mutex::new(Wanted { prompter: true, main: true, seconds: 5, open: false, generation: 0 }))
    }
}

const LABELS: [&str; 2] = ["prompter", "main"];

pub fn set_hidden<R: Runtime>(app: &AppHandle<R>, label: &str, hidden: bool) -> Result<CaptureState, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No window named {label}"))?;
    // While a screenshot window is open the new value is only remembered; it applies when the window closes.
    let defer = {
        let state = app.state::<CaptureWanted>();
        let mut w = state.0.lock().unwrap();
        match label {
            "prompter" => w.prompter = hidden,
            "main" => w.main = hidden,
            _ => {}
        }
        w.open
    };
    on_main(app, move || {
        let affinity = if defer { read_affinity(&window)? } else { write_affinity(&window, hidden)? };
        Ok(CaptureState {
            hidden: affinity == WDA_EXCLUDEFROMCAPTURE,
            affinity,
        })
    })
}

fn apply<R: Runtime>(app: &AppHandle<R>, label: &str, hidden: bool) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = on_main(app, move || write_affinity(&window, hidden).map(|_| ()));
    }
}

/// Makes both windows capturable for the configured number of seconds, then restores the hide settings.
/// Runs on its own thread because it waits on the UI thread, which may be the one calling this.
pub fn allow_screenshot<R: Runtime>(app: &AppHandle<R>) {
    let (seconds, generation) = {
        let state = app.state::<CaptureWanted>();
        let mut w = state.0.lock().unwrap();
        w.generation += 1;
        w.open = true;
        (w.seconds, w.generation)
    };
    let app = app.clone();
    std::thread::spawn(move || {
        for label in LABELS {
            apply(&app, label, false);
        }
        let _ = app.emit("gp:screenshot", seconds);
        std::thread::sleep(Duration::from_secs(seconds));
        let (prompter, main) = {
            let state = app.state::<CaptureWanted>();
            let mut w = state.0.lock().unwrap();
            if w.generation != generation {
                return;
            }
            w.open = false;
            (w.prompter, w.main)
        };
        apply(&app, "prompter", prompter);
        apply(&app, "main", main);
        let _ = app.emit("gp:screenshot-end", ());
    });
}

#[tauri::command]
pub fn set_screenshot_seconds(app: AppHandle, seconds: u64) {
    app.state::<CaptureWanted>().0.lock().unwrap().seconds = seconds.clamp(2, 30);
}

pub fn get_state<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<CaptureState, String> {
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
