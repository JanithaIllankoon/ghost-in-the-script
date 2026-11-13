import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, Window, primaryMonitor } from "@tauri-apps/api/window";

import logoUrl from "../assets/logo-256.png";
import { importFile } from "../shared/importers";
import { renderSections, shortcutSections } from "../shared/shortcuts";
import { creditHtml, initSplash, splashHtml } from "./splash";
import { initTheme } from "./theme";
import { countWords, renderScript } from "../shared/markup";
import { WELCOME_SCRIPT, WELCOME_TITLE } from "../shared/sample";
import {
  ACTION_LABELS,
  PROMPTER_PALETTES,
  DATA_VERSION,
  DEFAULT_HOTKEYS,
  DEFAULT_SETTINGS,
  MODE_LABELS,
  normalizeData,
  uid,
  type Action,
  type AppData,
  type HotkeyProblem,
  type PrompterCommand,
  type PrompterStatus,
  type ScrollMode,
  type Script,
  type Settings,
} from "../shared/types";

// ---------- Data ----------
function freshData(): AppData {
  const now = Date.now();
  const s: Script = { id: uid(), title: WELCOME_TITLE, body: WELCOME_SCRIPT, createdAt: now, updatedAt: now };
  return { version: DATA_VERSION, settings: { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } }, scripts: [s], activeScriptId: s.id };
}

let data: AppData = freshData();
let ready = false;
const S = () => data.settings;
const active = () => data.scripts.find((s) => s.id === data.activeScriptId) ?? null;

let saveTimer: number | undefined;
function save() {
  if (!ready) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 300);
}
async function saveNow() {
  clearTimeout(saveTimer);
  try {
    // While Settings has unsaved changes, the file keeps the last saved settings.
    const toWrite = settingsBase ? { ...data, settings: settingsBase } : data;
    await invoke("save_data", { json: JSON.stringify(toWrite) });
    showBanner(null);
    setSaveStatus("saved");
  } catch (e) {
    showBanner(`Couldn't save your latest changes: ${e}`);
  }
}

/**
 * Settings as last saved, while the Settings drawer is open (null when it's closed).
 * Changes in the drawer preview right away but only reach the file when Save is pressed.
 */
let settingsBase: Settings | null = null;
const stableJson = (s: Settings) => JSON.stringify(s, [...new Set([...Object.keys(s), ...Object.keys(s.hotkeys)])].sort());
const settingsDirty = () => !!settingsBase && stableJson(settingsBase) !== stableJson(S());

let settingsQueued = false;
function pushSettings() {
  if (settingsQueued) return;
  settingsQueued = true;
  // A timer, not requestAnimationFrame: frames stop while this window is minimised.
  setTimeout(() => {
    settingsQueued = false;
    emitTo("prompter", "gp:settings", S()).catch(() => {});
  }, 16);
}

let scriptTimer: number | undefined;
function pushScript(immediate = false) {
  clearTimeout(scriptTimer);
  const send = () => {
    const s = active();
    emitTo("prompter", "gp:script", { id: s?.id ?? null, body: s?.body ?? "" }).catch(() => {});
  };
  if (immediate) send();
  else scriptTimer = window.setTimeout(send, 250);
}

function cmd(c: PrompterCommand) {
  emitTo("prompter", "gp:cmd", c).catch(() => {});
}

function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  // Switching the prompter between light and dark also swaps its text, background, cue, highlight and guide colours.
  const extra = key === "prompterTheme" ? PROMPTER_PALETTES[value as Settings["prompterTheme"]] : {};
  data.settings = { ...S(), [key]: value, ...extra };
  save();
  pushSettings();
  if (key === "hidePrompterFromCapture" || key === "hideControlsFromCapture") applyCapture();
  if (key === "hideFromTaskbar") applyTaskbar();
  if (key === "allowScreenshots") applyCapture();
  refreshFields();
}

// ---------- Small helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.5" height="15" rx="1.2"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1.2"/></svg>';

