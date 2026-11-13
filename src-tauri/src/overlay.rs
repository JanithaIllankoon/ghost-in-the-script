use std::ffi::c_void;
use std::io::Write;
use std::time::{Duration, Instant};

use tauri::{Runtime, WebviewWindow};

type Hwnd = *mut c_void;

#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> Hwnd;
    fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
    fn IsWindow(hwnd: Hwnd) -> i32;
    fn IsWindowVisible(hwnd: Hwnd) -> i32;
    fn IsIconic(hwnd: Hwnd) -> i32;
    fn SetWindowPos(hwnd: Hwnd, after: Hwnd, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
    fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
    fn GetWindowLongW(hwnd: Hwnd, index: i32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> *mut c_void;
    fn QueryFullProcessImageNameW(process: *mut c_void, flags: u32, name: *mut u16, size: *mut u32) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmGetWindowAttribute(hwnd: Hwnd, attribute: u32, value: *mut u32, size: u32) -> i32;
    fn DwmFlush() -> i32;
}

fn diagnostic(message: &str) {
    let Some(path) = std::env::var_os("GHOST_OVERLAY_LOG") else { return };
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let _ = writeln!(file, "{} {message}", time.as_millis());
    }
}

fn is_photos(hwnd: Hwnd) -> bool {
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
    if process_id == 0 {
        return false;
    }
    unsafe {
        let process = OpenProcess(0x1000, 0, process_id); // PROCESS_QUERY_LIMITED_INFORMATION
        if process.is_null() {
            return false;
        }
        let mut name = [0_u16; 1024];
        let mut size = name.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, name.as_mut_ptr(), &mut size);
        CloseHandle(process);
        ok != 0 && is_photos_path(&String::from_utf16_lossy(&name[..size as usize]))
    }
}

fn is_photos_path(path: &str) -> bool {
    let name = path.rsplit('\\').next().unwrap_or(path);
    name.eq_ignore_ascii_case("Photos.exe") || name.eq_ignore_ascii_case("Microsoft.Photos.exe")
}

fn can_refresh(visible: bool, minimized: bool, cloaked: u32) -> bool {
    visible && !minimized && cloaked == 0
}

/// Refresh the native composition surface as well as WebView2. The Photos failure
/// can leave every HWND visible, so a DOM visibility check alone cannot detect it.
pub fn refresh<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    repair(window, true)
}

fn repair<R: Runtime>(window: &WebviewWindow<R>, reset_surface: bool) -> tauri::Result<()> {
    let hwnd = window.hwnd()?.0 as usize;
    let window_state = window.clone();
    window.with_webview(move |webview| unsafe {
        let hwnd = hwnd as Hwnd;
        let mut cloaked = 0;
        if DwmGetWindowAttribute(hwnd, 14, &mut cloaked, 4) < 0 {
            diagnostic("refresh skipped: DWM state unavailable");
            return;
        }
        let visible = IsWindowVisible(hwnd) != 0;
        let minimized = IsIconic(hwnd) != 0;
        let topmost = window_state.is_always_on_top().unwrap_or(false);
        let controller = webview.controller();
        let mut webview_visible = Default::default();
        let _ = controller.IsVisible(&mut webview_visible);
        diagnostic(&format!("repair reset_surface={reset_surface} visible={visible} minimized={minimized} cloak={cloaked} topmost={topmost} exstyle={:X} webview_visible={}", GetWindowLongW(hwnd, -20), webview_visible.as_bool()));
        // Check on the UI thread, immediately before the refresh. A queued recovery
        // must never undo Hide Prompter or pull a window from another desktop.
        if !can_refresh(visible, minimized, cloaked) {
            return;
        }
        // Preserve position, size, activation, click-through and capture affinity.
        const KEEP_WINDOW: u32 = 0x0001 | 0x0002 | 0x0004 | 0x0010;
        const SWP_HIDEWINDOW: u32 = 0x0080;
        const SWP_SHOWWINDOW: u32 = 0x0040;
        if !reset_surface {
            if topmost {
                let raised = SetWindowPos(hwnd, -1_isize as Hwnd, 0, 0, 0, 0, KEEP_WINDOW & !0x0004);
                diagnostic(&format!("raised={raised}"));
            }
            return;
        }
        if SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, KEEP_WINDOW | SWP_HIDEWINDOW) == 0 {
            diagnostic(&format!("native hide failed: {}", std::io::Error::last_os_error()));
            return;
        }
        // Commit the hidden surface before showing it, so DWM cannot coalesce the
        // two operations into a no-op. No JS visibility polling can run mid-refresh.
        let flush = DwmFlush();
        let (after, flags) = if topmost {
            (-1_isize as Hwnd, KEEP_WINDOW & !0x0004)
        } else {
            (std::ptr::null_mut(), KEEP_WINDOW)
        };
        // Reassert the configured topmost order; Photos can itself be topmost.
        if SetWindowPos(hwnd, after, 0, 0, 0, 0, flags | SWP_SHOWWINDOW | 0x0020 | 0x0100) == 0 {
            diagnostic(&format!("native show failed: {}", std::io::Error::last_os_error()));
            ShowWindow(hwnd, 8); // SW_SHOWNA: restore visibility without activation.
        }
        let hide = controller.SetIsVisible(false);
        let show = controller.SetIsVisible(true);
        diagnostic(&format!("refreshed flush={flush} visible={} exstyle={:X} webview_hide={hide:?} webview_show={show:?}", IsWindowVisible(hwnd) != 0, GetWindowLongW(hwnd, -20)));
    })
}

