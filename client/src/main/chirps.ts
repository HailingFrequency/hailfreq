import { app, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const CHIRP_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac"]);
const MAX_CHIRP_BYTES = 5 * 1024 * 1024;

const BUILTIN_CHIRPS = [
  { id: "builtin:classic-two-tone", name: "Classic two-tone", file: "classic-two-tone.wav" },
  { id: "builtin:motorola-quad", name: "Motorola quad tone", file: "motorola-quad.wav" },
  { id: "builtin:click", name: "Short radio click", file: "click.wav" },
  { id: "builtin:none", name: "None", file: "" },
];

export interface ChirpSummary {
  id: string;
  name: string;
  source: "builtin" | "custom";
}

export async function ensureChirpFolder(): Promise<string> {
  const folder = path.join(app.getPath("userData"), "chirps");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}

function builtinChirpsDir(): string {
  return path.join(app.getAppPath(), "assets", "chirps", "built-in");
}

export async function listChirps(): Promise<ChirpSummary[]> {
  const out: ChirpSummary[] = BUILTIN_CHIRPS.map((c) => ({
    id: c.id,
    name: c.name,
    source: "builtin",
  }));
  try {
    const folder = await ensureChirpFolder();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CHIRP_EXTENSIONS.has(ext)) continue;
      out.push({
        id: `custom:${encodeURIComponent(entry.name)}`,
        name: path.parse(entry.name).name,
        source: "custom",
      });
    }
  } catch (err) {
    console.error("Failed to list custom chirps:", err);
  }
  return out;
}

export async function readChirp(id: string): Promise<Uint8Array> {
  if (id === "builtin:none") return new Uint8Array(0);
  if (id.startsWith("builtin:")) {
    const entry = BUILTIN_CHIRPS.find((c) => c.id === id);
    if (!entry || !entry.file) throw new Error(`Unknown built-in chirp: ${id}`);
    const filePath = path.join(builtinChirpsDir(), entry.file);
    return Uint8Array.from(await fs.readFile(filePath));
  }
  if (id.startsWith("custom:")) {
    const fileName = decodeURIComponent(id.slice("custom:".length));
    if (!fileName || fileName !== path.basename(fileName)) {
      throw new Error("Invalid chirp file name");
    }
    const ext = path.extname(fileName).toLowerCase();
    if (!CHIRP_EXTENSIONS.has(ext)) {
      throw new Error("Custom chirps must be WAV, MP3, OGG, or FLAC files");
    }
    const folder = await ensureChirpFolder();
    const filePath = path.join(folder, fileName);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("Selected chirp is not a file");
    if (stat.size > MAX_CHIRP_BYTES) throw new Error("Selected chirp is larger than 5 MB");
    return Uint8Array.from(await fs.readFile(filePath));
  }
  throw new Error(`Unknown chirp id: ${id}`);
}

export async function openChirpFolder(): Promise<string> {
  const folder = await ensureChirpFolder();
  const result = await shell.openPath(folder);
  if (result) throw new Error(result);
  return folder;
}
