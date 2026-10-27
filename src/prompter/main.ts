import "@fontsource/fredoka/latin-600.css";

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];

import { VoiceTracker } from "../shared/align";
import { renderScript, type RenderedScript } from "../shared/markup";
import {
  DEFAULT_SETTINGS,
  MODE_LABELS,
  linesPerSecond,
  normalizeData,
  type Action,
  type PrompterCommand,
  type PrompterStatus,
  type ScrollMode,
  type Settings,
} from "../shared/types";

const win = getCurrentWindow();

// ---------- DOM ----------
// Filled glyphs: they read at a glance on top of slides, where thin strokes get lost.
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4.5" height="15" rx="1.2"/><rect x="13.5" y="4.5" width="4.5" height="15" rx="1.2"/></svg>',
  rewind: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="3" height="14" rx="1"/><path d="M20 5v14L8.5 12z"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="3" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="3" rx="1.5"/><rect x="10.5" y="5" width="3" height="14" rx="1.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.3 4.2 12 9.9l5.7-5.7 2.1 2.1-5.7 5.7 5.7 5.7-2.1 2.1-5.7-5.7-5.7 5.7-2.1-2.1 5.7-5.7-5.7-5.7z"/></svg>',
};

document.getElementById("app")!.innerHTML = `
  <div id="root">
    <div id="stage">
      <div id="content"></div>
      <div id="guide"><div class="line"></div><div class="band"></div><div class="arrow left"></div><div class="arrow right"></div></div>
    </div>
    <div id="empty">No script yet.<br/>Write or import one in the Ghost In The Script window.</div>
    <div id="countdown"></div>
    <div id="progress"><div id="progress-bar"></div></div>
    <div id="timer"></div>
    <div id="toast"></div>
    <div id="toolbar" data-tauri-drag-region>
      <span class="grip" data-tauri-drag-region>⋮⋮</span>
      <button id="tb-play" title="Play or pause (Space)" aria-label="Play or pause">${ICON.play}</button>
      <button id="tb-rewind" title="Back to the start (Home)" aria-label="Back to the start">${ICON.rewind}</button>
      <span class="sep"></span>
      <button id="tb-slower" title="Slower (Down arrow)" aria-label="Slower">${ICON.minus}</button>
      <span class="speed" id="tb-speed" title="Speed">22</span>
      <button id="tb-faster" title="Faster (Up arrow)" aria-label="Faster">${ICON.plus}</button>
      <span class="sep"></span>
      <button id="tb-mode" class="mode text" title="Scroll mode (M)">Fixed</button>
      <span class="mic" id="tb-mic" title="Microphone"></span>
      <span class="sep"></span>
      <button id="tb-through" class="text" title="Clicks pass through to the app underneath (Ctrl+Alt+K)">Click-through</button>
      <button id="tb-controls" class="text" title="Open the main window">Controls</button>
      <button id="tb-hide" title="Hide the prompter (Ctrl+Alt+P brings it back)" aria-label="Hide the prompter">${ICON.close}</button>
    </div>
    ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="grip-r ${d}" data-dir="${d}"></div>`).join("")}
  </div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $("root");
const stage = $("stage");
const content = $("content");
const guide = $("guide");
const countdownEl = $("countdown");
const emptyEl = $("empty");
const toastEl = $("toast");
const progressEl = $("progress");
const progressBar = $("progress-bar");
const timerEl = $("timer");
const toolbar = $("toolbar");

// ---------- State ----------
let settings: Settings = { ...DEFAULT_SETTINGS };
let scriptId: string | null = null;
let scriptBody = "";
let rendered: RenderedScript = { words: [], tokens: [], vocabulary: [], wordCount: 0 };
const tracker = new VoiceTracker();

let y = 0; // scroll offset in px
let velocity = 0; // px/s (voice-activated mode)
let maxY = 0;
let lineH = 64;
let guideY = 100;
let viewH = 300;
let wordCenters: number[] = [];
let readUpTo = -1; // words < readUpTo have the .read class

let playing = false;
let counting = 0;
let countdownTimer: number | undefined;
let elapsed = 0;
let tween: { from: number; to: number; start: number; dur: number } | null = null;
let followTarget: number | null = null;

let voiceLevel = 0;
let lastSpeechAt = 0;
let heard = "";
const voice = {
  running: false,
  recognizing: false,
  loading: false,
  device: "",
  error: "",
  key: "",
};
const spokenLog: { t: number; word: number }[] = [];