#[derive(Default)]
struct PhotosTransition {
    foreground: usize,
    photos: bool,
    repair_at: Option<(Instant, RecoveryAction)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecoveryAction {
    Raise,
    Refresh,
}

impl PhotosTransition {
    fn foreground_changed(&mut self, foreground: usize, photos: bool, now: Instant) {
        // Windows can briefly have no foreground window during activation changes.
        if foreground == 0 || foreground == self.foreground {
            return;
        }
        if self.photos || photos {
            let action = if photos { RecoveryAction::Raise } else { RecoveryAction::Refresh };
            self.repair_at = Some((now + Duration::from_millis(300), action));
        }
        self.foreground = foreground;
        self.photos = photos;
    }

    fn repair_due(&mut self, now: Instant) -> Option<RecoveryAction> {
        let (at, action) = self.repair_at?;
        if now < at {
            return None;
        }
        self.repair_at = None;
        Some(action)
    }
}

pub fn watch_photos<R: Runtime>(window: WebviewWindow<R>) -> std::io::Result<()> {
    let hwnd = window.hwnd().map_err(std::io::Error::other)?.0 as usize;
    std::thread::Builder::new().name("prompter-visibility".into()).spawn(move || {
        let mut transition = PhotosTransition::default();
        diagnostic(&format!("watching prompter hwnd={hwnd}"));
        while unsafe { IsWindow(hwnd as Hwnd) } != 0 {
            let foreground = unsafe { GetForegroundWindow() } as usize;
            let now = Instant::now();
            if foreground != 0 && foreground != transition.foreground {
                let photos = is_photos(foreground as Hwnd);
                diagnostic(&format!("foreground={foreground} photos={photos} previous_photos={}", transition.photos));
                transition.foreground_changed(foreground, photos, now);
            }
            if let Some(action) = transition.repair_due(now) {
                if let Err(error) = repair(&window, action == RecoveryAction::Refresh) {
                    eprintln!("Could not schedule prompter refresh: {error}");
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn photos_exit_refreshes_once_without_dom_or_prompter_focus_events() {
        let now = Instant::now();
        let mut transition = PhotosTransition::default();
        transition.foreground_changed(1, true, now);
        assert_eq!(transition.repair_due(now + Duration::from_millis(100)), None);
        transition.foreground_changed(0, false, now);
        transition.foreground_changed(2, false, now);
        assert_eq!(transition.repair_due(now + Duration::from_millis(299)), None);
        assert_eq!(transition.repair_due(now + Duration::from_millis(300)), Some(RecoveryAction::Refresh));
        assert_eq!(transition.repair_due(now + Duration::from_millis(1200)), None);
        assert_eq!(transition.repair_due(now + Duration::from_secs(5)), None);
    }

    #[test]
    fn unrelated_focus_changes_do_not_refresh() {
        let now = Instant::now();
        let mut transition = PhotosTransition::default();
        transition.foreground_changed(1, false, now);
        transition.foreground_changed(2, false, now);
        assert_eq!(transition.repair_due(now + Duration::from_secs(5)), None);
    }

    #[test]
    fn entering_photos_restores_order_without_flashing_the_surface() {
        let now = Instant::now();
        let mut transition = PhotosTransition::default();
        transition.foreground_changed(1, false, now);
        transition.foreground_changed(2, true, now);
        assert_eq!(transition.repair_due(now + Duration::from_millis(300)), Some(RecoveryAction::Raise));
        assert_eq!(transition.repair_due(now + Duration::from_millis(1200)), None);
        assert_eq!(transition.repair_due(now + Duration::from_secs(5)), None);
    }

    #[test]
    fn intentional_hiding_minimizing_and_other_desktops_are_respected() {
        assert!(can_refresh(true, false, 0));
        assert!(!can_refresh(false, false, 0));
        assert!(!can_refresh(true, true, 0));
        for cloak in [1, 2, 4] {
            assert!(!can_refresh(true, false, cloak));
        }
    }

    #[test]
    fn recognizes_photos_executables_only() {
        assert!(is_photos_path(r"C:\Program Files\WindowsApps\Microsoft.Windows.Photos\Photos.exe"));
        assert!(is_photos_path(r"C:\Apps\MICROSOFT.PHOTOS.EXE"));
        assert!(!is_photos_path(r"C:\Photos.exe\unrelated.exe"));
        assert!(!is_photos_path(r"C:\Apps\Photos.exe.bak"));
    }
}
