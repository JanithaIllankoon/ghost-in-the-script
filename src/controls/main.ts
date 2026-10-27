import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, Window, primaryMonitor } from "@tauri-apps/api/window";

import logoUrl from "../assets/logo-256.png";
import { importFile } from "../shared/importers";
import { renderSections, shortcutSections } from "../shared/shortcuts";
import { creditHtml, initSplash, splashHtml } from "./splash";
import { initTheme } from "./theme";
import { countWords } from "../shared/markup";
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
    await invoke("save_data", { json: JSON.stringify(data) });
    showBanner(null);
    $("saved").textContent = "Saved";
  } catch (e) {
    showBanner(`Couldn't save your latest changes: ${e}`);
  }
}

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
  eyeOff: icon('<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.9 3.6M6.4 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  pin: icon('<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3z"/><path d="M12 13.5V20"/>'),
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
        <div class="name">Ghost In The Script<small>A little less seen. A lot more confident.</small></div>
      </div>
      <nav class="nav" aria-label="Main">
        <button aria-current="page" id="nav-scripts">${ICONS.scripts}<span>Scripts</span></button>
        <button id="btn-settings">${ICONS.settings}<span>Settings</span></button>
        <button id="nav-hotkeys">${ICONS.hotkeys}<span>Hotkeys</span></button>
        <button id="nav-appearance">${ICONS.appearance}<span>Appearance</span></button>
        <button id="nav-about">${ICONS.about}<span>About</span></button>
      </nav>
      <div class="scripts-actions">
        <button class="btn primary" id="btn-new">${ICONS.plus}<span>New script</span></button>
        <button class="btn quiet" id="btn-import">${ICONS.upload}<span>Import file</span></button>
      </div>
      <div class="list-head" id="list-head">SCRIPTS</div>
      <div class="search-wrap">
        ${ICONS.search}
        <input class="search" id="search" type="search" placeholder="Search scripts..." aria-label="Search scripts" />
      </div>
      <ul class="script-list" id="list"></ul>
      <div class="list-empty" id="list-empty" hidden>
        <p id="list-empty-text"></p>
        <button class="btn small" id="btn-clear-search">Clear search</button>
      </div>
      <input type="file" id="file" accept=".txt,.md,.markdown,.docx,.rtf" multiple hidden />
      <div class="side-foot">
        ${creditHtml()}
        <div class="side-row">
          <span class="version">v1.5.1</span>
          <button class="theme-toggle" id="theme-toggle" role="switch" aria-checked="false" aria-label="Dark mode">
            ${ICONS.moon}<span id="theme-label">Light mode</span><span class="theme-track" aria-hidden="true"><span></span></span>
          </button>
        </div>
      </div>
    </aside>

    <main class="write" aria-label="Script editor">
      <div class="banner" id="save-error" role="alert" hidden>
        <span id="save-error-text"></span>
        <button class="btn small" id="btn-retry-save">Try again</button>
      </div>
      <div class="write-head">
        <span class="file-tile" aria-hidden="true">${ICONS.scripts}</span>
        <div class="write-title">
          <input class="title-input" id="title" placeholder="Name this script" aria-label="Script name" />
          <span class="write-meta"><b id="wc">0</b> words <i aria-hidden="true">&bull;</i> About <b id="dur">0:00</b> at a normal speaking pace</span>
        </div>
        <div class="write-actions">
          <button class="btn small" id="btn-dup">Duplicate</button>
          <button class="btn small" id="btn-export">Save as .txt</button>
          <button class="btn small danger" id="btn-del">Delete</button>
        </div>
      </div>
      <div class="format-bar" role="toolbar" aria-label="Formatting">
        <button class="btn" data-wrap="**" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
        <button class="btn" data-wrap="*" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
        <button class="btn" data-wrap="__" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
        <button class="btn" data-wrap="==" title="Highlight (Ctrl+H)">Highlight</button>
        <span class="divider"></span>
        <button class="btn" id="btn-cue" title="A note to yourself. Shown in gold, skipped by voice tracking.">Add cue</button>
        <span class="color-pick" title="Colour the selected words"><input type="color" id="fmt-color" value="#e9b75f" aria-label="Colour the selected words" /></span>
        <span class="divider"></span>
        <button class="btn quiet" id="btn-help" aria-expanded="false" aria-controls="help-pop">Formatting help</button>
        <div class="help-pop" id="help-pop" role="dialog" aria-label="Formatting help" hidden>
          <h3>Formatting</h3>
          <dl>
            <dt>**bold**</dt><dd><b>bold</b></dd>
            <dt>*italic*</dt><dd><i>italic</i></dd>
            <dt>__underline__</dt><dd><u>underline</u></dd>
            <dt>==highlight==</dt><dd>highlighted words</dd>
            <dt>[note]</dt><dd><span class="cue-sample">a cue for you</span>, not read by voice tracking</dd>
            <dt>{red}words{/}</dt><dd>any colour name or #hex</dd>
            <dt>blank line</dt><dd>new paragraph</dd>
          </dl>
        </div>
      </div>
      <div class="editor-wrap">
        <textarea class="script" id="body" spellcheck="true" aria-label="Script text"
          placeholder="Paste or type your script here.&#10;&#10;Or drop a .txt, .md or .docx file onto this window."></textarea>
        <div class="drop-hint" id="drop" hidden>Drop to import</div>
      </div>
      <div class="write-foot">
        <span><b id="wc2">0</b> words</span>
        <span>About <b id="dur2">0:00</b> at a normal speaking pace</span>
        <span class="saved" id="saved"></span>
      </div>
    </main>

    <aside class="present" aria-label="Present">
      <div class="present-body">
        <button class="start" id="start"><span class="start-main" id="start-main">${PLAY}<span>Start prompting</span></span><kbd class="start-keys" id="start-keys" hidden></kbd></button>
        <p class="start-hint"><span id="start-hint"></span> <button class="link" id="btn-shortcuts">Keyboard shortcuts and gestures (Ctrl+/)</button></p>

        <div class="notices" id="notices" aria-live="polite"></div>

        <div class="progress">
          <button class="bar" id="bar" aria-label="Jump to a point in the script" title="Click to jump to that point in the script"><span class="fill" id="fill"></span></button>
          <div class="meta"><span id="elapsed">0:00</span><span id="wpm"></span><span id="remaining">-0:00</span></div>
        </div>
        <div class="nav-row">
          <button class="btn small" id="t-rewind">To start</button>
          <button class="btn small" id="t-back">Line up</button>
          <button class="btn small" id="t-fwd">Line down</button>
        </div>

        <section>
          <h2 class="group-title" id="modes-title">Scrolling mode</h2>
          <fieldset class="modes" id="modes" aria-labelledby="modes-title">
            ${(["manual", "voice", "follow"] as ScrollMode[]).map((m) => `
              <label class="mode">
                <input type="radio" name="mode" value="${m}" />
                <span class="tick" aria-hidden="true">${ICONS.check}</span>
                <span class="mode-icon" aria-hidden="true">${ICONS[m]}</span>
                <b>${MODE_LABELS[m]}</b>
                <small>${MODE_SHORT[m]}</small>
              </label>`).join("")}
          </fieldset>
        </section>

        <div class="voice-box" id="voice-box" hidden>
          <div class="meter" aria-hidden="true" title="Your microphone level. The gold mark is how loud you need to be for it to count as talking."><div class="fill" id="p-meter"></div><div class="mark" id="p-mark"></div></div>
          <div class="heard" id="heard" role="status"></div>
          <button class="link" id="btn-sensitivity">Adjust sensitivity</button>
        </div>

        <div class="quick" id="quick"></div>

        <div class="panel-actions">
          <button class="btn primary" id="btn-prompter">${ICONS.pin}<span id="btn-prompter-label">Show prompter</span></button>
          <button class="btn" id="btn-tray">${ICONS.tray}<span>Minimise to tray</span></button>
        </div>

        <section class="rec-card">
          <div class="rec-head">
            <span class="rec-icon" aria-hidden="true">${ICONS.eyeOff}</span>
            <b>Recording protection</b>
            <span class="switch rec-switch"><input type="checkbox" role="switch" id="rec-switch" aria-label="Hide the prompter and this window from recordings" /><span></span></span>
          </div>
          <button class="link" id="btn-recording">Recording settings <span aria-hidden="true">↗</span></button>
        </section>
      </div>
    </aside>
  </div>

  <div class="backdrop" id="drawer-backdrop" hidden>
    <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" id="drawer">
      <div class="drawer-head">
        <h2 id="drawer-title">Settings</h2>
        <button class="btn quiet small" id="btn-close-settings">Close</button>
      </div>
      <div class="tabs" role="tablist" id="tabs"></div>
      <div id="panels" style="display:contents"></div>
      <div class="drawer-foot">
        <small>Changes apply right away and are saved.</small>
        <button class="btn small danger" id="btn-reset">Reset settings</button>
      </div>
    </div>
  </div>

  <div class="backdrop" id="dialog-backdrop" hidden>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-body">
      <h2 id="dialog-title"></h2>
      <p id="dialog-body"></p>
      <div class="actions">
        <button class="btn" id="dialog-cancel">Cancel</button>
        <button class="btn primary" id="dialog-ok"></button>
      </div>
    </div>
  </div>

  <div class="backdrop" id="sheet-backdrop" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" id="sheet">
      <div class="sheet-head">
        <h2 id="sheet-title">Shortcuts and gestures</h2>
        <button class="btn small" id="btn-change-hotkeys">Change hotkeys</button>
        <button class="btn quiet small" id="btn-close-sheet">Close</button>
      </div>
      <div class="sheet-body" id="sheet-body"></div>
    </div>
  </div>

  <div class="toast" id="toast" role="status" hidden></div>`;

initTheme();
document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button || button.disabled || button.getAttribute("aria-disabled") === "true" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  button.animate([
    { boxShadow: "0 0 0 0 var(--feedback)" },
    { boxShadow: "0 0 0 5px transparent" },
  ], { duration: 380, easing: "ease-out" });
});

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

function showBanner(msg: string | null) {
  $("save-error").hidden = !msg;
  if (msg) {
    $("save-error-text").textContent = msg;
    $("saved").textContent = "Not saved";
  }
}
$("btn-retry-save").onclick = () => saveNow();

let dialogResolve: ((ok: boolean) => void) | null = null;
let dialogReturnFocus: HTMLElement | null = null;
function confirmDialog(title: string, body: string, okLabel: string, danger = true): Promise<boolean> {
  $("dialog-title").textContent = title;
  $("dialog-body").textContent = body;
  const ok = $("dialog-ok");
  ok.textContent = okLabel;
  ok.className = danger ? "btn danger" : "btn primary";
  dialogReturnFocus = document.activeElement as HTMLElement;
  $("dialog-backdrop").hidden = false;
  $("dialog-cancel").focus();
  return new Promise((resolve) => (dialogResolve = resolve));
}
function closeDialog(result: boolean) {
  $("dialog-backdrop").hidden = true;
  dialogResolve?.(result);
  dialogResolve = null;
  dialogReturnFocus?.focus();
}
$("dialog-ok").onclick = () => closeDialog(true);
$("dialog-cancel").onclick = () => closeDialog(false);
$("dialog-backdrop").addEventListener("mousedown", (e) => {
  if (e.target === e.currentTarget) closeDialog(false);
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
  | { type: "heading"; text: string }
  | { type: "custom"; render: () => HTMLElement };

const refreshers: (() => void)[] = [];
let fieldSeq = 0;

function renderField(f: Field): HTMLElement {
  if (f.type === "custom") return f.render();
  if (f.type === "heading") return el("h3", undefined, f.text);
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

// ---------- Settings content ----------
const FONTS = [
  "Segoe UI", "Arial", "Verdana", "Tahoma", "Calibri", "Bahnschrift", "Candara", "Corbel",
  "Trebuchet MS", "Georgia", "Cambria", "Times New Roman", "Sitka Text", "Consolas", "Comic Sans MS",
];
let micDevices: string[] = [];
let hotkeyProblems: HotkeyProblem[] = [];

const threshold = () => 0.75 - (S().voiceSensitivity / 100) * 0.55;

const fontSizeField: Field = { type: "range", key: "fontSize", label: "Text size", min: 16, max: 160, step: 1, unit: "px" };
const speedField: Field = { type: "range", key: "speed", label: "Speed", min: 1, max: 100, step: 1 };

const TABS: { id: string; label: string; fields: Field[] }[] = [
  {
    id: "text", label: "Text",
    fields: [
      { type: "select", key: "fontFamily", label: "Font", options: () => {
        const list = FONTS.includes(S().fontFamily) ? FONTS : [S().fontFamily, ...FONTS];
        return list.map((f) => [f, f] as [string, string]);
      } },
      fontSizeField,
      { type: "select", key: "fontWeight", label: "Weight", options: [["300", "Light"], ["400", "Regular"], ["600", "Semibold"], ["700", "Bold"], ["900", "Black"]] },
      { type: "range", key: "lineHeight", label: "Line spacing", min: 1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
      { type: "range", key: "paragraphSpacing", label: "Space between paragraphs", min: 0, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)} lines` },
      { type: "range", key: "letterSpacing", label: "Letter spacing", min: -2, max: 12, step: 0.5, unit: "px" },
      { type: "range", key: "wordSpacing", label: "Word spacing", min: 0, max: 40, step: 1, unit: "px" },
      { type: "range", key: "marginX", label: "Side margins", min: 0, max: 30, step: 1, unit: "%" },
      { type: "seg", key: "textAlign", label: "Alignment", options: [["left", "Left"], ["center", "Centre"], ["right", "Right"], ["justify", "Justify"]] },
      { type: "toggle", key: "uppercase", label: "All capitals" },
      { type: "toggle", key: "textOutline", label: "Dark outline around letters", hint: "Keeps text readable when the background is see-through." },
    ],
  },
  {
    id: "look", label: "Colours",
    fields: [
      { type: "seg", key: "prompterTheme", label: "Prompter theme", options: [["dark", "Dark"], ["light", "Light"]] },
      { type: "custom", render: renderPresets },
      { type: "color", key: "textColor", label: "Text" },
      { type: "color", key: "bgColor", label: "Background" },
      { type: "range", key: "bgOpacity", label: "Background opacity", min: 0, max: 100, step: 1, unit: "%", hint: "Lower it to see your slides or webcam through the prompter." },
      { type: "color", key: "cueColor", label: "Cues [notes]" },
      { type: "color", key: "highlightColor", label: "Highlight" },
      { type: "range", key: "readOpacity", label: "Text you've already read", min: 5, max: 100, step: 1, unit: "%", hint: "Dims lines above the reading guide so your eye finds its place." },
      { type: "heading", text: "Reading guide" },
      { type: "toggle", key: "guideEnabled", label: "Show reading guide" },
      { type: "seg", key: "guideStyle", label: "Style", options: [["arrows", "Arrows"], ["line", "Line"], ["band", "Band"]] },
      { type: "range", key: "guidePosition", label: "Height on screen", min: 5, max: 90, step: 1, unit: "% from top", hint: "Near the top keeps your eyes close to the webcam." },
      { type: "color", key: "guideColor", label: "Guide colour" },
      { type: "toggle", key: "fadeEdges", label: "Fade text at the top and bottom" },
    ],
  },
  {
    id: "voice", label: "Voice",
    fields: [
      { type: "custom", render: () => note("Speech recognition runs on this PC. Nothing you say leaves it.") },
      { type: "select", key: "micDevice", label: "Microphone", options: () => [["", "Windows default"], ...micDevices.map((d) => [d, d] as [string, string])] },
      { type: "custom", render: renderMicTools },
      { type: "range", key: "voiceSensitivity", label: "Sensitivity", min: 0, max: 100, step: 1, unit: "%", hint: "Raise it if quiet speech doesn't scroll. Lower it if background noise does. The gold mark on the level meter is the trigger point." },
      { type: "range", key: "silenceHold", label: "Keep scrolling after you stop", min: 100, max: 3000, step: 50, fmt: (v) => `${(v / 1000).toFixed(2)} s` },
      { type: "range", key: "followSmoothing", label: "Follow mode smoothness", min: 1, max: 10, step: 1, hint: "Higher glides more, lower reacts faster." },
      { type: "toggle", key: "restrictVocabulary", label: "Only listen for words in the script", hint: "Much more accurate. Turn it off if you ad-lib a lot." },
      { type: "text", key: "modelPath", label: "Speech model folder (optional)", placeholder: "Built-in English model", hint: "For another language or better accuracy, download a Vosk model from alphacephei.com/vosk/models, unzip it, and paste the folder path here." },
    ],
  },
  {
    id: "window", label: "Window",
    fields: [
      { type: "toggle", key: "hidePrompterFromCapture", label: "Hide the prompter from recordings", hint: "Panopto, OBS, Teams, Zoom, Snipping Tool and screen sharing see through it." },
      { type: "toggle", key: "hideControlsFromCapture", label: "Hide this window from recordings" },
      { type: "toggle", key: "allowScreenshots", label: "Allow screenshots", hint: () => {
        const k = keysFor("screenshot");
        return `Shows the prompter and this window to Print Screen and Snipping Tool. Windows can't allow screenshots without also allowing recordings, so turn it off before you record.${k ? ` ${k} flips it from any app.` : ""}`;
      } },
      { type: "toggle", key: "alwaysOnTop", label: "Keep the prompter on top" },
      { type: "toggle", key: "clickThrough", label: "Clicks pass through the prompter", hint: () => {
        const k = keysFor("toggle-click-through");
        return `Lets you click the app underneath. Turn it off with this switch${k ? `, ${k}` : ""} or the tray menu.`;
      } },
      { type: "toggle", key: "hideFromTaskbar", label: "Hide from the taskbar", hint: () => {
        const k = keysFor("toggle-controls");
        return `Your recording won't show a ghost button in the taskbar. Open the app from the ghost in the tray, near the clock${k ? `, or with ${k}` : ""}. Minimising sends this window to the tray.`;
      } },
      { type: "toggle", key: "mirrorH", label: "Mirror left to right", hint: "For teleprompter glass." },
      { type: "toggle", key: "mirrorV", label: "Flip upside down" },
      { type: "custom", render: () => button("Move the prompter under the webcam", centerPrompter) },
      { type: "heading", text: "While prompting" },
      { type: "range", key: "countdown", label: "Countdown before scrolling", min: 0, max: 10, step: 1, fmt: (v) => (v ? `${v} s` : "Off") },
      { type: "toggle", key: "showProgress", label: "Progress line on the prompter" },
      { type: "toggle", key: "showTimer", label: "Time elapsed and left on the prompter" },
    ],
  },
  { id: "hotkeys", label: "Hotkeys", fields: [{ type: "custom", render: renderHotkeys }] },
];