// ---------- Helpers ----------
let toastTimer: number | undefined;
function toast(msg: string, error = false, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", error);
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("on"), ms);
}

function hexToRgba(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function patchSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  applySettings();
  emitTo("main", "gp:patch", patch).catch(() => {});
}

function pxPerSecond() {
  return linesPerSecond(settings.speed) * lineH;
}

// ---------- Layout ----------
function applySettings() {
  const s = settings;
  const r = document.documentElement.style;
  r.setProperty("--font", JSON.stringify(s.fontFamily));
  r.setProperty("--size", `${s.fontSize}px`);
  r.setProperty("--weight", String(s.fontWeight));
  r.setProperty("--lh", String(s.lineHeight));
  r.setProperty("--ls", `${s.letterSpacing}px`);
  r.setProperty("--ws", `${s.wordSpacing}px`);
  r.setProperty("--ps", `${s.paragraphSpacing}em`);
  r.setProperty("--align", s.textAlign);
  r.setProperty("--text", s.textColor);
  r.setProperty("--cue", s.cueColor);
  r.setProperty("--hl", s.highlightColor);
  r.setProperty("--guide", s.guideColor);
  r.setProperty("--read", String(s.readOpacity / 100));
  r.setProperty("--margin", `${s.marginX}%`);
  r.setProperty("--bg", hexToRgba(s.bgColor, s.bgOpacity / 100));

  content.classList.toggle("upper", s.uppercase);
  content.classList.toggle("outline", s.textOutline);
  stage.classList.toggle("fade", s.fadeEdges);
  stage.style.transform = `scale(${s.mirrorH ? -1 : 1}, ${s.mirrorV ? -1 : 1})`;
  guide.className = s.guideEnabled ? `style-${s.guideStyle}` : "hidden";
  progressEl.classList.toggle("hidden", !s.showProgress);
  timerEl.classList.toggle("hidden", !s.showTimer);

  $("tb-speed").textContent = String(s.speed);
  $("tb-mode").textContent = { manual: "Fixed", voice: "Voice", follow: "Follow" }[s.mode];
  $("tb-mode").title = `Scroll mode: ${MODE_LABELS[s.mode]} (M)`;
  $("tb-through").classList.toggle("active", s.clickThrough);
  root.classList.toggle("click-through", s.clickThrough);

  win.setAlwaysOnTop(s.alwaysOnTop).catch(() => {});
  win.setSkipTaskbar(!s.showInTaskbar).catch(() => {});
  win.setIgnoreCursorEvents(s.clickThrough).catch(() => {});

  relayout();
  syncVoice();
}

function relayout() {
  viewH = stage.clientHeight || window.innerHeight;
  // Measure the real line height in px for the current font settings.
  lineH = settings.fontSize * settings.lineHeight;
  guideY = Math.round((viewH * settings.guidePosition) / 100);
  const r = document.documentElement.style;
  r.setProperty("--guide-y", `${guideY}px`);
  r.setProperty("--line-px", `${lineH}px`);
  r.setProperty("--pad-top", `${Math.max(0, guideY - lineH / 2)}px`);
  r.setProperty("--pad-bottom", `${Math.max(0, viewH - guideY - lineH / 2)}px`);

  const oldMax = maxY;
  const frac = oldMax > 0 ? y / oldMax : 0;
  maxY = Math.max(0, content.scrollHeight - viewH);
  wordCenters = rendered.words.map((w) => w.offsetTop + w.offsetHeight / 2);
  if (oldMax > 0 && settings.mode !== "follow") y = frac * maxY;
  if (settings.mode === "follow") followTarget = targetForWord(tracker.currentWord());
  y = clamp(y);
  draw();
}

function clamp(v: number) {
  return Math.min(maxY, Math.max(0, v));
}

/** Index of the word whose line is at the reading guide. */
function wordAtGuide(): number {
  const at = y + guideY;
  let lo = 0;
  let hi = wordCenters.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wordCenters[mid] < at - lineH / 2) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function targetForWord(word: number): number | null {
  if (word < 0) return 0;
  const el = rendered.words[word];
  if (!el) return null;
  // Ease towards the next line as you get through the current one.
  const width = content.clientWidth || 1;
  const across = Math.min(1, Math.max(0, (el.offsetLeft + el.offsetWidth) / width));
  return clamp(el.offsetTop + el.offsetHeight / 2 - guideY + across * lineH * 0.45);
}

