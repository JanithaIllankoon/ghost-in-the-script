mod capture;
mod hotkeys;
mod store;
mod voice;
mod vosk;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, Runtime, WindowEvent};
use tauri_plugin_window_state::StateFlags;

pub fn show_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn toggle_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible {
            let _ = w.hide();
        } else {
            show_window(app, label);
        }
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    voice::stop_all(&app);
    app.exit(0);
}

pub const REPO_URL: &str = "https://github.com/JanithaIllankoon/ghost-in-the-script";

/// Opens the project's GitHub page in the default browser. The URL is fixed on purpose:
/// the page can't ask this command to open anything else.
#[tauri::command]
fn open_github(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(REPO_URL, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn run_action(app: AppHandle, action: String) {
    hotkeys::run_action(&app, &action);
}

/// First launch only: put the prompter at the top-centre of the main screen, under the webcam.
fn place_prompter_first_run(app: &AppHandle) {
    let state_file = app
        .path()
        .app_config_dir()
        .map(|d| d.join(tauri_plugin_window_state::DEFAULT_FILENAME));
    if matches!(state_file, Ok(ref p) if p.exists()) {
        return;
    }
    let Some(w) = app.get_webview_window("prompter") else { return };
    if let (Ok(Some(monitor)), Ok(size)) = (w.primary_monitor(), w.outer_size()) {
        let m = monitor.size();
        let pos = monitor.position();
        let x = pos.x + (m.width as i32 - size.width as i32) / 2;
        let y = pos.y + 16;
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show controls", true, None::<&str>)?;
    let prompter = MenuItem::with_id(app, "prompter", "Show / hide prompter", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "Play / pause", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ghost In The Script", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &prompter, &play, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("tray")
        .tooltip("Ghost In The Script")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app, "main"),
            "prompter" => toggle_window(app, "prompter"),
            "play" => hotkeys::run_action(app, "play-pause"),
            "quit" => {
                voice::stop_all(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle(), "main");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app, "main");
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::handler)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(hotkeys::HotkeyMap::default())
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            store::load_data,
            store::save_data,
            capture::set_capture_hidden,
            capture::capture_state,
            hotkeys::set_hotkeys,
            voice::voice_devices,
            voice::voice_start,
            voice::voice_stop,
            quit_app,
            run_action,
            open_github,
        ])
        .setup(|app| {
            place_prompter_first_run(app.handle());
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    // Closing the prompter just hides it; it comes back from the controls or tray.
                    "prompter" => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    // Closing the controls window quits the whole app.
                    "main" => {
                        voice::stop_all(window.app_handle());
                        window.app_handle().exit(0);
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Ghost In The Script");
}
