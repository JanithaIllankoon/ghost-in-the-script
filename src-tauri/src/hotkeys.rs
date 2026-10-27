//! System-wide hotkeys, so the prompter can be driven while Panopto (or anything else) has focus.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

/// Maps a registered shortcut id to the action name it triggers.
#[derive(Default)]
pub struct HotkeyMap(pub Mutex<HashMap<u32, String>>);

pub fn handler<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    let action = {
        let map = app.state::<HotkeyMap>();
        let guard = map.0.lock().unwrap();
        guard.get(&shortcut.id()).cloned()
    };
    if let Some(action) = action {
        run_action(app, &action);
    }
}

pub fn run_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    match action {
        "toggle-controls" => crate::toggle_window(app, "main"),
        "toggle-prompter" => crate::toggle_window(app, "prompter"),
        other => {
            let _ = app.emit_to("prompter", "gp:hotkey", other.to_string());
        }
    }
}

/// A hotkey that couldn't be registered, so the page can say which action is affected.
#[derive(Serialize)]
pub struct HotkeyProblem {
    action: String,
    keys: String,
    message: String,
}

/// Replaces every hotkey. Returns one entry per hotkey that could not be registered
/// (bad format, used twice, or already taken by another program).
#[tauri::command]
pub fn set_hotkeys(app: AppHandle, hotkeys: HashMap<String, String>) -> Vec<HotkeyProblem> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut map = HashMap::new();
    let mut problems = Vec::new();

    for (action, accel) in hotkeys {
        let accel = accel.trim();
        if accel.is_empty() {
            continue;
        }
        match Shortcut::from_str(accel) {
            Ok(sc) => {
                if map.contains_key(&sc.id()) {
                    problems.push(HotkeyProblem { action, keys: accel.into(), message: "used for two actions".into() });
                    continue;
                }
                match gs.register(sc) {
                    Ok(()) => {
                        map.insert(sc.id(), action);
                    }
                    Err(e) => problems.push(HotkeyProblem { action, keys: accel.into(), message: e.to_string() }),
                }
            }
            Err(e) => problems.push(HotkeyProblem { action, keys: accel.into(), message: e.to_string() }),
        }
    }

    *app.state::<HotkeyMap>().0.lock().unwrap() = map;
    problems
}