function markRead(upTo: number) {
  if (upTo === readUpTo) return;
  const words = rendered.words;
  if (upTo > readUpTo) for (let i = Math.max(0, readUpTo); i < upTo && i < words.length; i++) words[i].classList.add("read");
  else for (let i = Math.max(0, upTo); i < readUpTo && i < words.length; i++) words[i].classList.remove("read");
  readUpTo = upTo;
}

function draw() {
  content.style.transform = `translate3d(0, ${-y}px, 0)`;
  progressBar.style.width = `${maxY > 0 ? (y / maxY) * 100 : 0}%`;
  if (settings.mode === "follow") markRead(tracker.currentWord() + 1);
  else markRead(wordAtGuide());
}

// ---------- Script ----------
function setScript(id: string | null, body: string) {
  const sameScript = id === scriptId;
  const keepWord = sameScript ? Math.max(0, wordAtGuide()) : 0;
  scriptId = id;
  scriptBody = body;
  readUpTo = -1;
  rendered = renderScript(body, content);
  emptyEl.classList.toggle("on", rendered.wordCount === 0);
  tracker.setTokens(rendered.tokens, sameScript ? keepWord : undefined);
  if (!sameScript) {
    y = 0;
    elapsed = 0;
    stop();
  }
  relayout();
  if (sameScript && settings.mode !== "follow") {
    const c = wordCenters[keepWord];
    if (c !== undefined) y = clamp(c - guideY);
  }
  syncVoice();
  draw();
}

// ---------- Playback ----------
function play() {
  if (playing || counting) return;
  if (rendered.wordCount === 0) {
    toast("Add a script in the controls window first.");
    return;
  }
  if (y >= maxY - 1 && settings.mode !== "follow") {
    y = 0;
    tracker.setCursorToWord(0);
  }
  if (settings.mode === "follow") tracker.setCursorToWord(Math.max(0, wordAtGuide()));
  const secs = Math.round(settings.countdown);
  if (secs > 0) {
    counting = secs;
    countdownEl.textContent = String(counting);
    countdownEl.classList.add("on");
    clearInterval(countdownTimer);
    countdownTimer = window.setInterval(() => {
      counting--;
      if (counting <= 0) {
        clearInterval(countdownTimer);
        countdownEl.classList.remove("on");
        startPlaying();
      } else {
        countdownEl.textContent = String(counting);
      }
      sendStatus();
    }, 1000);
  } else {
    startPlaying();
  }
  syncVoice();
  sendStatus();
}

function startPlaying() {
  counting = 0;
  playing = true;
  velocity = 0;
  if (settings.mode === "follow") followTarget = y;
  $("tb-play").innerHTML = ICON.pause;
  sendStatus();
}

function stop() {
  playing = false;
  counting = 0;
  clearInterval(countdownTimer);
  countdownEl.classList.remove("on");
  $("tb-play").innerHTML = ICON.play;
  syncVoice();
  sendStatus();
}

function togglePlay() {
  if (playing || counting) stop();
  else play();
}

function nudge(lines: number) {
  const from = y;
  const to = clamp(y + lines * lineH);
  if (settings.mode === "follow") {
    // Move the voice position to whatever word lands on the guide.
    y = to;
    tracker.setCursorToWord(Math.max(0, wordAtGuide()));
    followTarget = to;
    y = from;
  }
  tween = { from, to, start: performance.now(), dur: 220 };
}

function rewind() {
  stop();
  tween = { from: y, to: 0, start: performance.now(), dur: 350 };
  tracker.setCursorToWord(0);
  tracker.cursor = -1;
  followTarget = 0;
  elapsed = 0;
  spokenLog.length = 0;
}

function seek(fraction: number) {
  y = clamp(fraction * maxY);
  tween = null;
  tracker.setCursorToWord(Math.max(0, wordAtGuide()));
  if (fraction <= 0) tracker.cursor = -1;
  followTarget = settings.mode === "follow" ? targetForWord(tracker.currentWord()) : null;
  draw();
  sendStatus();
}

function setMode(mode: ScrollMode) {
  if (mode === settings.mode) return;
  if (mode === "follow") {
    tracker.setCursorToWord(Math.max(0, wordAtGuide()));
    followTarget = y;
  }
  velocity = 0;
  patchSettings({ mode });
  toast(MODE_LABELS[mode]);
}