function renderPresets(): HTMLElement {
  const presets: { name: string; text: string; bg: string; opacity?: number }[] = [
    { name: "Night sky", text: "#f4f5ff", bg: "#050d2e" },
    { name: "Gold on black", text: "#ffd27a", bg: "#000000" },
    { name: "Ink on paper", text: "#111a3a", bg: "#f4f1ea", opacity: 92 },
    { name: "White on black", text: "#ffffff", bg: "#000000" },
  ];
  const wrap = el("div", "field");
  wrap.appendChild(Object.assign(el("div", "lbl"), { innerHTML: "<span>Quick colour sets</span>" }));
  const grid = el("div", "presets");
  for (const p of presets) {
    const b = el("button", "preset", "Aa");
    b.style.background = p.bg;
    b.style.color = p.text;
    b.title = p.name;
    b.setAttribute("aria-label", `Colour set: ${p.name}`);
    b.onclick = () => {
      data.settings = { ...S(), textColor: p.text, bgColor: p.bg, ...(p.opacity ? { bgOpacity: p.opacity } : {}) };
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
  lbl.append(el("span", undefined, "Input level"));
  const state = el("span", "val");
  lbl.append(state);
  const meter = el("div", "meter");
  drawerMeter = el("div", "fill");
  drawerMark = el("div", "mark");
  meter.append(drawerMeter, drawerMark);
  wrap.append(lbl, meter, button("Refresh microphone list", () => loadDevices(true)));
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

function renderHotkeys(): HTMLElement {
  const wrap = el("div", "field");
  wrap.appendChild(note("These work from <b>any app</b>, even while Panopto is recording. Select a box, then press the new keys. Backspace removes a hotkey. Escape cancels."));
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
  wrap.append(grid, problems, button("Restore default hotkeys", () => {
    data.settings = { ...S(), hotkeys: { ...DEFAULT_HOTKEYS } };
    save();
    applyHotkeys();
    toast("Default hotkeys restored");
  }));
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

function selectTab(id: string) {
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
  drawerReturnFocus = document.activeElement as HTMLElement;
  $("drawer-backdrop").hidden = false;
  refreshFields();
  $("btn-close-settings").focus();
}
function closeSettings() {
  $("drawer-backdrop").hidden = true;
  drawerReturnFocus?.focus();
}
$("btn-settings").onclick = () => openSettings();
$("btn-close-settings").onclick = closeSettings;
$("drawer-backdrop").addEventListener("mousedown", (e) => {
  if (e.target === e.currentTarget) closeSettings();
});
$("btn-reset").onclick = async () => {
  const ok = await confirmDialog("Reset all settings?", "Text, colours, voice, window and hotkey settings go back to their defaults. Your scripts are kept.", "Reset settings");
  if (!ok) return;
  data.settings = { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } };
  save();
  pushSettings();
  applyCapture();
  applyTaskbar();
  applyHotkeys();
  toast("Settings reset");
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
    if (e.key === "Escape") closeDialog(false);
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
  /** What the cross does besides hiding the message for now (e.g. remember it was read). */
  onClose?: () => void;
}
let splashDone = false;
const dismissedNotices = new Set<string>();
let noticeSig = "";

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
      action: { label: "Turn off", run: () => set("clickThrough", false) },
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
  if (splashDone && status && !status.visible) {
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
        ? "Follow my voice starts when you press Start prompting. Then read aloud."
        : "Voice scrolling starts when you press Start prompting. Then start talking.",
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

function renderNotices() {
  const all = currentNotices();
  // A message that goes away and comes back later should show again.
  for (const id of [...dismissedNotices]) if (!all.some((n) => n.id === id)) dismissedNotices.delete(id);
  const list = all.filter((n) => !dismissedNotices.has(n.id));
  const sig = list.map((n) => n.id + n.text).join("|");
  if (sig === noticeSig) return;
  noticeSig = sig;
  const host = $("notices");
  host.textContent = "";
  for (const n of list) {
    const row = el("div", `notice ${n.kind}`);
    const close = el("button", "notice-close");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss this message");
    close.title = "Dismiss";
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close.onclick = () => {
      dismissedNotices.add(n.id);
      n.onClose?.();
      renderNotices();
    };
    row.append(close, el("span", "text", n.text));
    if (n.action) {
      const b = el("button", "btn small", n.action.label);
      b.onclick = n.action.run;
      row.appendChild(b);
    }
    host.appendChild(row);
  }
}

// ---------- Present panel ----------
function buildPresent() {
  $("quick").append(renderField(speedField), renderField(fontSizeField));
  document.querySelectorAll<HTMLInputElement>('#modes input[name="mode"]').forEach((r) => {
    r.onchange = () => r.checked && set("mode", r.value as ScrollMode);
  });
  refreshers.push(() => {
    const s = S();
    document.querySelectorAll<HTMLInputElement>('#modes input[name="mode"]').forEach((r) => (r.checked = r.value === s.mode));
    $("voice-box").hidden = s.mode === "manual";
    $<HTMLInputElement>("rec-switch").checked = s.hidePrompterFromCapture && s.hideControlsFromCapture && !s.allowScreenshots;
    $("p-mark").style.left = `${threshold() * 100}%`;
    renderStatus();
  });
}

$("start").onclick = () => {
  if (!active()?.body.trim()) return;
  cmd({ type: status?.playing || status?.counting ? "pause" : "play" });
  showPrompter();
};
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
$("btn-recording").onclick = () => openSettings("window");
$("nav-hotkeys").onclick = () => openSettings("hotkeys");
$("nav-appearance").onclick = () => openSettings("look");
$("nav-scripts").onclick = () => $("search").focus();
$("nav-about").onclick = () => {
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
$("rec-switch").onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  // Turning protection on also ends "Allow screenshots", otherwise the switch would stay off and look broken.
  data.settings = { ...S(), hidePrompterFromCapture: on, hideControlsFromCapture: on, ...(on ? { allowScreenshots: false } : {}) };
  save();
  pushSettings();
  applyCapture();
  refreshFields();
};

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
  const keys = $("start-keys");
  keys.hidden = !hasText || !hk || hkBroken;
  keys.textContent = hk ? hk.replace(/\+/g, " + ") : "";
  $("start-hint").textContent = !hasText
    ? "Write or import a script first."
    : !hk ? "No play/pause hotkey set."
    : hkBroken ? `${hk.replace(/\+/g, " + ")} isn't available right now.`
    : "";
  renderNotices();
  const startMain = $("start-main");
  if (!hasText) startMain.innerHTML = `${PLAY}<span>Start prompting</span>`;
  if (!st) return;
  if (hasText) {
    const running = st.playing || st.counting > 0;
    const label = st.counting ? `Starting in ${st.counting}…` : st.playing ? "Pause" : st.progress > 0.001 ? "Resume" : "Start prompting";
    startMain.innerHTML = `${running ? PAUSE : PLAY}<span>${label}</span>`;
  }
  $("fill").style.width = `${st.progress * 100}%`;
  $("bar").setAttribute("aria-valuetext", `${Math.round(st.progress * 100)}% through`);
  $("elapsed").textContent = fmt(st.elapsed);
  $("remaining").textContent = `-${fmt(st.remaining)}`;
  $("wpm").textContent = st.wpm > 0 ? `about ${st.wpm} words/min` : "";
  $("btn-prompter-label").textContent = st.visible ? "Hide prompter" : "Show prompter";

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
  save();
  refreshFields();
});

listen("gp:prompter-hidden", () => {
  const k = keysFor("toggle-prompter");
  toast(`Prompter hidden. Use Show prompter${k ? ` or ${k}` : ""} to bring it back.`);
});

// The screenshot hotkey flips the setting, so the switch in All settings always shows the real state.
listen("gp:toggle-screenshots", () => {
  const on = !S().allowScreenshots;
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
}

function updateStats() {
  const wc = countWords(bodyEl.value);
  const secs = Math.round((wc / 150) * 60);
  const dur = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  for (const id of ["wc", "wc2"]) $(id).textContent = String(wc);
  for (const id of ["dur", "dur2"]) $(id).textContent = dur;
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
  $("saved").textContent = "Saving…";
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
  const ok = await confirmDialog(`Delete "${name}"?`, "The script is removed from this PC. This can't be undone.", "Delete script");
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
async function applyCapture() {
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
  if (await w.isVisible()) await w.hide();
  else {
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
  // The prompter stays hidden until the person is through the start screen.
  onContinue: () => {
    splashDone = true;
    showPrompter();
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
    $("btn-retry-save").textContent = "Save anyway";
    $("btn-retry-save").onclick = () => {
      ready = true;
      $("btn-retry-save").textContent = "Try again";
      $("btn-retry-save").onclick = () => saveNow();
      saveNow();
    };
  } else {
    save();
  }
}

init().catch((e) => splash.failed(`Something went wrong while opening: ${e}`));
