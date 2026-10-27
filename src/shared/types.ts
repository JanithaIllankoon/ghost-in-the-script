export type ScrollMode = "manual" | "voice" | "follow";

export const MODE_LABELS: Record<ScrollMode, string> = {
  manual: "Fixed speed",
  voice: "Voice-activated",
  follow: "Follow my voice",
};

export const MODE_HINTS: Record<ScrollMode, string> = {
  manual: "Scrolls at a steady speed you choose.",
  voice: "Scrolls at your speed while you talk, stops when you go quiet.",
  follow: "Listens to your words and keeps the line you're reading on the guide.",
};

export type Action =
  | "play-pause"
  | "speed-up"
  | "speed-down"
  | "back"
  | "forward"
  | "rewind"
  | "cycle-mode"
  | "toggle-click-through"
  | "toggle-prompter"
  | "toggle-controls";

export const ACTION_LABELS: Record<Action, string> = {
  "play-pause": "Play / pause",
  "speed-up": "Speed up",
  "speed-down": "Slow down",
  back: "Back one line",
  forward: "Forward one line",
  rewind: "Back to start",
  "cycle-mode": "Switch scroll mode",
  "toggle-click-through": "Click-through on/off",
  "toggle-prompter": "Show / hide prompter",
  "toggle-controls": "Show / hide controls",
};

export const DEFAULT_HOTKEYS: Record<Action, string> = {
  "play-pause": "Ctrl+Alt+Space",
  "speed-up": "Ctrl+Alt+Up",
  "speed-down": "Ctrl+Alt+Down",
  back: "Ctrl+Alt+PageUp",
  forward: "Ctrl+Alt+PageDown",
  rewind: "Ctrl+Alt+Home",
  "cycle-mode": "Ctrl+Alt+M",
  "toggle-click-through": "Ctrl+Alt+K",
  "toggle-prompter": "Ctrl+Alt+P",
  "toggle-controls": "Ctrl+Alt+O",
};

export interface Settings {
  // Text
  fontFamily: string;
  fontSize: number; // px
  fontWeight: number;
  lineHeight: number; // multiple of font size
  letterSpacing: number; // px
  wordSpacing: number; // px
  paragraphSpacing: number; // em
  textAlign: "left" | "center" | "right" | "justify";
  uppercase: boolean;
  marginX: number; // % of width on each side
  textOutline: boolean;

  // Colours
  textColor: string;
  bgColor: string;
  bgOpacity: number; // 0-100
  cueColor: string;
  highlightColor: string;
  readOpacity: number; // 0-100, how visible already-read text stays

  // Reading guide
  guideEnabled: boolean;
  guidePosition: number; // % from top
  guideStyle: "line" | "band" | "arrows";
  guideColor: string;
  fadeEdges: boolean;

  // Playback
  mode: ScrollMode;
  speed: number; // 1-100
  countdown: number; // seconds
  showProgress: boolean;
  showTimer: boolean;

  // Voice
  micDevice: string;
  voiceSensitivity: number; // 0-100, higher = picks up quieter speech
  silenceHold: number; // ms to keep scrolling after you stop talking
  restrictVocabulary: boolean;
  modelPath: string;
  followSmoothing: number; // 1-10

  // Window
  mirrorH: boolean;
  mirrorV: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  hidePrompterFromCapture: boolean;
  hideControlsFromCapture: boolean;
  showInTaskbar: boolean;

  hotkeys: Record<Action, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  fontFamily: "Segoe UI",
  fontSize: 44,
  fontWeight: 600,
  lineHeight: 1.45,
  letterSpacing: 0,
  wordSpacing: 0,
  paragraphSpacing: 0.9,
  textAlign: "left",
  uppercase: false,
  marginX: 6,
  textOutline: true,

  textColor: "#f4f5ff",
  bgColor: "#050d2e",
  bgOpacity: 78,
  cueColor: "#e9b75f",
  highlightColor: "#2f6fe8",
  readOpacity: 45,

  guideEnabled: true,
  guidePosition: 30,
  guideStyle: "arrows",
  guideColor: "#7fa8ff",
  fadeEdges: true,

  mode: "manual",
  speed: 22,
  countdown: 3,
  showProgress: true,
  showTimer: true,

  micDevice: "",
  voiceSensitivity: 55,
  silenceHold: 700,
  restrictVocabulary: true,
  modelPath: "",
  followSmoothing: 5,

  mirrorH: false,
  mirrorV: false,
  alwaysOnTop: true,
  clickThrough: false,
  hidePrompterFromCapture: true,
  hideControlsFromCapture: true,
  showInTaskbar: true,

  hotkeys: { ...DEFAULT_HOTKEYS },
};

export interface Script {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppData {
  version: 1;
  settings: Settings;
  scripts: Script[];
  activeScriptId: string | null;
}

/** Fills in any settings added in newer versions so old save files keep working. */
// Colours that shipped as defaults in 1.0. If a saved value still equals one of these,
// the person never changed it, so it moves to the 1.1 palette.
const OLD_DEFAULT_COLORS: Partial<Record<keyof Settings, string>> = {
  textColor: "#ffffff",
  bgColor: "#0b0c10",
  cueColor: "#ffc857",
  highlightColor: "#6d5dfc",
  guideColor: "#ff4d6d",
};

export function normalizeData(raw: unknown, fallback: () => AppData): AppData {
  if (!raw || typeof raw !== "object") return fallback();
  const d = raw as Partial<AppData>;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...(d.settings ?? {}),
    hotkeys: { ...DEFAULT_HOTKEYS, ...(d.settings?.hotkeys ?? {}) },
  };
  for (const [key, oldValue] of Object.entries(OLD_DEFAULT_COLORS) as [keyof Settings, string][]) {
    if (String(settings[key]).toLowerCase() === oldValue) (settings as unknown as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
  }
  const scripts = Array.isArray(d.scripts) ? d.scripts.filter((s) => s && typeof s.id === "string") : [];
  if (scripts.length === 0) return { ...fallback(), settings };
  const activeScriptId =
    d.activeScriptId && scripts.some((s) => s.id === d.activeScriptId) ? d.activeScriptId : scripts[0].id;
  return { version: 1, settings, scripts, activeScriptId };
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Speed setting -> lines per second. Speed 25 is about half a line per second. */
export function linesPerSecond(speed: number): number {
  return Math.max(0.01, speed) / 50;
}

export interface PrompterStatus {
  playing: boolean;
  counting: number; // countdown seconds left, 0 if none
  mode: ScrollMode;
  speed: number;
  progress: number; // 0-1
  elapsed: number; // seconds
  remaining: number; // seconds, estimated
  wpm: number;
  voice: {
    running: boolean;
    recognizing: boolean;
    speaking: boolean;
    heard: string;
    device: string;
    error: string;
    loading: boolean;
  };
  clickThrough: boolean;
  visible: boolean;
}

export type PrompterCommand =
  | { type: Action }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; fraction: number }
  | { type: "set-mode"; mode: ScrollMode };
