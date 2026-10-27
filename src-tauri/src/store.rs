//! Saves scripts and settings as one JSON file in %APPDATA%\app.ghostprompter.desktop.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("data.json"))
}

#[tauri::command]
pub fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_data(app: AppHandle, json: String) -> Result<(), String> {
    let path = data_path(&app)?;
    // Write to a temp file first so a crash mid-write never corrupts the scripts.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
