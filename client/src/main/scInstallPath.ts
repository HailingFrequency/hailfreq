import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ScInstallCandidate, ScInstallSource } from "../shared/ipc";

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

async function probeBranches(installRoot: string, source: ScInstallSource): Promise<ScInstallCandidate[]> {
  const results = await Promise.all(
    SC_BRANCHES.map(async (branch) => {
      const candidate = path.join(installRoot, branch, "Game.log");
      return (await fileExists(candidate)) ? { gameLogPath: candidate, branch, source } : null;
    }),
  );
  return results.filter((c): c is ScInstallCandidate => c !== null);
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

async function scanDirForWinePrefix(baseDir: string, source: ScInstallSource): Promise<ScInstallCandidate[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const arrays = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (entry) => {
        const installRoot = path.join(baseDir, entry.name, "drive_c", "Program Files", "Roberts Space Industries", "StarCitizen");
        try {
          await fs.access(installRoot);
        } catch {
          return [];
        }
        return probeBranches(installRoot, source);
      }),
  );
  return arrays.flat();
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
    const protonEntries = await fs.readdir(protonBase, { withFileTypes: true });
    const protonArrays = await Promise.all(
      protonEntries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
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
          } catch {
            return [];
          }
          return probeBranches(installRoot, "steam-proton");
        }),
    );
    out.push(...protonArrays.flat());
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
  if (typeof p !== "string") return false;
  if (!path.isAbsolute(p)) return false;
  if (path.basename(p) !== "Game.log") return false;
  return fileExists(p);
}