// Line icons for the layout. They inherit the text colour.
const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  scripts: icon('<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h5M9.5 15.5h5"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
  hotkeys: icon('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8"/>'),
  appearance: icon('<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/>'),
  about: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  upload: icon('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15"/>'),
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  moon: icon('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  manual: icon('<path d="M5 7h14M5 12h14M5 17h9"/>'),
  voice: icon('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>'),
  follow: icon('<path d="M4 12h.01M7.5 9v6M11 5.5v13M14.5 8v8M18 10.5v3M21 12h.01"/>'),
  check: icon('<path d="m6 12.5 4 4 8-9"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  eyeOff: icon('<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.9 3.6M6.4 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  eye: icon('<path d="M2.5 12c1-2 4.5-6 9.5-6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z"/><circle cx="12" cy="12" r="3"/>'),
  pencil: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  pin: icon('<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z"/><path d="M12 13.5V20"/>'),
  toStart: icon('<path d="M6 5v14M18 6l-8 6 8 6z"/>'),
  lineUp: icon('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  lineDown: icon('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  copy: icon('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
  tray: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 14h5l1 2h5l1-2h5"/>'),
};

/** Short mode descriptions for the three cards; the longer ones live in MODE_HINTS. */
const MODE_SHORT: Record<ScrollMode, string> = {
  manual: "Scrolls at a steady pace.",
  voice: "Scrolls while you talk. Stops when you pause.",
  follow: "Keeps the line you're reading on the guide.",
};

// ---------- Layout ----------
document.getElementById("app")!.innerHTML = `
  ${splashHtml()}

  <div class="shell">
    <aside class="scripts" aria-label="Scripts">
      <div class="brand">
        <img src="${logoUrl}" alt="Ghost In The Script logo" />
        <div class="name">Ghost In<br />The Script</div>
      </div>
      <nav class="nav" aria-label="Main">
        <button aria-current="page" id="nav-scripts">${ICONS.scripts}<span>Scripts</span></button>
        <button id="btn-settings">${ICONS.settings}<span>Settings</span></button>
        <button id="nav-hotkeys">${ICONS.hotkeys}<span>Hotkeys</span></button>
        <button id="nav-appearance">${ICONS.appearance}<span>Appearance</span></button>
        <button id="nav-about">${ICONS.about}<span>About</span></button>
      </nav>
      <div class="scripts-actions">
        <button class="btn primary" id="btn-new">${ICONS.plus}<span>New Script</span></button>
        <button class="btn quiet" id="btn-import">${ICONS.upload}<span>Import File</span></button>
      </div>
      <div class="list-head" id="list-head">SCRIPTS</div>
      <div class="search-wrap">
        ${ICONS.search}
        <input class="search" id="search" type="search" placeholder="Search Scripts..." aria-label="Search scripts" />
      </div>
      <ul class="script-list" id="list"></ul>
      <div class="list-empty" id="list-empty" hidden>
        <p id="list-empty-text"></p>
        <button class="btn small" id="btn-clear-search">Clear Search</button>
      </div>
      <input type="file" id="file" accept=".txt,.md,.markdown,.docx,.rtf" multiple hidden />
      <div class="side-foot">
        ${creditHtml()}
        <div class="side-row">
          <span class="version">v1.5.2</span>
          <button class="theme-toggle" id="theme-toggle" role="switch" aria-checked="false" aria-label="Dark mode">
            ${ICONS.moon}<span id="theme-label">Light Mode</span><span class="theme-track" aria-hidden="true"><span></span></span>
          </button>
        </div>
      </div>
    </aside>

    <main class="write" aria-label="Script editor">
      <div class="banner" id="save-error" role="alert" hidden>
        <span id="save-error-text"></span>
        <button class="btn small" id="btn-retry-save">Try Again</button>
      </div>
      <div class="write-head">
        <span class="file-tile" aria-hidden="true">${ICONS.scripts}</span>
        <div class="write-title">
          <input class="title-input" id="title" placeholder="Name this script" aria-label="Script name" />
          <span class="write-meta"><b id="wc">0</b> words <i aria-hidden="true">&bull;</i> About <b id="dur">0:00</b> at a normal speaking pace</span>
        </div>
        <div class="write-actions">
          <button class="icon-btn" id="btn-dup" title="Duplicate this script" aria-label="Duplicate this script">${ICONS.copy}</button>
          <button class="btn small" id="btn-export" title="Save as a .txt file">Save As</button>
          <button class="btn small danger" id="btn-del">Delete</button>
        </div>
      </div>
      <div class="format-bar" role="toolbar" aria-label="Formatting">
        <button class="btn" data-wrap="**" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
        <button class="btn" data-wrap="*" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
        <button class="btn" data-wrap="__" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
        <button class="btn" data-wrap="==" title="Highlight (Ctrl+H)">Highlight</button>
        <span class="divider"></span>
        <button class="btn" id="btn-cue" title="A note to yourself. Shown in gold, skipped by voice tracking.">Add Cue</button>
        <span class="color-pick" title="Colour the selected words"><input type="color" id="fmt-color" value="#e9b75f" aria-label="Colour the selected words" /></span>
        <span class="divider"></span>
        <button class="btn quiet" id="btn-help" aria-expanded="false" aria-controls="help-pop">Formatting Help</button>
        <div class="help-pop" id="help-pop" role="dialog" aria-label="Formatting Help" hidden>
          <h3>Formatting</h3>
          <dl>
            <dt>**bold**</dt><dd><b>bold</b></dd>
            <dt>*italic*</dt><dd><i>italic</i></dd>
            <dt>__underline__</dt><dd><u>underline</u></dd>
            <dt>==highlight==</dt><dd>highlighted words</dd>
            <dt>[note]</dt><dd><span class="cue-sample">a cue for you</span>, not read by voice tracking</dd>
            <dt>{red}words{/}</dt><dd>any colour name or #hex</dd>
            <dt>blank line</dt><dd>new paragraph</dd>
            <dt>\\*  \\_  \\=</dt><dd>the character itself, not a mark</dd>
          </dl>
        </div>
      </div>
      <div class="editor-wrap">
        <textarea class="script" id="body" spellcheck="true" aria-label="Script text"
          placeholder="Paste or type your script here.&#10;&#10;Or drop a .txt, .md or .docx file onto this window."></textarea>
        <div class="script-preview" id="preview" tabindex="0" aria-label="Formatted preview of the script" hidden></div>
        <div class="drop-hint" id="drop" hidden>Drop to Import</div>
      </div>
      <div class="write-foot">
        <span class="saved" id="saved"></span>
        <button class="preview-toggle" id="btn-preview" aria-pressed="false" aria-label="Preview: see the script formatted, the way the prompter shows it" title="Preview: see the script formatted, the way the prompter shows it">${ICONS.eye}</button>
      </div>
    </main>

    <aside class="present" aria-label="Present">
      <div class="present-body">
        <button class="start" id="start"><span class="start-main" id="start-main">${PLAY}<span>Start Prompting</span></span></button>
        <p class="start-hint"><span id="start-hint"></span> <button class="link" id="btn-shortcuts">Keyboard Shortcuts and Gestures (Ctrl+/)</button></p>

        <div class="notices" id="notices" aria-live="polite"></div>

        <div class="progress">
          <button class="bar" id="bar" aria-label="Jump to a point in the script" title="Click to jump to that point in the script"><span class="fill gs-fill" id="fill"></span><span class="p-head" aria-hidden="true"></span></button>
          <div class="meta"><span id="elapsed">0:00</span><span id="wpm"></span><span id="remaining">-0:00</span></div>
        </div>
        <div class="nav-row">
          <button class="btn small nav-btn" id="t-rewind">${ICONS.toStart}<span>To Start</span></button>
          <button class="btn small nav-btn" id="t-back">${ICONS.lineUp}<span>Line Up</span></button>
          <button class="btn small nav-btn" id="t-fwd">${ICONS.lineDown}<span>Line Down</span></button>
        </div>

        <section>
          <h2 class="group-title" id="modes-title">Scrolling Mode</h2>
          <fieldset class="modes" id="modes" aria-labelledby="modes-title">
            ${(["manual", "voice", "follow"] as ScrollMode[]).map((m) => `
              <label class="mode">
                <input type="radio" name="mode" value="${m}" />
                <span class="tick" aria-hidden="true">${ICONS.check}</span>
                <span class="mode-icon" aria-hidden="true">${ICONS[m]}</span>
                <b>${m === "manual" ? MODE_LABELS[m].replace(" ", "<br>") : MODE_LABELS[m]}</b>
                <small>${MODE_SHORT[m]}</small>
              </label>`).join("")}
          </fieldset>
        </section>

        <div class="voice-box" id="voice-box" hidden>
          <div class="meter" aria-hidden="true" title="Your microphone level. The gold mark is how loud you need to be for it to count as talking."><div class="fill" id="p-meter"></div><div class="mark" id="p-mark"></div></div>
          <div class="heard" id="heard" role="status"></div>
          <button class="link" id="btn-sensitivity">Adjust Sensitivity</button>
        </div>

        <div class="quick" id="quick"></div>

        <div class="panel-actions">
          <button class="btn primary" id="btn-prompter">${ICONS.pin}<span id="btn-prompter-label">Show Prompter</span></button>
          <button class="btn" id="btn-tray">${ICONS.tray}<span>Minimise to Tray</span></button>
        </div>

        <section class="rec-card">
          <div class="rec-head">
            <span class="rec-icon" aria-hidden="true">${ICONS.eyeOff}</span>
            <b>Recording Protection</b>
            <span class="switch rec-switch"><input type="checkbox" role="switch" id="rec-switch" aria-label="Hide the prompter and this window from recordings" /><span></span></span>
          </div>
        </section>
      </div>
    </aside>
  </div>

  <div class="backdrop" id="drawer-backdrop" hidden>
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" id="drawer">
      <div class="drawer-head">
        <h2 id="drawer-title">Settings</h2>
        <button class="icon-btn close-x" id="btn-close-settings" aria-label="Close" title="Close">${ICONS.close}</button>
      </div>
      <div class="tabs" role="tablist" id="tabs"></div>
      <div id="panels" style="display:contents"></div>
      <div class="drawer-foot">
        <div class="drawer-foot-actions">
          <button class="btn small danger-fill" id="btn-reset">Reset Settings</button>
          <button class="btn small go" id="btn-save-settings"><span class="save-label">Save</span></button>
        </div>
      </div>
    </div>
  </div>

  <div class="backdrop" id="dialog-backdrop" hidden>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
      <h2 id="dialog-title"></h2>
      <p id="dialog-body"></p>
      <div class="actions">
        <button class="btn" id="dialog-cancel">Cancel</button>
        <button class="btn" id="dialog-alt" hidden></button>
        <button class="btn primary" id="dialog-ok"></button>
      </div>
    </div>
  </div>

  <div class="backdrop" id="sheet-backdrop" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" id="sheet">
      <div class="sheet-head">
        <h2 id="sheet-title">Shortcuts and Gestures</h2>
        <button class="btn small" id="btn-change-hotkeys">Change Hotkeys</button>
        <button class="icon-btn close-x" id="btn-close-sheet" aria-label="Close" title="Close">${ICONS.close}</button>
      </div>
      <div class="sheet-body" id="sheet-body"></div>
    </div>
  </div>

  <div class="toast" id="toast" role="status" hidden></div>`;

initTheme();

// Show the focus ring only while the keyboard is being used to move around.
const docEl = document.documentElement;
addEventListener("keydown", (e) => { if (e.key === "Tab") docEl.classList.add("kbd"); }, true);
addEventListener("pointerdown", () => docEl.classList.remove("kbd"), true);


// ---------- Toast, dialog, save errors ----------
let toastTimer: number | undefined;
function toast(msg: string, error = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), error ? 6000 : 2600);
}

/** The editor footer's save status: a spinning ring while saving, then a bold green "Saved!". */
function setSaveStatus(state: "saving" | "saved" | "error") {
  const el = $("saved");
  el.className = `saved is-${state}`;
  if (state === "saving") {
    el.innerHTML = '<span class="saved-spin" aria-hidden="true"></span>';
    el.title = "Saving";
  } else {
    el.textContent = state === "saved" ? "Saved!" : "Not saved";
    el.removeAttribute("title");
  }
}

function showBanner(msg: string | null) {
  $("save-error").hidden = !msg;
  if (msg) {
    $("save-error-text").textContent = msg;
    setSaveStatus("error");
  }
}
$("btn-retry-save").onclick = () => saveNow();

type DialogChoice = "ok" | "alt" | "cancel";
let dialogResolve: ((choice: DialogChoice) => void) | null = null;
let dialogReturnFocus: HTMLElement | null = null;
/**
 * Shows the dialog with Cancel, an optional middle button (`altLabel`) and the main button.
 * `okClass` styles the main button, e.g. "btn primary" or "btn danger-fill".
 */
function choiceDialog(title: string, body: string, okLabel: string, okClass: string, altLabel?: string, altClass = "btn"): Promise<DialogChoice> {
  $("dialog-title").textContent = title;
  $("dialog-body").textContent = body;
  const ok = $("dialog-ok");
  ok.textContent = okLabel;
  ok.className = okClass;
  const alt = $("dialog-alt");
  alt.hidden = !altLabel;
  alt.textContent = altLabel ?? "";
  alt.className = altClass;
  dialogReturnFocus = document.activeElement as HTMLElement;
  $("dialog-backdrop").hidden = false;
  $("dialog-cancel").focus();
  return new Promise((resolve) => (dialogResolve = resolve));
}
function confirmDialog(title: string, body: string, okLabel: string, danger = true): Promise<boolean> {
  return choiceDialog(title, body, okLabel, danger ? "btn danger-fill" : "btn primary").then((c) => c === "ok");
}
function closeDialog(choice: DialogChoice) {
  $("dialog-backdrop").hidden = true;
  dialogResolve?.(choice);
  dialogResolve = null;
  dialogReturnFocus?.focus();
}
$("dialog-ok").onclick = () => closeDialog("ok");
$("dialog-alt").onclick = () => closeDialog("alt");
$("dialog-cancel").onclick = () => closeDialog("cancel");
$("dialog-backdrop").addEventListener("mousedown", (e) => {
  if (e.target === e.currentTarget) closeDialog("cancel");
});

// ---------- Fields ----------
/** Fixed text, or a function for hints that mention settings which can change (like hotkeys). */
type Hint = string | (() => string);

type Field =
  | { type: "range"; key: keyof Settings; label: string; min: number; max: number; step: number; unit?: string; fmt?: (v: number) => string; hint?: Hint }
  | { type: "color"; key: keyof Settings; label: string }
  | { type: "toggle"; key: keyof Settings; label: string; hint?: Hint }
  | { type: "select"; key: keyof Settings; label: string; options: [string, string][] | (() => [string, string][]); hint?: Hint }
  | { type: "seg"; key: keyof Settings; label: string; options: [string, string][] }
  | { type: "text"; key: keyof Settings; label: string; placeholder?: string; hint?: Hint }
  /** A titled card of related settings. */
  | { type: "group"; title: string; fields: Field[] }
  | { type: "custom"; render: () => HTMLElement };

const refreshers: (() => void)[] = [];
let fieldSeq = 0;

function renderField(f: Field): HTMLElement {
  if (f.type === "custom") return f.render();
  if (f.type === "group") {
    const section = el("section", "group");
    const body = el("div", "group-body");
    for (const child of f.fields) body.appendChild(renderField(child));
    section.append(el("h3", "group-title", f.title), body);
    return section;
  }
  const id = `f${++fieldSeq}`;
  const wrap = el("div", "field");
  const lbl = el("div", "lbl");
  const label = el("label", undefined, f.label);
  label.htmlFor = id;
  lbl.appendChild(label);
  const key = f.key;
  const get = () => S()[key] as unknown;

  if (f.type === "range") {
    const val = el("span", "val");
    lbl.appendChild(val);
    const input = el("input");
    input.id = id;
    input.type = "range";
    input.min = String(f.min);
    input.max = String(f.max);
    input.step = String(f.step);
    input.oninput = () => set(key, Number(input.value) as never);
    wrap.append(lbl, input);
    refreshers.push(() => {
      const v = Number(get());
      if (document.activeElement !== input) input.value = String(v);
      const text = f.fmt ? f.fmt(v) : `${v}${f.unit ? " " + f.unit : ""}`;
      val.textContent = text;
      input.setAttribute("aria-valuetext", text);
    });
  } else if (f.type === "color") {
    wrap.classList.add("inline");
    const input = el("input", "swatch");
    input.id = id;
    input.type = "color";
    input.oninput = () => set(key, input.value as never);
    wrap.append(lbl, input);
    refreshers.push(() => (input.value = String(get())));
  } else if (f.type === "toggle") {
    wrap.classList.add("inline");
    const sw = el("span", "switch");
    const input = el("input");
    input.id = id;
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.onchange = () => set(key, input.checked as never);
    sw.append(input, el("span"));
    wrap.append(lbl, sw);
    refreshers.push(() => (input.checked = Boolean(get())));
  } else if (f.type === "select") {
    const sel = el("select");
    sel.id = id;
    sel.onchange = () => {
      const isNum = typeof DEFAULT_SETTINGS[key] === "number";
      set(key, (isNum ? Number(sel.value) : sel.value) as never);
    };
    wrap.append(lbl, sel);
    refreshers.push(() => {
      const opts = typeof f.options === "function" ? f.options() : f.options;
      const sig = opts.map((o) => o[0]).join("|");
      if (sel.dataset.sig !== sig) {
        sel.innerHTML = "";
        for (const [v, l] of opts) sel.add(new Option(l, v));
        sel.dataset.sig = sig;
      }
      sel.value = String(get());
    });
  } else if (f.type === "seg") {
    const seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", f.label);
    for (const [v, l] of f.options) {
      const b = el("button", undefined, l);
      b.type = "button";
      b.dataset.v = v;
      b.onclick = () => set(key, v as never);
      seg.appendChild(b);
    }
    label.removeAttribute("for");
    wrap.append(lbl, seg);
    refreshers.push(() => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(get())))));
  } else if (f.type === "text") {
    const input = el("input", "text");
    input.id = id;
    input.placeholder = f.placeholder ?? "";
    input.onchange = () => set(key, input.value.trim() as never);
    wrap.append(lbl, input);
    refreshers.push(() => {
      if (document.activeElement !== input) input.value = String(get());
    });
  }
  if ("hint" in f && f.hint) {
    const hint = f.hint;
    const h = el("div", "hint", typeof hint === "function" ? hint() : hint);
    if (typeof hint === "function") refreshers.push(() => (h.textContent = hint()));
    if (wrap.classList.contains("inline")) {
      const outer = el("div", "field-wrap");
      outer.append(wrap, h);
      return outer;
    }
    wrap.appendChild(h);
  }
  return wrap;
}

