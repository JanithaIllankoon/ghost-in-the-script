<p align="center">
  <img src="src/assets/logo-256.png" width="128" height="128" alt="Ghost In The Script logo: a small ghost writing in a book" />
</p>

<h1 align="center">Ghost In The Script</h1>

<p align="center">
  A teleprompter for Windows that sits on top of your slides but <b>doesn't show up in screen recordings</b>.<br/>
  Made by Janitha Illankoon.
</p>

<p align="center">
  <a href="https://github.com/JanithaIllankoon/ghost-in-the-script/releases/latest"><b>Download for Windows</b></a>
</p>

<p align="center">
  ✅ Tested and verified working with <b>Panopto</b>, <b>Zoom</b>, <b>Microsoft Teams</b> and <b>OBS Studio</b>.
</p>

> **AI-assisted project.** I built Ghost In The Script with the help of an AI coding assistant (Claude, by Anthropic). Much of the code was written with Claude; I directed the design, reviewed the code, fixed issues by hand and tested every release.

---

You record a lecture in Panopto (or OBS, Teams, Zoom). Your script floats right under your webcam so you can read it while looking at the camera. The recording only shows your slides.

![The prompter and its toolbar floating over the main window while the script scrolls in Voice Activated mode](docs/v1.5.2/light.png)

![The main window with scripts and navigation on the left, the editor in the middle and the Present panel on the right](docs/v1.5.2/main.png)

## What it does

**Light and dark themes.** v1.5.0 added a clean workspace, and v1.5.1 reworks it into a sidebar with your scripts, an editor card, and a Present panel with scrolling-mode cards and speed and text size sliders. Use the switch at the bottom of the sidebar to choose light or navy dark mode. The choice is remembered and also updates the Windows title bar. The prompter has its own light/dark button on its toolbar; it swaps the prompter's text, background, cue, highlight, guide and outline colours. The letter outline colour can also be set under **Settings > Text > Outline Colour**.

**Hidden from recordings.** The prompter uses a Windows feature (`WDA_EXCLUDEFROMCAPTURE`) that removes a window from every software capture: Panopto, OBS, Teams, Zoom, Snipping Tool and screen sharing all see whatever is behind it. You still see it on your monitor. The **Recording protection** switch in the Present panel is green while it's on and red when it's off. Tested with Panopto, Zoom, Microsoft Teams and OBS Studio.

**Screenshots on request.** Because the hiding covers screenshots too, v1.5.1 adds an **Allow Screenshots** switch under **Settings > Window**. While it's on, the prompter and the main window show up in Print Screen and Snipping Tool (and in recordings, so turn it off before you record). **Ctrl+Alt+S** flips it from any app.

**Off the taskbar too.** A full-screen recording also captures your taskbar, so by default the app keeps no taskbar button there. Open it from the ghost in the tray, near the clock, or with **Ctrl+Alt+O**. Minimising the main window sends it to the tray. You can turn this off under **Settings > Window**.

**Three ways to scroll.**

| Mode | What happens |
|---|---|
| Fixed Speed | Scrolls at a steady speed. Change it while it runs with the hotkeys or the slider. |
| Voice Activated | Scrolls while you talk and stops when you pause. |
| Follow My Voice | Listens to your words and keeps the line you're reading on the guide. It waits while you ad-lib, catches up if you skip a line, and jumps if you start reading somewhere else. |