function changeSpeed(delta: number) {
  const speed = Math.min(100, Math.max(1, settings.speed + delta));
  patchSettings({ speed });
}

function runAction(a: Action | string) {
  switch (a) {
    case "play-pause": togglePlay(); break;
    case "speed-up": changeSpeed(+1); break;
    case "speed-down": changeSpeed(-1); break;
    case "back": nudge(-1); break;
    case "forward": nudge(+1); break;
    case "rewind": rewind(); break;
    case "cycle-mode": {
      const order: ScrollMode[] = ["manual", "voice", "follow"];
      setMode(order[(order.indexOf(settings.mode) + 1) % order.length]);
      break;
    }
    case "toggle-click-through": {
      const on = !settings.clickThrough;
      patchSettings({ clickThrough: on });
      toast(on ? "Click-through on: clicks pass through the prompter" : "Click-through off");
      break;
    }
  }
  sendStatus();
}

// ---------- Animation loop ----------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speaking = now - lastSpeechAt < settings.silenceHold;

  if (tween) {
    const t = Math.min(1, (now - tween.start) / tween.dur);
    const e = 1 - Math.pow(1 - t, 3);
    y = tween.from + (tween.to - tween.from) * e;
    if (t >= 1) tween = null;
  } else if (playing) {
    if (settings.mode === "manual") {
      y += pxPerSecond() * dt;
    } else if (settings.mode === "voice") {
      const target = speaking ? pxPerSecond() : 0;
      // Speed up quickly when you start talking, slow down gently when you stop.
      const tau = target > velocity ? 0.18 : 0.35;
      velocity += (target - velocity) * (1 - Math.exp(-dt / tau));
      y += velocity * dt;
    } else if (settings.mode === "follow" && followTarget !== null) {
      const tau = 0.15 + settings.followSmoothing * 0.07;
      y += (followTarget - y) * (1 - Math.exp(-dt / tau));
    }
    elapsed += dt;
  }

  const clamped = clamp(y);
  if (playing && settings.mode !== "follow" && y >= maxY && maxY > 0) {
    y = maxY;
    stop();
    toast("End of script");
  }
  y = clamped;
  draw();

  const mic = $("tb-mic");
  mic.className = `mic ${voice.running ? (speaking && voiceLevel > 0 ? "live" : "idle") : ""}`;

  if (now - lastTimerDraw > 250) drawTimer(now);
  requestAnimationFrame(frame);
}
let lastTimerDraw = 0;

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "--:--";
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function measuredWpm(now: number): number {
  while (spokenLog.length && now - spokenLog[0].t > 20000) spokenLog.shift();
  if (spokenLog.length < 2) return 0;
  const a = spokenLog[0];
  const b = spokenLog[spokenLog.length - 1];
  const mins = (b.t - a.t) / 60000;
  return mins > 0.05 ? Math.max(0, (b.word - a.word) / mins) : 0;
}

function estimate(now: number) {
  const totalLines = maxY > 0 ? (maxY + lineH) / lineH : 1;
  const wordsPerLine = rendered.wordCount / Math.max(1, totalLines);
  let wpm = linesPerSecond(settings.speed) * wordsPerLine * 60;
  if (settings.mode === "follow") wpm = measuredWpm(now) || wpm;
  const wordsLeft = Math.max(0, rendered.wordCount - Math.max(0, settings.mode === "follow" ? tracker.currentWord() : wordAtGuide()));
  const remaining = settings.mode === "follow" ? (wpm > 0 ? (wordsLeft / wpm) * 60 : NaN) : (maxY - y) / pxPerSecond();
  return { wpm, remaining };
}

function drawTimer(now: number) {
  lastTimerDraw = now;
  const { remaining } = estimate(now);
  timerEl.textContent = `${fmt(elapsed)}  ·  -${fmt(remaining)}`;
}

// ---------- Status for the controls window ----------
let visible = true;
function sendStatus() {
  const now = performance.now();
  const { wpm, remaining } = estimate(now);
  const status: PrompterStatus = {
    playing,
    counting,
    mode: settings.mode,
    speed: settings.speed,
    progress: maxY > 0 ? y / maxY : 0,
    elapsed,
    remaining: Number.isFinite(remaining) ? remaining : -1,
    wpm: Math.round(wpm),
    voice: {
      running: voice.running,
      recognizing: voice.recognizing,
      speaking: now - lastSpeechAt < settings.silenceHold,
      heard,
      device: voice.device,
      error: voice.error,
      loading: voice.loading,
    },
    clickThrough: settings.clickThrough,
    visible,
  };
  emitTo("main", "gp:status", status).catch(() => {});
}
setInterval(async () => {
  const nowVisible = await win.isVisible().catch(() => true);
  if (nowVisible !== visible) {
    visible = nowVisible;
    if (!visible) stop();
    syncVoice(); // release the microphone while hidden
  }
  sendStatus();
}, 400);