function note(html: string) {
  const d = el("div", "note");
  d.innerHTML = html;
  return d;
}
function button(label: string, onClick: () => void, cls = "btn small") {
  const b = el("button", cls, label);
  b.onclick = onClick;
  return b;
}
/** A button on its own row inside a settings group. */
function actionRow(label: string, onClick: () => void) {
  const row = el("div", "field action");
  row.appendChild(button(label, onClick));
  return row;
}

// ---------- Settings content ----------
const FONTS = [
  "Segoe UI", "Arial", "Verdana", "Tahoma", "Calibri", "Bahnschrift", "Candara", "Corbel",
  "Trebuchet MS", "Georgia", "Cambria", "Times New Roman", "Sitka Text", "Consolas", "Comic Sans MS",
];
let micDevices: string[] = [];
let hotkeyProblems: HotkeyProblem[] = [];

const threshold = () => 0.75 - (S().voiceSensitivity / 100) * 0.55;

const fontSizeField: Field = { type: "range", key: "fontSize", label: "Text Size", min: 16, max: 160, step: 1, unit: "px" };
const speedField: Field = { type: "range", key: "speed", label: "Speed", min: 1, max: 100, step: 1 };

const TABS: { id: string; label: string; fields: Field[] }[] = [
  {
    id: "text", label: "Text",
    fields: [
      { type: "group", title: "Font", fields: [
        { type: "select", key: "fontFamily", label: "Font", options: () => {
          const list = FONTS.includes(S().fontFamily) ? FONTS : [S().fontFamily, ...FONTS];
          return list.map((f) => [f, f] as [string, string]);
        } },
        { type: "select", key: "fontWeight", label: "Weight", options: [["300", "Light"], ["400", "Regular"], ["600", "Semibold"], ["700", "Bold"], ["900", "Black"]] },
        fontSizeField,
        { type: "toggle", key: "uppercase", label: "All Capitals" },
      ] },
      { type: "group", title: "Layout", fields: [
        { type: "seg", key: "textAlign", label: "Alignment", options: [["left", "Left"], ["center", "Centre"], ["right", "Right"], ["justify", "Justify"]] },
        { type: "range", key: "marginX", label: "Side Margins", min: 0, max: 30, step: 1, unit: "%" },
      ] },
      { type: "group", title: "Spacing", fields: [
        { type: "range", key: "lineHeight", label: "Line Spacing", min: 1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
        { type: "range", key: "paragraphSpacing", label: "Space Between Paragraphs", min: 0, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)} lines` },
        { type: "range", key: "letterSpacing", label: "Letter Spacing", min: -2, max: 12, step: 0.5, unit: "px" },
        { type: "range", key: "wordSpacing", label: "Word Spacing", min: 0, max: 40, step: 1, unit: "px" },
      ] },
      { type: "group", title: "Outline", fields: [
        { type: "toggle", key: "textOutline", label: "Outline Around Letters", hint: "Keeps text readable when the background is see-through." },
        { type: "color", key: "outlineColor", label: "Outline Colour" },
      ] },
    ],
  },
  {
    id: "look", label: "Colours",
    fields: [
      { type: "group", title: "Quick Colour Sets", fields: [{ type: "custom", render: renderPresets }] },
      { type: "group", title: "Colours", fields: [
        { type: "color", key: "textColor", label: "Text" },
        { type: "color", key: "bgColor", label: "Background" },
        { type: "color", key: "cueColor", label: "Cues [Notes]" },
        { type: "color", key: "highlightColor", label: "Highlight" },
      ] },
      { type: "group", title: "Transparency", fields: [
        { type: "range", key: "bgOpacity", label: "Background Opacity", min: 0, max: 100, step: 1, unit: "%", hint: "Lower it to see your slides or webcam through the prompter." },
        { type: "range", key: "readOpacity", label: "Text You've Already Read", min: 5, max: 100, step: 1, unit: "%", hint: "Dims lines above the reading guide so your eye finds its place." },
        { type: "toggle", key: "fadeEdges", label: "Fade Text at the Top and Bottom" },
      ] },
      { type: "group", title: "Reading Guide", fields: [
        { type: "toggle", key: "guideEnabled", label: "Show Reading Guide" },
        { type: "seg", key: "guideStyle", label: "Style", options: [["arrows", "Arrows"], ["line", "Line"], ["band", "Band"]] },
        { type: "range", key: "guidePosition", label: "Height on Screen", min: 5, max: 90, step: 1, unit: "% from top", hint: "Near the top keeps your eyes close to the webcam." },
        { type: "color", key: "guideColor", label: "Guide Colour" },
      ] },
    ],
  },
  {
    id: "voice", label: "Voice",
    fields: [
      { type: "custom", render: () => note("Speech recognition runs on this PC. Nothing you say leaves it.") },
      { type: "group", title: "Microphone", fields: [
        { type: "select", key: "micDevice", label: "Microphone", options: () => [["", "Windows default"], ...micDevices.map((d) => [d, d] as [string, string])] },
        { type: "custom", render: renderMicTools },
        { type: "range", key: "voiceSensitivity", label: "Sensitivity", min: 0, max: 100, step: 1, unit: "%", hint: "Raise it if quiet speech doesn't scroll. Lower it if background noise does. The gold mark on the level meter is the trigger point." },
      ] },
      { type: "group", title: "Voice Activated", fields: [
        { type: "range", key: "silenceHold", label: "Keep Scrolling After You Stop", min: 100, max: 3000, step: 50, fmt: (v) => `${(v / 1000).toFixed(2)} s` },
      ] },
      { type: "group", title: "Follow My Voice", fields: [
        { type: "range", key: "followSmoothing", label: "Follow Mode Smoothness", min: 1, max: 10, step: 1, hint: "Higher glides more, lower reacts faster." },
        { type: "toggle", key: "restrictVocabulary", label: "Only Listen for Words in the Script", hint: "Much more accurate. Turn it off if you ad-lib a lot." },
        { type: "text", key: "modelPath", label: "Speech Model Folder (Optional)", placeholder: "Built-in English model", hint: "For another language or better accuracy, download a Vosk model from alphacephei.com/vosk/models, unzip it, and paste the folder path here." },
      ] },
    ],
  },
  {
    id: "window", label: "Window",
    fields: [
      { type: "group", title: "Recording", fields: [
        { type: "toggle", key: "hidePrompterFromCapture", label: "Hide the Prompter from Recordings", hint: "Panopto, OBS, Teams, Zoom, Snipping Tool and screen sharing see through it." },
        { type: "toggle", key: "hideControlsFromCapture", label: "Hide This Window from Recordings" },
        { type: "toggle", key: "allowScreenshots", label: "Allow Screenshots", hint: () => {
          const k = keysFor("screenshot");
          return `Shows the prompter and this window to Print Screen and Snipping Tool. Windows can't allow screenshots without also allowing recordings, so turn it off before you record.${k ? ` ${k} flips it from any app.` : ""}`;
        } },
        { type: "toggle", key: "hideFromTaskbar", label: "Hide from the Taskbar", hint: () => {
          const k = keysFor("toggle-controls");
          return `Your recording won't show a ghost button in the taskbar. Open the app from the ghost in the tray, near the clock${k ? `, or with ${k}` : ""}. Minimising sends this window to the tray.`;
        } },
      ] },
      { type: "group", title: "Prompter Window", fields: [
        { type: "toggle", key: "alwaysOnTop", label: "Keep the Prompter on Top" },
        { type: "toggle", key: "clickThrough", label: "Clicks Pass Through the Prompter", hint: () => {
          const k = keysFor("toggle-click-through");
          return `Lets you click the app underneath. Turn it off with this switch${k ? `, ${k}` : ""} or the tray menu.`;
        } },
        { type: "toggle", key: "mirrorH", label: "Mirror Left to Right", hint: "For teleprompter glass." },
        { type: "toggle", key: "mirrorV", label: "Flip Upside Down" },
        { type: "custom", render: () => actionRow("Move the Prompter Under the Webcam", centerPrompter) },
      ] },
      { type: "group", title: "While Prompting", fields: [
        { type: "range", key: "countdown", label: "Countdown Before Scrolling", min: 0, max: 10, step: 1, fmt: (v) => (v ? `${v} s` : "Off") },
        { type: "toggle", key: "showProgress", label: "Progress Line on the Prompter" },
        { type: "toggle", key: "showTimer", label: "Time Elapsed and Left on the Prompter" },
      ] },
    ],
  },
  {
    id: "hotkeys", label: "Hotkeys",
    fields: [
      { type: "custom", render: () => note("These work from <b>any app</b>, even while Panopto is recording. Select a box, then press the new keys. Backspace removes a hotkey. Escape cancels.") },
      { type: "group", title: "From Any App", fields: [
        { type: "custom", render: renderHotkeys },
        { type: "custom", render: () => actionRow("Restore Default Hotkeys", restoreDefaultHotkeys) },
      ] },
    ],
  },
];

