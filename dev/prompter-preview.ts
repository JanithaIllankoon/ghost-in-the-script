// Dev-only harness for the prompter overlay. Not part of the app build.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WELCOME_SCRIPT } from "../src/shared/sample";
import { DEFAULT_SETTINGS } from "../src/shared/types";

mockWindows("prompter", "main");
mockIPC(
  async (cmd) => {
    if (cmd === "load_data") return JSON.stringify({ version: 1, settings: DEFAULT_SETTINGS, scripts: [{ id: "a", title: "Welcome", body: WELCOME_SCRIPT, createdAt: 1, updatedAt: 1 }], activeScriptId: "a" });
    if (cmd === "plugin:window|is_visible") return true;
    if (cmd === "voice_start") return { device: "Preview microphone", sampleRate: 48000, recognizing: false, vocabularySize: 0, unknownWords: [] };
    return null;
  },
  { shouldMockEvents: true },
);
await import("../src/prompter/main.ts");
