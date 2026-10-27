// Dev-only harness: runs the controls window in a normal browser by faking the Rust side.
// Not part of the app build. URL flags: ?fail=load, ?fail=save, ?capture=fail, ?empty=1, ?skip=1 (skip the start screen),
// ?conflict=1 (pretend another app owns Ctrl+Alt+Space)
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

const flags = new URLSearchParams(location.search);
mockWindows("main", "prompter");

let stored: string | null = flags.get("empty") ? JSON.stringify({ version: 1, settings: {}, scripts: [{ id: "a", title: "", body: "", createdAt: 1, updatedAt: Date.now() }], activeScriptId: "a" }) : null;
let prompterVisible = false; // the real app keeps the prompter hidden until Continue
const status = {
  playing: false, counting: 0, mode: "manual", speed: 22, progress: 0, elapsed: 0, remaining: 81, wpm: 0,
  voice: { running: false, recognizing: false, speaking: false, heard: "", device: "", error: "", loading: false },
  clickThrough: false, visible: true,
};
(window as any).__preview = { status, get stored() { return stored; } };
(window as any).__emit = emit;
const log: string[] = [];
(window as any).__log = log;

function pushStatus() {
  status.visible = prompterVisible;
  emit("gp:status", status);
}

const handler = async (cmd: string, args: any): Promise<unknown> => {
    log.push(cmd + (args?.event ? ":" + args.event : ""));
    switch (cmd) {
      case "load_data":
        if (flags.get("fail") === "load") throw "The file is not valid JSON";
        return stored;
      case "save_data":
        if (flags.get("fail") === "save") throw "Access is denied. (os error 5)";
        stored = args.json;
        return null;
      case "set_capture_hidden":
        if (flags.get("capture") === "fail") throw "Windows refused";
        return { hidden: args.hidden, affinity: args.hidden ? 0x11 : 0 };
      case "set_hotkeys": {
        const taken = new Set(["Ctrl+Alt+F1", ...(flags.get("conflict") ? ["Ctrl+Alt+Space"] : [])]);
        return Object.entries(args.hotkeys as Record<string, string>)
          .filter(([, keys]) => taken.has(keys))
          .map(([action, keys]) => ({ action, keys, message: "HotKey already registered" }));
      }
      case "quit_app":
        (window as any).__quit = true;
        return null;
      case "set_taskbar_hidden":
        (window as any).__taskbarHidden = args.hidden;
        return null;
      case "open_github":
        if (flags.get("fail") === "github") throw "No default browser";
        (window as any).__githubOpened = ((window as any).__githubOpened ?? 0) + 1;
        return null;
      case "voice_devices":
        return ["Microphone Array (Realtek Audio)", "USB Headset Mic"];
      case "plugin:event|emit_to": {
        const { event, payload } = args;
        if (event === "gp:settings") {
          status.mode = payload.mode;
          status.speed = payload.speed;
          status.voice.running = payload.mode !== "manual";
          status.voice.recognizing = payload.mode === "follow";
          status.voice.device = "Microphone Array (Realtek Audio)";
        } else if (event === "gp:cmd") {
          const t = payload.type;
          if (t === "play") { status.playing = true; }
          else if (t === "pause") status.playing = false;
          else if (t === "rewind") { status.progress = 0; status.elapsed = 0; status.playing = false; }
          else if (t === "seek") status.progress = payload.fraction;
          else if (t === "forward") status.progress = Math.min(1, status.progress + 0.05);
          else if (t === "back") status.progress = Math.max(0, status.progress - 0.05);
        }
        pushStatus();
        return null;
      }
      case "plugin:window|get_all_windows":
        return ["main", "prompter"];
      case "plugin:window|is_visible":
        return prompterVisible;
      case "plugin:window|show":
        prompterVisible = true; pushStatus(); return null;
      case "plugin:window|hide":
        prompterVisible = false; pushStatus(); return null;
      case "plugin:window|outer_size":
        return { width: 900, height: 340 };
      case "plugin:window|primary_monitor":
        return { name: "Display", size: { width: 1920, height: 1080 }, position: { x: 0, y: 0 }, scaleFactor: 1.25, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1032 } } };
      default:
        return null;
    }
};
mockIPC(handler, { shouldMockEvents: true });

// The mock event plugin swallows emit_to, so route it to the handler above first.
const internals = (window as any).__TAURI_INTERNALS__;
const mockedInvoke = internals.invoke;
internals.invoke = (cmd: string, args: any, opts: any) => {
  if (cmd === "plugin:event|emit_to") return handler(cmd, args);
  return mockedInvoke(cmd, args, opts);
};

setInterval(() => {
  if (status.playing) {
    status.progress = Math.min(1, status.progress + 0.01);
    status.elapsed += 0.5;
    status.wpm = 148;
  }
  if (status.voice.running) emit("gp:voice-level", { level: 0.3 + Math.random() * 0.5 });
  pushStatus();
}, 500);

await import("../src/controls/main.ts");

if (flags.get("skip")) {
  const cont = document.getElementById("splash-continue")!;
  const wait = () => new Promise((r) => setTimeout(r, 50));
  while (cont.hasAttribute("aria-disabled")) await wait();
  document.getElementById("splash")!.hidden = true;
}