function renderPresets(): HTMLElement {
  const presets: { name: string; text: string; bg: string; outline: string; opacity?: number }[] = [
    { name: "Night sky", text: "#f4f5ff", bg: "#050d2e", outline: "#000000" },
    { name: "Gold on black", text: "#ffd27a", bg: "#000000", outline: "#000000" },
    { name: "Ink on paper", text: "#111a3a", bg: "#f4f1ea", outline: "#ffffff", opacity: 92 },
    { name: "White on black", text: "#ffffff", bg: "#000000", outline: "#000000" },
    { name: "Yellow on blue", text: "#ffe14d", bg: "#0b2a6f", outline: "#000000" },
    { name: "Black on yellow", text: "#111111", bg: "#ffe14d", outline: "#ffffff", opacity: 92 },
    { name: "Mint on charcoal", text: "#a8f0d0", bg: "#1e2326", outline: "#000000" },
    { name: "Rose on plum", text: "#ffd6e7", bg: "#2a0f2e", outline: "#000000" },
  ];
  // The group's title names this row, so there's no separate label here.
  const wrap = el("div", "field");
  const grid = el("div", "presets");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Quick Colour Sets");
  for (const p of presets) {
    const b = el("button", "preset", "Aa");
    b.style.background = p.bg;
    b.style.color = p.text;
    b.title = p.name;
    b.setAttribute("aria-label", `Colour set: ${p.name}`);
    b.onclick = () => {
      data.settings = { ...S(), textColor: p.text, bgColor: p.bg, outlineColor: p.outline, ...(p.opacity ? { bgOpacity: p.opacity } : {}) };
      save();
      pushSettings();
      refreshFields();
      toast(`Colour set: ${p.name}`);
    };
    grid.appendChild(b);
  }
  wrap.appendChild(grid);
  return wrap;
}

let drawerMeter: HTMLElement | null = null;
let drawerMark: HTMLElement | null = null;
function renderMicTools(): HTMLElement {
  const wrap = el("div", "field");
  const lbl = el("div", "lbl");
  lbl.append(el("span", undefined, "Input Level"));
  const state = el("span", "val");
  lbl.append(state);
  const meter = el("div", "meter");
  drawerMeter = el("div", "fill");
  drawerMark = el("div", "mark");
  meter.append(drawerMeter, drawerMark);
  wrap.append(lbl, meter, button("Refresh Microphone List", () => loadDevices(true)));
  refreshers.push(() => {
    state.textContent = status?.voice.running ? status.voice.device : "Off until you pick a voice mode";
    drawerMark!.style.left = `${threshold() * 100}%`;
  });
  return wrap;
}

