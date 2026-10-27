// Downloads the offline speech engine (Vosk) and the small English model into
// src-tauri/resources/vosk. They are too large for git (about 120 MB unpacked),
// so builds fetch them from the official sources and check their SHA-256 hashes.
//
//   node scripts/fetch-speech.mjs          skip if already present
//   node scripts/fetch-speech.mjs --force  download again

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src-tauri", "resources", "vosk");

const PARTS = [
  {
    name: "Vosk engine 0.3.45 (Windows x64)",
    url: "https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip",
    sha256: "f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b",
    folder: "vosk-win64-0.3.45",
    to: "lib",
    keep: (file) => file.endsWith(".dll"),
  },
  {
    name: "Vosk small English model 0.15",
    url: "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip",
    sha256: "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498",
    folder: "vosk-model-small-en-us-0.15",
    to: "model",
    keep: () => true,
  },
];

const ready = existsSync(join(dest, "lib", "libvosk.dll")) && existsSync(join(dest, "model", "am", "final.mdl"));
if (ready && !process.argv.includes("--force")) {
  console.log("Speech files already in place.");
  process.exit(0);
}

// Windows ships bsdtar, which can unpack .zip files.
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe") : "tar";
const work = await mkdtemp(join(tmpdir(), "gits-speech-"));

try {
  for (const part of PARTS) {
    console.log(`Downloading ${part.name}…`);
    const res = await fetch(part.url);
    if (!res.ok) throw new Error(`${part.url} returned ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== part.sha256) throw new Error(`${part.name}: unexpected SHA-256 ${hash}`);

    const zip = join(work, `${part.to}.zip`);
    const out = join(work, part.to);
    await writeFile(zip, bytes);
    await mkdir(out, { recursive: true });
    execFileSync(tar, ["-xf", zip, "-C", out], { stdio: "inherit" });

    const target = join(dest, part.to);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const src = join(out, part.folder);
    for (const entry of await readdir(src)) {
      if (part.keep(entry)) await cp(join(src, entry), join(target, entry), { recursive: true });
    }
  }
  console.log(`Speech files ready in ${dest}`);
} finally {
  await rm(work, { recursive: true, force: true });
}