Speech recognition runs on your PC with [Vosk](https://alphacephei.com/vosk/). Nothing you say leaves your computer.

**Make the text readable your way.** Font, size, weight, line spacing, paragraph spacing, letter and word spacing, margins, alignment, all capitals, colours, background see-through level, a reading guide (arrows, line or band) at the height you choose, dimming of text you've already read, and mirroring for teleprompter glass.

**Control it from any app.** Global hotkeys work while Panopto has focus. The prompter can also let clicks pass through to the app underneath.

**Scripts.** A saved library with search, simple formatting, cue notes for yourself, and import from `.txt`, `.md`, `.docx` and `.rtf` (drag and drop works too).

![The prompter overlay with a gold cue and the reading guide arrows](docs/prompter.png)

## Install

1. Download `Ghost-In-The-Script_x.y.z_x64-setup.exe` from the [latest release](https://github.com/JanithaIllankoon/ghost-in-the-script/releases/latest).
2. Run it. It installs for your Windows user only, so it doesn't need admin rights.

Needs Windows 10 version 2004 or newer, or Windows 11. Windows SmartScreen may warn you because the installer isn't code-signed. Choose **More info**, then **Run anyway**.

If you used an earlier test build called "Ghost Prompter", uninstall it from **Settings > Apps**. Your scripts are kept.

## Using it

The prompter doesn't open by itself: press **Show Prompter** or **Start Prompting**. The first time it opens, three short tips appear one after another, each pointing at what it's about: the dotted handle for moving it, the **Click Through** switch, and the blue reading guide. The last two have a **Settings** button that opens their options in the main window. Press **Got It** to move on.

1. Write or paste your script, or import a file.
2. Pick how it should scroll.
3. Press **Start Prompting**, or **Ctrl + Alt + Space** from any app.
4. Drag the prompter under your webcam by the dotted handle under the toolbar that appears when you hover over it. Resize it from any edge.

### Hotkeys

| Action | Default keys |
|---|---|
| Play / pause | Ctrl+Alt+Space |
| Faster / slower | Ctrl+Alt+Up / Ctrl+Alt+Down |
| Back / forward one line | Ctrl+Alt+PageUp / Ctrl+Alt+PageDown |
| Back to the start | Ctrl+Alt+Home |
| Switch scroll mode | Ctrl+Alt+M |
| Click-through on / off | Ctrl+Alt+K |
| Show / hide the prompter | Ctrl+Alt+P |
| Show / hide the main window | Ctrl+Alt+O |

Change them under **Settings > Hotkeys**. If another app already uses one, the main window tells you and offers to change it.

**Every shortcut in one place:** press **Ctrl+/** in either window, select **Keyboard shortcuts and gestures** under the Start button, or press **?** on the prompter's toolbar.

When the prompter has focus: Space plays and pauses, Up and Down change the speed, PageUp and PageDown move a line, Home rewinds, and M switches mode. The mouse wheel scrolls by hand, and double-clicking a word jumps there.

**Click-through** lets clicks pass through the prompter to the app underneath. While it's on, a small badge on the prompter says so. Turn it off with **Ctrl+Alt+K**, the **Turn off** button in the main window, or **Turn off click-through** in the tray menu.

**Tray menu** (right-click the ghost near the clock): show the main window, show or hide the prompter, play or pause, turn off click-through, move the prompter to the top centre (handy if it ends up off-screen), and quit.

### Script formatting

Press the eye icon at the bottom right of the editor to preview the script with its formatting applied. Press the pencil icon, or double-click the preview, to go back to the text.

```
**bold**   *italic*   __underline__   ==highlight==
[note to yourself]     shown in gold, skipped by voice tracking
{red}coloured words{/} any colour name or #hex
blank line             new paragraph
\*  \_  \=  \[  \{     the character itself, not a mark
```

Marks pair up within a paragraph. A mark with no partner, like the star in `5 * 3`, shows as typed. Extra marks show as text, so `****Bold****` is **\*\*Bold\*\*** in bold.

### Other languages

The built-in speech model is English. For another language, or better accuracy, download a model from the [Vosk model list](https://alphacephei.com/vosk/models), unzip it, and paste the folder path under **Settings > Voice > Speech Model Folder**.

## Phone remote

Control the prompter from your Android phone with the **Ghost Remote** app while you stand away from the PC. Download `Ghost-Remote_x.y.z.apk` from the [latest release](https://github.com/JanithaIllankoon/ghost-in-the-script/releases/latest) and install it on your phone. Android may ask you to allow installs from your browser or file manager first.

1. On the PC, open **Settings > Remote** and turn on **Allow a Phone to Control the Prompter**. The pairing QR code appears on the prompter and in Settings.
2. In Ghost Remote, press **Scan QR Code** and scan it.

The phone and the PC need to be on the same Wi-Fi. The first time, Windows may ask whether Ghost In The Script can use the network: allow it on private networks. After pairing, the phone reconnects to the same PC on its own.

<p align="center">
  <img src="docs/v1.6.0/remote-read.png" width="260" alt="Ghost Remote's Read tab: elapsed time, total and progress on one line, a seek slider, back, play and next buttons, Stop and Rewind, and the reading pace" />
  &nbsp;
  <img src="docs/v1.6.0/remote-position.png" width="260" alt="Ghost Remote's Position tab: arrows to move the prompter, a button to put it at the top centre, Reset to Screen Centre, and width and height buttons" />
  &nbsp;
  <img src="docs/v1.6.0/remote-latency.png" width="260" alt="Ghost Remote's Latency Log: network ping and control response times, with a list of recent commands and how long each took" />
</p>

- **Read:** play and pause, the time so far with the total and how far through you are, a slider to jump anywhere in the script, back or forward one line, **Stop & Rewind**, reading pace, and scroll mode.
- **Position:** move the prompter, put it at the top centre of the screen, **Reset to Screen Centre** if it ends up somewhere you can't reach, change its width and height, and turn click-through on or off. **Fine Adjustment** makes each step smaller.
- **Latency Log** (the ⋮ menu): how quickly the PC answers, for pings and for each control, with **Copy Log** to share it.

The phone can only drive the prompter. It can't show or hide windows or reach the main window, and nothing connects without the pairing code. **New Pairing Code** in Settings disconnects phones paired with the old one. The connection stays on your local network.

## Limits

- It can't hide from a camera or phone pointed at your screen, or from a hardware capture card.
- The windows are also hidden from your own screenshots unless you turn on **Allow screenshots** (**Ctrl+Alt+S**). Windows can't allow screenshots without also allowing recordings.
- The tray icon near the clock is part of the screen, so a full-screen recording can show it. Windows 11 usually tucks new tray icons into the hidden icons menu (the ^ arrow), and you can keep it there under **Settings > Personalization > Taskbar > Other system tray icons**.
- Windows only.

## Your data

Scripts and settings are saved on your PC in `%APPDATA%\app.ghostprompter.desktop\data.json`. The app doesn't connect to the internet. The only exception is the **Star on GitHub** button, which opens this page in your browser. Phone Remote, while it's on, only talks to phones on your local network.

## Build it yourself

You need Node.js 20 or newer, Rust with the MSVC toolchain, and the Visual Studio C++ build tools.

```bash
npm install
npm run app:dev     # run the app with live reload
npm run app:build   # build the installer into src-tauri/target/release/bundle/nsis
```

The first run downloads the Vosk speech engine and English model (about 55 MB) from their official sources and checks their SHA-256 hashes. They are kept out of git because of their size. You can also fetch them yourself with `npm run setup:speech`.

To check the interface in a normal browser without the Rust side, run `npm run dev` and open `http://localhost:1420/dev/controls.html` or `/dev/prompter.html`. These dev-only pages fake the backend. Add `?skip=1` to skip the start screen, or `?fail=save`, `?fail=load`, `?capture=fail` or `?empty=1` to see the error and empty states.

| Folder | What's inside |
|---|---|
| `src/controls/` | Main window: start screen, scripts, editor, Present panel, settings |
| `src/prompter/` | The overlay window |
| `src/shared/` | Script formatting, voice matching (`align.ts`), settings |
| `src-tauri/src/` | Rust: capture hiding, global hotkeys, microphone and speech recognition |
| `scripts/` | Downloads the speech files |
| `dev/` | Browser preview pages for development |

Design choices and the reasoning behind them are in [DESIGN.md](DESIGN.md).

## Built with

- [Tauri 2](https://tauri.app) (MIT / Apache-2.0)
- [Vosk](https://github.com/alphacep/vosk-api) speech recognition and its small English model (Apache-2.0)
- [Fredoka](https://fonts.google.com/specimen/Fredoka) font via Fontsource (SIL Open Font License 1.1)
- [JSZip](https://stuk.github.io/jszip/) for reading Word files (MIT)

## License

[MIT](LICENSE) © 2026 Janitha Illankoon. You can use, change and share the code, including in your own projects, as long as you keep the copyright notice. The bundled third-party parts keep their own licenses, listed above.

## Support the project

If it saves you a retake, a star on GitHub helps other presenters find it.