function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(k)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  const map: Record<string, string> = {
    " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    PageUp: "PageUp", PageDown: "PageDown", Home: "Home", End: "End", Enter: "Enter", Insert: "Insert",
  };
  let key = map[k];
  if (!key) {
    if (/^F\d{1,2}$/.test(k)) key = k;
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
    else if (e.code === "Minus" || e.code === "Equal") key = e.code;
    else if (e.code.startsWith("Numpad")) key = e.code;
    else return null;
  }
  parts.push(key);
  return parts.join("+");
}

function restoreDefaultHotkeys() {
  data.settings = { ...S(), hotkeys: { ...DEFAULT_HOTKEYS } };
  save();
  applyHotkeys();
  toast("Default hotkeys restored");
}

function renderHotkeys(): HTMLElement {
  const wrap = el("div", "field");
  const grid = el("div", "hk");
  for (const action of Object.keys(ACTION_LABELS) as Action[]) {
    const id = `hk-${action}`;
    const name = el("label", "name", ACTION_LABELS[action]);
    name.htmlFor = id;
    const input = el("input");
    input.id = id;
    input.readOnly = true;
    input.onkeydown = (e) => {
      if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { input.blur(); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey) {
        setHotkey(action, "");
        input.blur();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (!combo.includes("+")) {
        input.value = "Add Ctrl, Alt or Shift";
        return;
      }
      setHotkey(action, combo);
      input.blur();
    };
    input.onfocus = () => {
      input.value = "Press keys…";
      input.classList.add("listening");
    };
    input.onblur = () => {
      input.classList.remove("listening");
      refreshFields();
    };
    grid.append(name, input);
    refreshers.push(() => {
      if (document.activeElement !== input) input.value = S().hotkeys[action] || "None";
    });
  }
  const problems = el("div", "problems");
  problems.setAttribute("role", "alert");
  wrap.append(grid, problems);
  refreshers.push(() => {
    problems.textContent = hotkeyProblems
      .map((p) => `${p.keys} (${ACTION_LABELS[p.action as Action] ?? p.action}) can't be used: ${p.message}. Another app may already own these keys.`)
      .join(" ");
  });
  return wrap;
}

function setHotkey(action: Action, combo: string) {
  data.settings = { ...S(), hotkeys: { ...S().hotkeys, [action]: combo } };
  save();
  applyHotkeys();
}

function buildSettings() {
  const tabs = $("tabs");
  const panels = $("panels");
  TABS.forEach((t, i) => {
    const tab = el("button", "tab", t.label);
    tab.id = `tab-${t.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `panel-${t.id}`);
    tab.onclick = () => selectTab(t.id);
    tab.onkeydown = (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      selectTab(next.id);
      $(`tab-${next.id}`).focus();
    };
    tabs.appendChild(tab);
    const panel = el("div", "tab-panel");
    panel.id = `panel-${t.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    for (const f of t.fields) panel.appendChild(renderField(f));
    panels.appendChild(panel);
  });
  selectTab("text");
}

/** Highlights one sidebar item in blue: Scripts normally, or whatever is open over the scripts. */
function setNav(id: string) {
  document.querySelectorAll<HTMLButtonElement>(".nav button").forEach((b) => {
    if (b.id === id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
/** The sidebar item for each Settings tab; other tabs belong to Settings itself. */
const NAV_FOR_TAB: Record<string, string> = { hotkeys: "nav-hotkeys", look: "nav-appearance" };
let currentTab = "text";

function selectTab(id: string) {
  currentTab = id;
  if (!$("drawer-backdrop").hidden) setNav(NAV_FOR_TAB[id] ?? "btn-settings");
  for (const t of TABS) {
    const on = t.id === id;
    $(`tab-${t.id}`).setAttribute("aria-selected", String(on));
    $(`tab-${t.id}`).tabIndex = on ? 0 : -1;
    $(`panel-${t.id}`).hidden = !on;
  }
}

let drawerReturnFocus: HTMLElement | null = null;
function openSettings(tab?: string) {
  if (tab) selectTab(tab);
  if (!settingsBase) settingsBase = structuredClone(S());
  drawerReturnFocus = document.activeElement as HTMLElement;
  $("drawer-backdrop").hidden = false;
  setNav(NAV_FOR_TAB[currentTab] ?? "btn-settings");
  refreshFields();
  $("btn-close-settings").focus();
}
async function closeSettings() {
  if (settingsDirty()) {
    const ok = await confirmDialog("Discard unsaved changes?", "Your settings go back to how they were when you last pressed Save.", "Discard Changes");
    if (!ok) return;
    revertSettings();
  }
  settingsBase = null;
  $("drawer-backdrop").hidden = true;
  setNav("nav-scripts");
  drawerReturnFocus?.focus();
}
function revertSettings() {
  if (!settingsBase) return;
  data.settings = structuredClone(settingsBase);
  pushSettings();
  applyCapture();
  applyTaskbar();
  applyHotkeys();
  refreshFields();
}
function updateSaveState() {
  const dirty = settingsDirty();
  $("btn-save-settings").classList.toggle("pending", dirty);
  $("btn-save-settings").title = dirty ? "You have unsaved changes" : "";
}
$("btn-save-settings").onclick = async () => {
  if (!settingsBase) return;
  const wasDirty = settingsDirty();
  settingsBase = structuredClone(S());
  await saveNow();
  updateSaveState();
  toast(wasDirty ? "Settings saved" : "No changes to save");
};
$("btn-settings").onclick = () => openSettings();
$("btn-close-settings").onclick = closeSettings;
$("drawer-backdrop").addEventListener("mousedown", (e) => {
  if (e.target === e.currentTarget) closeSettings();
});
$("btn-reset").onclick = async () => {
  const ok = await confirmDialog("Reset all settings?", "Text, colours, voice, window and hotkey settings go back to their defaults. Your scripts are kept. Press Save afterwards to keep the defaults.", "Reset Settings");
  if (!ok) return;
  data.settings = { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } };
  pushSettings();
  applyCapture();
  applyTaskbar();
  applyHotkeys();
  refreshFields();
  toast("Defaults loaded. Press Save to keep them.");
};

/** Keeps Tab inside an open drawer or dialog. */
function trapFocus(container: HTMLElement, e: KeyboardEvent) {
  const items = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]"))
    .filter((x) => !x.hasAttribute("disabled") && x.tabIndex >= 0 && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

document.addEventListener("keydown", (e) => {
  if (!$("splash").hidden) return;
  if (!$("dialog-backdrop").hidden) {
    if (e.key === "Escape") closeDialog("cancel");
    else if (e.key === "Tab") trapFocus($("dialog-backdrop"), e);
    return;
  }
  if (!$("sheet-backdrop").hidden) {
    if (e.key === "Escape") closeSheet();
    else if (e.key === "Tab") trapFocus($("sheet"), e);
    return;
  }
  if (!$("drawer-backdrop").hidden) {
    if (e.key === "Escape") closeSettings();
    else if (e.key === "Tab") trapFocus($("drawer"), e);
    return;
  }
  if (e.ctrlKey && (e.key === "/" || e.code === "Slash")) {
    e.preventDefault();
    openSheet();
    return;
  }
  if (e.key === "Escape" && !$("help-pop").hidden) {
    toggleHelp(false);
    $("btn-help").focus();
  }
});

// ---------- Shortcuts sheet ----------
let sheetReturnFocus: HTMLElement | null = null;
function openSheet() {
  const body = $("sheet-body");
  body.textContent = "";
  body.appendChild(renderSections(shortcutSections(S(), hotkeyProblems, { editor: true })));
  sheetReturnFocus = document.activeElement as HTMLElement;
  $("sheet-backdrop").hidden = false;
  $("btn-close-sheet").focus();
}
function closeSheet() {
  $("sheet-backdrop").hidden = true;
  sheetReturnFocus?.focus();
}
$("btn-shortcuts").onclick = openSheet;
$("btn-close-sheet").onclick = closeSheet;
$("btn-change-hotkeys").onclick = () => {
  closeSheet();
  openSettings("hotkeys");
};
$("sheet-backdrop").addEventListener("mousedown", (e) => {
  if (e.target === e.currentTarget) closeSheet();
});
$("btn-sensitivity").onclick = () => openSettings("voice");

// ---------- Status strip: anything unusual, each with a one-click fix ----------
interface Notice {
  id: string;
  kind: "warn" | "info";
  text: string;
  action?: { label: string; run: () => void };
  /** Runs when the message times out, besides hiding it for now (e.g. remember it was read). */
  onClose?: () => void;
}
let splashDone = false;
/** The prompter has been shown at some point this session. */
let prompterOpened = false;
const dismissedNotices = new Set<string>();

const keysFor = (a: Action) => S().hotkeys[a]?.replace(/\+/g, " + ") ?? "";

function currentNotices(): Notice[] {
  const s = S();
  const out: Notice[] = [];
  if (s.clickThrough) {
    const k = keysFor("toggle-click-through");
    out.push({
      id: "click-through",
      kind: "warn",
      text: `Click-through is on: clicks go to the app under the prompter.${k ? ` ${k} turns it off from any app.` : ""}`,
      action: { label: "Turn Off", run: () => set("clickThrough", false) },
    });
  }
  if (hotkeyProblems.length) {
    const first = hotkeyProblems[0];
    const name = ACTION_LABELS[first.action as Action] ?? "a hotkey";
    out.push({
      id: "hotkeys",
      kind: "warn",
      text: hotkeyProblems.length === 1
        ? `${first.keys} (${name}) is taken by another app, so it won't work.`
        : `${hotkeyProblems.length} hotkeys are taken by other apps, so they won't work.`,
      action: { label: "Change", run: () => openSettings("hotkeys") },
    });
  }
  // Only once the prompter has been opened: at launch it's hidden on purpose.
  if (splashDone && status && !status.visible && prompterOpened) {
    const k = keysFor("toggle-prompter");
    out.push({
      id: "prompter-hidden",
      kind: "info",
      text: `The prompter is hidden.${k ? ` ${k} shows it from any app.` : ""}`,
      action: { label: "Show", run: () => showPrompter(true) },
    });
  }
  if (s.mode !== "manual" && status && !status.playing && !status.counting && active()?.body.trim()) {
    out.push({
      id: "voice-wait",
      kind: "info",
      text: s.mode === "follow"
        ? "Follow My Voice starts when you press Start Prompting. Then read aloud."
        : "Voice scrolling starts when you press Start Prompting. Then start talking.",
    });
  }
  if (splashDone && s.hideFromTaskbar && !s.seenTrayTip) {
    const k = keysFor("toggle-controls");
    out.push({
      id: "tray-tip",
      kind: "info",
      text: `This window stays off the taskbar. Minimising sends it to the tray, by the clock.${k ? ` ${k} brings it back.` : ""}`,
      onClose: () => set("seenTrayTip", true),
    });
  }
  return out;
}

/** Rows on screen, by message id, so a message that stays keeps its timer running. */
const noticeRows = new Map<string, HTMLElement>();

function renderNotices() {
  // Messages wait until the start screen is gone, so their timers don't run out unseen.
  if (!splashDone) return;
  const all = currentNotices();
  // A message that goes away and comes back later should show again.
  for (const id of [...dismissedNotices]) if (!all.some((n) => n.id === id)) dismissedNotices.delete(id);
  const list = all.filter((n) => !dismissedNotices.has(n.id));
  const host = $("notices");
  // A message whose reason has gone leaves straight away.
  for (const [id, row] of noticeRows) {
    if (!row.dataset.leaving && !list.some((n) => n.id === id)) {
      row.remove();
      noticeRows.delete(id);
    }
  }
  let fresh: Notice["kind"] | null = null;
  for (const n of list) {
    const existing = noticeRows.get(n.id);
    if (existing) {
      const text = existing.querySelector(".text")!;
      if (text.textContent !== n.text) text.textContent = n.text;
      continue;
    }
    const row = el("div", `notice ${n.kind}`);
    row.append(el("span", "text", n.text));
    if (n.action) {
      const b = el("button", "btn small", n.action.label);
      b.onclick = n.action.run;
      row.appendChild(b);
    }
    // The bar along the bottom shrinks as the time runs out. Hovering pauses it.
    const ms = Math.max(6000, n.text.length * 70);
    const bar = el("span", "notice-timer");
    bar.style.animationDuration = `${ms}ms`;
    bar.addEventListener("animationend", () => dismissNotice(n, row));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => dismissNotice(n, row), ms);
    row.appendChild(bar);
    host.appendChild(row);
    noticeRows.set(n.id, row);
    if (fresh !== "warn") fresh = n.kind;
  }
  if (fresh) noticeSound(fresh);
}

function dismissNotice(n: Notice, row: HTMLElement) {
  if (row.dataset.leaving || !row.isConnected) return;
  row.dataset.leaving = "true";
  dismissedNotices.add(n.id);
  const finish = () => {
    row.remove();
    if (noticeRows.get(n.id) === row) noticeRows.delete(n.id);
    n.onClose?.();
    renderNotices();
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
  row.animate(
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 240, easing: "ease-in", fill: "forwards" },
  ).onfinish = finish;
}

/** A soft two-note chime when a message pops up; lower for warnings. */
let noticeAudio: AudioContext | null = null;
function noticeSound(kind: Notice["kind"]) {
  try {
    noticeAudio ??= new AudioContext();
    const ctx = noticeAudio;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const notes = kind === "warn" ? [660, 880] : [784, 1175];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    // No sound is fine.
  }
}

// ---------- Present panel ----------
function buildPresent() {
  // The same plain sliders as in Settings.
  $("quick").append(renderField(speedField), renderField(fontSizeField));
  document.querySelectorAll<HTMLInputElement>('#modes input[name="mode"]').forEach((r) => {
    r.onchange = () => r.checked && set("mode", r.value as ScrollMode);
  });
  refreshers.push(() => {
    const s = S();
    document.querySelectorAll<HTMLInputElement>('#modes input[name="mode"]').forEach((r) => (r.checked = r.value === s.mode));
    $("voice-box").hidden = s.mode === "manual";
    $<HTMLInputElement>("rec-switch").checked = isProtected();
    $("p-mark").style.left = `${threshold() * 100}%`;
    renderStatus();
  });
}

/** Recording protection is on when both windows are hidden from recordings and screenshots aren't allowed. */
const isProtected = () => S().hidePrompterFromCapture && S().hideControlsFromCapture && !S().allowScreenshots;

$("start").onclick = async () => {
  if (!active()?.body.trim()) return;
  const running = status?.playing || status?.counting;
  // Starting while recordings can see the prompter: warn first.
  if (!running && !isProtected()) {
    const choice = await choiceDialog(
      "Recording protection is off",
      "Recordings and screen sharing will show the prompter and this window.",
      "Turn On and Start",
      "btn primary",
      "Start Anyway",
      "btn danger-fill",
    );
    if (choice === "cancel") return;
    if (choice === "ok") setProtection(true);
  }
  cmd({ type: running ? "pause" : "play" });
  showPrompter();
};

/**
 * Protection was just turned off (switch, Settings or the screenshot hotkey).
 * If the script is scrolling, pause it at once and ask what to do.
 */
async function protectionTurnedOff() {
  if (!(status?.playing || status?.counting)) return;
  cmd({ type: "pause" });
  if (dialogResolve) return; // a dialog is already up; the pause is what matters
  const choice = await choiceDialog(
    "Recording protection is off",
    "The script is paused. Recordings and screen sharing will now show the prompter and this window.",
    "Turn On and Resume",
    "btn primary",
    "Resume Anyway",
    "btn danger-fill",
  );
  if (choice === "cancel") return;
  if (choice === "ok") setProtection(true);
  cmd({ type: "play" });
}
$("t-rewind").onclick = () => cmd({ type: "rewind" });
$("t-back").onclick = () => cmd({ type: "back" });
$("t-fwd").onclick = () => cmd({ type: "forward" });
$("bar").onclick = (e) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  cmd({ type: "seek", fraction: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) });
};
$("bar").onkeydown = (e) => {
  if (!status) return;
  if (e.key === "ArrowRight") cmd({ type: "seek", fraction: Math.min(1, status.progress + 0.05) });
  else if (e.key === "ArrowLeft") cmd({ type: "seek", fraction: Math.max(0, status.progress - 0.05) });
  else return;
  e.preventDefault();
};
$("nav-hotkeys").onclick = () => openSettings("hotkeys");
$("nav-appearance").onclick = () => openSettings("look");
$("nav-scripts").onclick = () => $("search").focus();
let aboutTimer: number | undefined;
$("nav-about").onclick = () => {
  // About stays highlighted while its message shows, then Scripts takes it back.
  setNav("nav-about");
  clearTimeout(aboutTimer);
  aboutTimer = window.setTimeout(() => {
    if ($("drawer-backdrop").hidden) setNav("nav-scripts");
  }, 2600);
  const credit = $("credit");
  credit.classList.remove("highlight");
  void credit.offsetWidth;
  credit.classList.add("highlight");
  toast("Made by Janitha Illankoon. A star on GitHub helps other presenters find it.");
};
$("btn-tray").onclick = async () => {
  const w = await Window.getByLabel("main");
  if (!w) return;
  const k = keysFor("toggle-controls");
  toast(`Minimised to the tray${k ? `. ${k} brings it back` : ""}.`);
  await w.hide();
};
function setProtection(on: boolean) {
  // Turning protection on also ends "Allow screenshots", otherwise the switch would stay off and look broken.
  data.settings = { ...S(), hidePrompterFromCapture: on, hideControlsFromCapture: on, ...(on ? { allowScreenshots: false } : {}) };
  save();
  pushSettings();
  applyCapture();
  refreshFields();
}
$("rec-switch").onchange = (e) => setProtection((e.target as HTMLInputElement).checked);

let status: PrompterStatus | null = null;
function fmt(sec: number) {
  if (sec < 0 || !Number.isFinite(sec)) return "--:--";
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function renderStatus() {
  const st = status;
  const hasText = !!active()?.body.trim();
  const start = $<HTMLButtonElement>("start");
  start.disabled = !hasText;
  start.dataset.playing = String(hasText && !!st && (st.playing || st.counting > 0));
  const hk = S().hotkeys["play-pause"];
  const hkBroken = hotkeyProblems.some((p) => p.action === "play-pause");
  $("start-hint").textContent = !hasText
    ? "Write or import a script first."
    : !hk ? "No play/pause hotkey set."
    : hkBroken ? `${hk.replace(/\+/g, " + ")} isn't available right now.`
    : "";
  renderNotices();
  const startMain = $("start-main");
  if (!hasText) startMain.innerHTML = `${PLAY}<span>Start Prompting</span>`;
  if (!st) return;
  if (hasText) {
    const running = st.playing || st.counting > 0;
    const label = st.counting ? `Starting in ${st.counting}…` : st.playing ? "Pause" : st.progress > 0.001 ? "Resume" : "Start Prompting";
    startMain.innerHTML = `${running ? PAUSE : PLAY}<span>${label}</span>`;
  }
  $("bar").style.setProperty("--p", String(st.progress));
  $("bar").classList.toggle("playing", st.playing);
  $("bar").setAttribute("aria-valuetext", `${Math.round(st.progress * 100)}% through`);
  $("elapsed").textContent = fmt(st.elapsed);
  $("remaining").textContent = `-${fmt(st.remaining)}`;
  $("wpm").textContent = st.wpm > 0 ? `about ${st.wpm} words/min` : "";
  $("btn-prompter-label").textContent = st.visible ? "Hide Prompter" : "Show Prompter";

  const box = $("voice-box");
  const heard = $("heard");
  box.classList.toggle("error", !!st.voice.error);
  if (st.voice.error) heard.textContent = st.voice.error;
  else if (st.voice.loading) heard.textContent = "Starting the microphone…";
  else if (!st.voice.running) heard.textContent = st.visible ? "Microphone off" : "Microphone off while the prompter is hidden";
  else if (!st.playing && !st.counting) heard.textContent = `Microphone ready: ${st.voice.device}`;
  else if (st.voice.recognizing) heard.textContent = st.voice.heard ? `Heard: "${st.voice.heard}"` : `Listening on ${st.voice.device}`;
  else heard.textContent = st.voice.speaking ? "Hearing you, scrolling" : `Quiet, paused. Listening on ${st.voice.device}`;
}

listen<PrompterStatus>("gp:status", (e) => {
  status = e.payload;
  if (status.visible) prompterOpened = true;
  renderStatus();
});

listen<{ level: number }>("gp:voice-level", (e) => {
  const pct = `${Math.round(e.payload.level * 100)}%`;
  const hot = e.payload.level >= threshold();
  for (const m of [drawerMeter, $("p-meter")]) {
    if (!m) continue;
    m.style.width = pct;
    m.classList.toggle("hot", hot);
  }
});

listen<Partial<Settings>>("gp:patch", (e) => {
  data.settings = { ...S(), ...e.payload };
  // Changes made on the prompter itself save as before, even with Settings open.
  if (settingsBase) settingsBase = { ...settingsBase, ...e.payload };
  save();
  refreshFields();
});

// A Settings button on one of the prompter's tips: bring this window up on that tab.
listen<string>("gp:open-settings", async (e) => {
  const w = await Window.getByLabel("main");
  if (w) {
    await w.unminimize().catch(() => {});
    await w.show().catch(() => {});
    await w.setFocus().catch(() => {});
  }
  if ($("drawer-backdrop").hidden) openSettings(e.payload);
  else selectTab(e.payload);
});

listen("gp:prompter-hidden", () => {
  const k = keysFor("toggle-prompter");
  toast(`Prompter hidden. Use Show Prompter${k ? ` or ${k}` : ""} to bring it back.`);
});

// The screenshot hotkey flips the setting, so the switch in All settings always shows the real state.
listen("gp:toggle-screenshots", () => {
  const on = !S().allowScreenshots;
  if (settingsBase) settingsBase = { ...settingsBase, allowScreenshots: on };
  set("allowScreenshots", on);
  toast(on ? "Screenshots allowed. The prompter and this window show in screenshots and recordings." : "Screenshots off. The prompter and this window are hidden again.");
});

// The window's close button asks before quitting while a script is scrolling.
listen("gp:close-requested", async () => {
  const running = status?.playing || (status?.counting ?? 0) > 0;
  if (running) {
    const ok = await confirmDialog(
      "Quit while the script is scrolling?",
      "Closing this window quits Ghost In The Script, and the prompter closes too.",
      "Quit",
    );
    if (!ok) return;
  }
  await saveNow();
  invoke("quit_app");
});

listen("gp:prompter-ready", () => {
  pushSettings();
  pushScript(true);
});

function refreshFields() {
  for (const r of refreshers) r();
  updateSaveState();
}

// ---------- Scripts list + editor ----------
const bodyEl = $<HTMLTextAreaElement>("body");
const titleEl = $<HTMLInputElement>("title");

function relTime(t: number) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function renderList() {
  const q = $<HTMLInputElement>("search").value.trim().toLowerCase();
  const list = $("list");
  list.innerHTML = "";
  const scripts = [...data.scripts].sort((a, b) => b.updatedAt - a.updatedAt);
  let shown = 0;
  for (const s of scripts) {
    if (q && !s.title.toLowerCase().includes(q) && !s.body.toLowerCase().includes(q)) continue;
    shown++;
    const li = el("li");
    const b = el("button", "script-item");
    b.setAttribute("aria-current", String(s.id === data.activeScriptId));
    const tile = el("span", "si-icon");
    tile.innerHTML = ICONS.scripts;
    const text = el("span", "si-text");
    text.append(el("span", "t", s.title.trim() || "Untitled script"), el("span", "m", `${countWords(s.body)} words \u2022 ${relTime(s.updatedAt)}`));
    b.append(tile, text);
    b.onclick = () => selectScript(s.id);
    li.appendChild(b);
    list.appendChild(li);
  }
  $("list-empty").hidden = shown > 0;
  $("list-head").hidden = shown === 0;
  $("list-empty-text").textContent = `No scripts match "${q}".`;
}

function loadEditor() {
  const s = active();
  titleEl.value = s?.title ?? "";
  bodyEl.value = s?.body ?? "";
  updateStats();
  renderStatus();
  if (previewing) renderPreview();
}

// ---------- Preview: the script with its formatting applied, instead of the markup ----------
let previewing = false;
function renderPreview() {
  const box = $("preview");
  renderScript(bodyEl.value, box);
  if (!box.childElementCount) box.innerHTML = '<p class="preview-empty">Nothing to preview yet.</p>';
}
function setPreview(on: boolean) {
  previewing = on;
  if (on) renderPreview();
  $("preview").hidden = !on;
  bodyEl.hidden = on;
  $("btn-preview").setAttribute("aria-pressed", String(on));
  // Shows the eye while editing (press to preview) and the pencil while previewing (press to edit).
  $("btn-preview").innerHTML = on ? ICONS.pencil : ICONS.eye;
  const tip = on ? "Edit: back to the script's text and formatting marks" : "Preview: see the script formatted, the way the prompter shows it";
  $("btn-preview").title = tip;
  $("btn-preview").setAttribute("aria-label", tip);
  // The formatting buttons only work on the editable text.
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".format-bar [data-wrap], #btn-cue, #fmt-color").forEach((b) => (b.disabled = on));
  (on ? $("preview") : bodyEl).focus();
}
$("btn-preview").onclick = () => setPreview(!previewing);
// Double-click the preview to go back to editing.
$("preview").ondblclick = () => setPreview(false);

function updateStats() {
  const wc = countWords(bodyEl.value);
  const secs = Math.round((wc / 150) * 60);
  const dur = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  $("wc").textContent = String(wc);
  $("dur").textContent = dur;
}


function selectScript(id: string) {
  data.activeScriptId = id;
  save();
  loadEditor();
  renderList();
  pushScript(true);
}

function addScript(title: string, body: string) {
  const now = Date.now();
  const s: Script = { id: uid(), title, body, createdAt: now, updatedAt: now };
  data.scripts.push(s);
  selectScript(s.id);
  return s;
}

let listTimer: number | undefined;
bodyEl.addEventListener("input", () => {
  const s = active();
  if (!s) return;
  s.body = bodyEl.value;
  s.updatedAt = Date.now();
  setSaveStatus("saving");
  save();
  pushScript();
  updateStats();
  renderStatus();
  clearTimeout(listTimer);
  listTimer = window.setTimeout(renderList, 600);
});
titleEl.addEventListener("input", () => {
  const s = active();
  if (!s) return;
  s.title = titleEl.value;
  s.updatedAt = Date.now();
  save();
  renderList();
});

function wrapSelection(before: string, after = before) {
  const s = bodyEl.selectionStart;
  const e = bodyEl.selectionEnd;
  const sel = bodyEl.value.slice(s, e);
  bodyEl.focus();
  bodyEl.setRangeText(before + sel + after, s, e, "select");
  if (!sel) bodyEl.setSelectionRange(s + before.length, s + before.length);
  bodyEl.dispatchEvent(new Event("input"));
}

document.querySelectorAll<HTMLButtonElement>("[data-wrap]").forEach((b) => (b.onclick = () => wrapSelection(b.dataset.wrap!)));
$("btn-cue").onclick = () => wrapSelection("[", "]");
$<HTMLInputElement>("fmt-color").onchange = (e) => wrapSelection(`{${(e.target as HTMLInputElement).value}}`, "{/}");
bodyEl.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const marks: Record<string, string> = { b: "**", i: "*", u: "__", h: "==" };
  if (marks[k]) {
    e.preventDefault();
    wrapSelection(marks[k]);
  }
});

function toggleHelp(force?: boolean) {
  const pop = $("help-pop");
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  $("btn-help").setAttribute("aria-expanded", String(open));
}
$("btn-help").onclick = () => toggleHelp();
document.addEventListener("mousedown", (e) => {
  const t = e.target as Node;
  if (!$("help-pop").hidden && !$("help-pop").contains(t) && !$("btn-help").contains(t)) toggleHelp(false);
});

$("btn-new").onclick = () => {
  addScript("", "");
  if (previewing) setPreview(false); // a new script needs the editor
  titleEl.focus();
};
$("btn-import").onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  await importFiles(Array.from(input.files ?? []));
  input.value = "";
};
$("btn-dup").onclick = () => {
  const s = active();
  if (!s) return;
  addScript(`${s.title || "Untitled script"} (copy)`, s.body);
  toast("Copy created");
};
$("btn-del").onclick = async () => {
  const s = active();
  if (!s) return;
  const name = s.title.trim() || "Untitled script";
  const ok = await confirmDialog(`Delete "${name}"?`, "The script is removed from this PC. This can't be undone.", "Delete Script");
  if (!ok) return;
  data.scripts = data.scripts.filter((x) => x.id !== s.id);
  if (data.scripts.length === 0) addScript("", "");
  else selectScript([...data.scripts].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  toast(`Deleted "${name}"`);
};
$("btn-export").onclick = () => {
  const s = active();
  if (!s) return;
  const blob = new Blob([s.body], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.title.trim() || "script").replace(/[\\/:*?"<>|]+/g, "_")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Saved to your Downloads folder");
};
$("search").oninput = () => renderList();
$("btn-clear-search").onclick = () => {
  $<HTMLInputElement>("search").value = "";
  renderList();
  $("search").focus();
};

async function importFiles(files: File[]) {
  let ok = 0;
  for (const f of files) {
    try {
      const { title, body } = await importFile(f);
      addScript(title, body);
      ok++;
    } catch (err) {
      toast(`Couldn't import ${f.name}: ${err}`, true);
    }
  }
  if (ok) toast(ok === 1 ? "Script imported" : `${ok} scripts imported`);
}

// Drag-and-drop import
const drop = $("drop");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    dragDepth++;
    drop.hidden = false;
  }
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) drop.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) importFiles(files);
});

