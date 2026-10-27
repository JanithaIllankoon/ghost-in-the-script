// One list of every shortcut and gesture, shown by both windows, so nothing is only in the README.

import { ACTION_LABELS, type Action, type HotkeyProblem, type Settings } from "./types";

export interface ShortcutRow {
  /** Keys separated by "+", or a plain description of a mouse action. */
  keys: string;
  label: string;
  isMouse?: boolean;
  problem?: string;
}

export interface ShortcutSection {
  title: string;
  note?: string;
  rows: ShortcutRow[];
}

export function shortcutSections(s: Settings, problems: HotkeyProblem[], include: { editor: boolean }): ShortcutSection[] {
  const global: ShortcutRow[] = (Object.keys(ACTION_LABELS) as Action[]).map((a) => {
    const p = problems.find((x) => x.action === a);
    return {
      keys: s.hotkeys[a] || "",
      label: ACTION_LABELS[a],
      problem: p ? "Another app is using these keys" : undefined,
    };
  });

  const sections: ShortcutSection[] = [
    { title: "From any app", note: "These work even while Panopto or another app is in front.", rows: global },
    {
      title: "On the prompter",
      note: "Click the prompter first, so it's listening for keys.",
      rows: [
        { keys: "Space", label: "Play / pause" },
        { keys: "Up / Down", label: "Faster / slower" },
        { keys: "PageUp / PageDown", label: "Back / forward one line" },
        { keys: "Home", label: "Back to the start" },
        { keys: "End", label: "Jump to the end" },
        { keys: "Esc", label: "Stop" },
        { keys: "M", label: "Switch scroll mode" },
        { keys: "Ctrl+/", label: "Show this list" },
      ],
    },
    {
      title: "Mouse on the prompter",
      rows: [
        { keys: "Hover", label: "Shows the toolbar", isMouse: true },
        { keys: "Drag the toolbar", label: "Moves the prompter (or hold Alt and drag anywhere)", isMouse: true },
        { keys: "Drag an edge", label: "Resizes it", isMouse: true },
        { keys: "Mouse wheel", label: "Scrolls the script by hand", isMouse: true },
        { keys: "Double-click a word", label: "Jumps there", isMouse: true },
      ],
    },
  ];

  if (include.editor) {
    sections.push({
      title: "In the script editor",
      rows: [
        { keys: "Ctrl+B", label: "Bold" },
        { keys: "Ctrl+I", label: "Italic" },
        { keys: "Ctrl+U", label: "Underline" },
        { keys: "Ctrl+H", label: "Highlight" },
        { keys: "Drop a file", label: "Imports a .txt, .md, .docx or .rtf script", isMouse: true },
        { keys: "Ctrl+/", label: "Show this list" },
      ],
    });
  }

  sections.push({
    title: "Tray icon (the ghost near the clock)",
    rows: [
      { keys: "Click", label: "Opens the main window", isMouse: true },
      { keys: "Right-click", label: "Play or pause, show or hide the prompter, turn off click-through, move the prompter to the top centre, quit", isMouse: true },
    ],
  });
  return sections;
}

/** Renders keys like "Ctrl+Alt+Space" as <kbd> chips; mouse actions as plain text. */
export function renderKeys(row: ShortcutRow): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "keys";
  if (!row.keys) {
    wrap.textContent = "Not set";
    wrap.classList.add("unset");
    return wrap;
  }
  if (row.isMouse) {
    wrap.textContent = row.keys;
    wrap.classList.add("mouse");
    return wrap;
  }
  row.keys.split(" / ").forEach((combo, i) => {
    if (i) wrap.append(" / ");
    combo.split("+").forEach((k, j) => {
      if (j) wrap.append("+");
      const kbd = document.createElement("kbd");
      kbd.textContent = k;
      wrap.appendChild(kbd);
    });
  });
  return wrap;
}

export function renderSections(sections: ShortcutSection[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const sec of sections) {
    const box = document.createElement("section");
    box.className = "sc-section";
    const h = document.createElement("h3");
    h.textContent = sec.title;
    box.appendChild(h);
    if (sec.note) {
      const n = document.createElement("p");
      n.className = "sc-note";
      n.textContent = sec.note;
      box.appendChild(n);
    }
    const dl = document.createElement("dl");
    for (const row of sec.rows) {
      const dt = document.createElement("dt");
      dt.appendChild(renderKeys(row));
      const dd = document.createElement("dd");
      dd.textContent = row.label;
      if (row.problem) {
        const warn = document.createElement("span");
        warn.className = "sc-problem";
        warn.textContent = row.problem;
        dd.appendChild(warn);
      }
      dl.append(dt, dd);
    }
    box.appendChild(dl);
    frag.appendChild(box);
  }
  return frag;
}