// ---------- Voice ----------
let voiceTimer: number | undefined;
function syncVoice() {
  clearTimeout(voiceTimer);
  voiceTimer = window.setTimeout(applyVoice, 350);
}

async function applyVoice() {
  const wanted = settings.mode !== "manual" && visible && rendered.wordCount > 0;
  if (!wanted) {
    if (voice.running) {
      voice.running = false;
      voice.key = "";
      await invoke("voice_stop").catch(() => {});
    }
    return;
  }
  const recognize = settings.mode === "follow";
  const vocabulary = recognize && settings.restrictVocabulary ? rendered.vocabulary : null;
  const key = JSON.stringify([settings.micDevice, recognize, settings.modelPath, recognize ? scriptBody.length + ":" + rendered.vocabulary.join(" ").length : 0, settings.restrictVocabulary]);
  if (voice.running && voice.key === key) return;
  if (voice.loading) {
    syncVoice();
    return;
  }

  voice.loading = true;
  voice.error = "";
  if (recognize) toast("Starting voice tracking…", false, 1800);
  sendStatus();
  try {
    const info = await invoke<{ device: string; sampleRate: number; recognizing: boolean; vocabularySize: number; unknownWords: string[] }>(
      "voice_start",
      {
        config: {
          device: settings.micDevice || null,
          recognize,
          vocabulary,
          modelPath: settings.modelPath || null,
        },
      },
    );
    voice.running = true;
    voice.recognizing = info.recognizing;
    voice.device = info.device;
    voice.key = key;
    if (recognize) toast(`Listening on ${info.device}`, false, 2000);
  } catch (e) {
    voice.running = false;
    voice.key = "";
    voice.error = String(e);
    toast(String(e), true, 6000);
  } finally {
    voice.loading = false;
    sendStatus();
  }
}

function sensitivityThreshold() {
  // Sensitivity 0 -> needs a loud voice (level 0.75), 100 -> picks up a whisper (0.2).
  return 0.75 - (settings.voiceSensitivity / 100) * 0.55;
}

function onHeard(text: string, isFinal: boolean) {
  heard = text || heard;
  if (settings.mode !== "follow" || !playing) return;
  if (tracker.hear(text, isFinal)) {
    followTarget = targetForWord(tracker.currentWord());
    spokenLog.push({ t: performance.now(), word: tracker.currentWord() });
  }
  if (text) lastSpeechAt = performance.now();
}

// ---------- Events ----------
listen<{ level: number }>("gp:voice-level", (e) => {
  voiceLevel = e.payload.level;
  if (voiceLevel >= sensitivityThreshold()) lastSpeechAt = performance.now();
});
listen<{ text: string }>("gp:voice-partial", (e) => onHeard(e.payload.text, false));
listen<{ text: string }>("gp:voice-final", (e) => onHeard(e.payload.text, true));
listen<{ message: string }>("gp:voice-error", (e) => {
  voice.error = e.payload.message;
  toast(e.payload.message, true, 6000);
  sendStatus();
});

listen<Settings>("gp:settings", (e) => {
  const prevMode = settings.mode;
  settings = { ...DEFAULT_SETTINGS, ...e.payload };
  if (settings.mode !== prevMode) {
    velocity = 0;
    if (settings.mode === "follow") {
      tracker.setCursorToWord(Math.max(0, wordAtGuide()));
      followTarget = y;
    }
  }
  applySettings();
});
listen<{ id: string | null; body: string }>("gp:script", (e) => {
  if (e.payload.id !== scriptId || e.payload.body !== scriptBody) setScript(e.payload.id, e.payload.body);
});
listen<PrompterCommand>("gp:cmd", (e) => {
  const c = e.payload;
  if (c.type === "play") play();
  else if (c.type === "pause") stop();
  else if (c.type === "seek") seek(c.fraction);
  else if (c.type === "set-mode") setMode(c.mode);
  else runAction(c.type);
  sendStatus();
});
listen<string>("gp:hotkey", (e) => runAction(e.payload));