// ---------- Window, capture & hotkeys ----------
/** Protection state the last time it was applied (null before the first time). */
let wasProtected: boolean | null = null;
async function applyCapture() {
  const nowProtected = isProtected();
  if (wasProtected === true && !nowProtected) protectionTurnedOff();
  wasProtected = nowProtected;
  const results = await Promise.all(
    ([["prompter", S().hidePrompterFromCapture && !S().allowScreenshots], ["main", S().hideControlsFromCapture && !S().allowScreenshots]] as [string, boolean][]).map(([label, hidden]) =>
      invoke<{ hidden: boolean }>("set_capture_hidden", { label, hidden }).then((r) => r.hidden).catch(() => null),
    ),
  );
  if (results.some((r) => r === null)) toast("Couldn't change recording visibility. It needs Windows 10 version 2004 or newer.", true);
}

async function applyTaskbar() {
  await invoke("set_taskbar_hidden", { hidden: S().hideFromTaskbar }).catch((e) => toast(`Couldn't change the taskbar setting: ${e}`, true));
}

async function applyHotkeys() {
  hotkeyProblems = await invoke<HotkeyProblem[]>("set_hotkeys", { hotkeys: S().hotkeys }).catch((e) => [
    { action: "", keys: "Hotkeys", message: String(e) },
  ]);
  refreshFields();
}

