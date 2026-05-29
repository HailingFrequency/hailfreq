import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ScInstallCandidate } from "../shared/ipc";

export type { ScInstallCandidate };

const SC_BRANCHES = ["LIVE", "PTU", "EPTU"];

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function probeBranches(installRoot: string, source: string): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  for (const branch of SC_BRANCHES) {
    const candidate = path.join(installRoot, branch, "Game.log");
    if (await fileExists(candidate)) {
      out.push({ gameLogPath: candidate, branch, source });
    }
  }
  return out;
}

async function findWindows(): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  if (process.platform !== "win32") return out;
  const candidates = [
    "C:\\Program Files\\Roberts Space Industries\\StarCitizen",
    "C:\\Program Files (x86)\\Roberts Space Industries\\StarCitizen",
  ];
  for (const root of candidates) {
    out.push(...(await probeBranches(root, "default-windows")));
  }
  return out;
}

async function scanDirForWinePrefix(baseDir: string, source: string): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const driveC = path.join(baseDir, entry.name, "drive_c");
      const installRoot = path.join(driveC, "Program Files", "Roberts Space Industries", "StarCitizen");
      try {
        await fs.access(installRoot);
        out.push(...(await probeBranches(installRoot, source)));
      } catch {
        // Not a SC prefix; ignore
      }
    }
  } catch {
    // baseDir doesn't exist; ignore
  }
  return out;
}

async function findLinux(): Promise<ScInstallCandidate[]> {
  if (process.platform !== "linux") return [];
  const home = os.homedir();
  const out: ScInstallCandidate[] = [];

  // Lutris
  out.push(...(await scanDirForWinePrefix(path.join(home, "Games"), "wine-lutris")));

  // Standard ~/.wine
  const wineRoot = path.join(home, ".wine", "drive_c", "Program Files", "Roberts Space Industries", "StarCitizen");
  try {
    await fs.access(wineRoot);
    out.push(...(await probeBranches(wineRoot, "wine-default")));
  } catch {
    // Not present; ignore
  }

  // Bottles
  out.push(...(await scanDirForWinePrefix(
    path.join(home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles"),
    "bottles",
  )));

  // Steam Proton
  const protonBase = path.join(home, ".steam", "steam", "steamapps", "compatdata");
  try {
    const entries = await fs.readdir(protonBase, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const installRoot = path.join(
        protonBase,
        e.name,
        "pfx",
        "drive_c",
        "Program Files",
        "Roberts Space Industries",
        "StarCitizen",
      );
      try {
        await fs.access(installRoot);
        out.push(...(await probeBranches(installRoot, "steam-proton")));
      } catch {
        // Not a SC prefix; ignore
      }
    }
  } catch {
    // protonBase doesn't exist; ignore
  }

  return out;
}

export async function findScInstallCandidates(): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  out.push(...(await findWindows()));
  out.push(...(await findLinux()));
  return out;
}

export async function validateGameLogPath(p: string): Promise<boolean> {
  return fileExists(p);
}