// Toolbar
$("tb-play").onclick = () => togglePlay();
$("tb-rewind").onclick = () => rewind();
$("tb-slower").onclick = () => changeSpeed(-1);
$("tb-faster").onclick = () => changeSpeed(+1);
$("tb-mode").onclick = () => runAction("cycle-mode");
$("tb-through").onclick = () => runAction("toggle-click-through");
$("tb-controls").onclick = () => invoke("run_action", { action: "toggle-controls" });
$("tb-hide").onclick = () => win.hide();

// Toolbar shows while the mouse is over the window
let hideToolbarTimer: number | undefined;
function showToolbar() {
  if (settings.clickThrough) return;
  toolbar.classList.add("on");
  root.classList.add("hovered");
  clearTimeout(hideToolbarTimer);
  hideToolbarTimer = window.setTimeout(() => {
    if (!toolbar.matches(":hover")) {
      toolbar.classList.remove("on");
      root.classList.remove("hovered");
    }
  }, 2200);
}
document.addEventListener("mousemove", showToolbar);
document.addEventListener("mouseleave", () => {
  toolbar.classList.remove("on");
  root.classList.remove("hovered");
});

// Resize from the edges (the window has no frame)
const DIRS: Record<string, ResizeDirection> = {
  n: "North", s: "South", e: "East", w: "West",
  ne: "NorthEast", nw: "NorthWest", se: "SouthEast", sw: "SouthWest",
};
document.querySelectorAll<HTMLElement>(".grip-r").forEach((g) => {
  g.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    win.startResizeDragging(DIRS[g.dataset.dir!]).catch(() => {});
  });
});

// Drag the window by holding Alt anywhere, or by the toolbar
stage.addEventListener("mousedown", (ev) => {
  if (ev.button === 0 && ev.altKey) {
    ev.preventDefault();
    win.startDragging().catch(() => {});
  }
});

// Mouse wheel scrolls the script by hand
let wheelTimer: number | undefined;
stage.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    tween = null;
    const dir = settings.mirrorV ? -1 : 1;
    y = clamp(y + ev.deltaY * 0.6 * dir);
    if (settings.mode === "follow") followTarget = y;
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => {
      if (settings.mode === "follow") {
        tracker.setCursorToWord(Math.max(0, wordAtGuide()));
        followTarget = y;
      }
    }, 250);
    draw();
  },
  { passive: false },
);

// Double-click a word to jump there
content.addEventListener("dblclick", (ev) => {
  const w = (ev.target as HTMLElement).closest<HTMLElement>(".w");
  if (!w) return;
  const i = Number(w.dataset.i);
  const c = wordCenters[i];
  if (c === undefined) return;
  tween = { from: y, to: clamp(c - guideY), start: performance.now(), dur: 300 };
  tracker.setCursorToWord(i);
  followTarget = clamp(c - guideY);
});

// Keyboard (when the prompter itself has focus)
window.addEventListener("keydown", (ev) => {
  const k = ev.key;
  if (k === " ") { ev.preventDefault(); togglePlay(); }
  else if (k === "ArrowUp" || k === "+" || k === "=") changeSpeed(+1);
  else if (k === "ArrowDown" || k === "-") changeSpeed(-1);
  else if (k === "PageUp" || k === "ArrowLeft") nudge(-1);
  else if (k === "PageDown" || k === "ArrowRight") nudge(+1);
  else if (k === "Home") rewind();
  else if (k === "End") seek(1);
  else if (k === "Escape") stop();
  else if (k.toLowerCase() === "m") runAction("cycle-mode");
  else return;
  sendStatus();
});

window.addEventListener("resize", () => relayout());
new ResizeObserver(() => relayout()).observe(content);

// ---------- Start ----------
async function init() {
  try {
    const raw = await invoke<string | null>("load_data");
    if (raw) {
      const data = normalizeData(JSON.parse(raw), () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, scripts: [], activeScriptId: null }));
      settings = data.settings;
      const s = data.scripts.find((x) => x.id === data.activeScriptId);
      applySettings();
      setScript(s?.id ?? null, s?.body ?? "");
    } else {
      applySettings();
      setScript(null, "");
    }
  } catch {
    applySettings();
  }
  // Ask the controls window for the latest (possibly unsaved) state.
  emitTo("main", "gp:prompter-ready", null).catch(() => {});
  requestAnimationFrame(frame);
}

document.fonts?.ready.then(() => relayout());
init();