async function showPrompter(focus = false) {
  const w = await Window.getByLabel("prompter");
  if (!w) return;
  if (!(await w.isVisible())) await w.show();
  if (focus) await w.setFocus();
}

$("btn-prompter").onclick = async () => {
  const w = await Window.getByLabel("prompter");
  if (!w) return;
  // A minimised prompter counts as hidden, so one click always brings it back.
  if ((await w.isVisible()) && !(await w.isMinimized())) await w.hide();
  else {
    await w.unminimize().catch(() => {});
    await w.show();
    await w.setFocus();
  }
};

async function centerPrompter() {
  const w = await Window.getByLabel("prompter");
  if (!w) return;
  const mon = await primaryMonitor();
  const size = await w.outerSize();
  if (mon) await w.setPosition(new PhysicalPosition(mon.position.x + Math.round((mon.size.width - size.width) / 2), mon.position.y + 16));
  await w.show();
  toast("Prompter moved to the top centre of the screen");
}

async function loadDevices(announce = false) {
  micDevices = await invoke<string[]>("voice_devices").catch(() => []);
  refreshFields();
  if (announce) toast(micDevices.length ? `${micDevices.length} microphone${micDevices.length > 1 ? "s" : ""} found` : "No microphones found", !micDevices.length);
}

// ---------- Start ----------
const splash = initSplash({
  // The prompter stays hidden until the person opens it.
  onContinue: () => {
    splashDone = true;
    renderNotices();
  },
  onError: (msg) => toast(msg, true),
});

