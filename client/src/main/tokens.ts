import { safeStorage, app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

function credentialsDir(): string {
  return path.join(app.getPath("userData"), "credentials");
}

function encryptedPath(serverId: string): string {
  return path.join(credentialsDir(), `${serverId}.enc`);
}

function plaintextPath(serverId: string): string {
  return path.join(credentialsDir(), `${serverId}.json`);
}

function isTestMode(): boolean {
  return process.env.HAILFREQ_TEST === "1";
}

export async function saveCredentials(serverId: string, creds: StoredCredentials): Promise<void> {
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
  if (isTestMode() && !safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(plaintextPath(serverId), JSON.stringify(creds), { mode: 0o600 });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable; refusing to store tokens unencrypted.");
  }
  const buf = safeStorage.encryptString(JSON.stringify(creds));
  await fs.writeFile(encryptedPath(serverId), buf, { mode: 0o600 });
}

export async function loadCredentials(serverId: string): Promise<StoredCredentials | null> {
  // Try encrypted first
  try {
    const buf = await fs.readFile(encryptedPath(serverId));
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredCredentials;
  } catch (err) {
    if (!isNoEnt(err)) throw err;
  }
  // Fallback to plaintext (test mode)
  if (isTestMode()) {
    try {
      const json = await fs.readFile(plaintextPath(serverId), "utf8");
      return JSON.parse(json) as StoredCredentials;
    } catch (err) {
      if (!isNoEnt(err)) throw err;
    }
  }
  return null;
}

export async function clearCredentials(serverId: string): Promise<void> {
  await fs.rm(encryptedPath(serverId), { force: true });
  await fs.rm(plaintextPath(serverId), { force: true });
}

/**
 * Move a legacy single-credentials.enc file into the new per-server location.
 * Idempotent: no-op if the legacy file doesn't exist.
 */
export async function migrateLegacyCredentials(newServerId: string): Promise<void> {
  const legacyPath = path.join(app.getPath("userData"), "credentials.enc");
  try {
    await fs.access(legacyPath);
  } catch {
    return; // No legacy file
  }
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
  await fs.rename(legacyPath, encryptedPath(newServerId));
}

function isNoEnt(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
