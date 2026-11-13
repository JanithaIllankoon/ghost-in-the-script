# Overlay disappearing after Windows Photos

## Observed on 13 November 2026

The user reproduced the disappearance in the installed 1.5.3 build while a native probe inspected the prompter. Before and after closing Photos, the prompter and all WebView child windows had `IsWindowVisible = true`, `IsIconic = false`, and `DWMWA_CLOAKED = 0`. The window bounds, extended styles and capture affinity (`0x11`) were unchanged. Turning click-through off did not restore the image; Hide Prompter followed by Show Prompter did.

This rules out a normal hide, minimize, off-screen move, or DWM cloak in that reproduction. It indicates a presentation/composition failure, but does not establish which Windows, GPU or WebView2 component causes it. Native visibility is not proof that pixels are reaching the monitor.

Commit `60fc21e` restores minimized windows and resets the WebView controller only when the DOM reports `visibilityState === "hidden"`. Neither path reliably covers this failure. Its browser switches also did not prevent the reported reproduction.

## Recovery

`src-tauri/src/overlay.rs` watches native foreground transitions independently of the prompter's JavaScript timers and focus. Entering Windows Photos schedules a topmost-order repair after 300 ms, without hiding the surface. Leaving Photos schedules one full refresh after 300 ms. It recognizes `Photos.exe` and `Microsoft.Photos.exe`. Transitions between unrelated applications do not schedule repairs.

Each refresh rechecks native visibility, minimization and cloaking on the UI thread. It hides the native window, flushes DWM composition, shows it again, then resets WebView2 visibility. The native operations preserve size, position and activation and do not change capture affinity or click-through. If Always on Top is configured, the refresh reasserts topmost order. Intentionally hidden or cloaked windows are skipped. The existing DOM-triggered recovery uses the same guarded refresh.

The first native refresh attempt, without a DWM flush or topmost reassertion, was tested by the user and still failed. The user confirmed that the revised attempt prevented disappearance, but its repeated resets flickered. The final scheduler reduces this to one full reset on leaving Photos and only an order repair on entry. The user verified the final version with click-through on and off: recovery works, flicker is reduced, and intentionally hiding the overlay keeps it hidden after Photos closes.

Set `GHOST_OVERLAY_LOG` to a local file path when launching a diagnostic build to record foreground transitions and native/WebView visibility before and after recovery. Logs contain window handles and state flags, not script text or other applications' titles.

This is a targeted workaround, not a confirmed upstream root-cause fix. Closing a Photos window that was never observed in the foreground is outside this workaround. A refresh may produce a brief visual blink.

## Verification

Build the standalone test executable with `npm run tauri -- build --no-bundle`. A plain `cargo build --release` does not enable Tauri's custom protocol and still expects the development server. Exit all installed copies before launching `src-tauri/target/release/ghost-in-the-script.exe`; single-instance handling otherwise redirects to the old process. Verify both the running executable path and the loaded application UI before testing.

- Repeat opening and closing an image in Photos with click-through both on and off, including maximized Photos.
- Check that the overlay returns within about 1.5 seconds, retains its position and scrolling progress, and does not take keyboard focus.
- Hide the prompter intentionally, then open and close Photos. It must remain hidden.
- Switch between unrelated applications. There should be no refresh.
- Check recording protection remains enabled after recovery; screenshots cannot verify physical visibility while capture exclusion is enabled.
- Unit tests cover the delayed, bounded recovery, transient null foreground handles, unrelated transitions, executable recognition and the visibility guard.

API references: [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow), [WebView2 controller visibility](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller).