async function init() {
  let loadProblem = "";
  try {
    const raw = await invoke<string | null>("load_data");
    data = raw ? normalizeData(JSON.parse(raw), freshData) : freshData();
  } catch (e) {
    loadProblem = String(e);
    data = freshData();
  }
  if (!data.activeScriptId && data.scripts[0]) data.activeScriptId = data.scripts[0].id;
  buildSettings();
  buildPresent();
  renderList();
  loadEditor();
  refreshFields();
  ready = !loadProblem;
  pushSettings();
  pushScript(true);
  applyCapture();
  applyTaskbar();
  applyHotkeys();
  loadDevices();
  setInterval(renderList, 60000);
  splash.ready();
  if (loadProblem) {
    // Don't overwrite a file we couldn't read; let the person decide.
    showBanner(`Your saved scripts couldn't be read (${loadProblem}). Nothing is saved until you select Save anyway, which replaces the old file.`);
    $("btn-retry-save").textContent = "Save Anyway";
    $("btn-retry-save").onclick = () => {
      ready = true;
      $("btn-retry-save").textContent = "Try Again";
      $("btn-retry-save").onclick = () => saveNow();
      saveNow();
    };
  } else {
    save();
  }
}

init().catch((e) => splash.failed(`Something went wrong while opening: ${e}`));
