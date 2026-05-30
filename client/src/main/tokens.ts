import { safeStorage, app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * H2: serverId is interpolated into a filesystem path. It must be a UUID so a
 * compromised renderer can't pass `../...` to read, write, or delete files
 * outside the credentials directory via the tokens:* IPC channels.
 */
function assertServerId(serverId: string): void {
  if (typeof serverId !== "string" || !SERVER_ID_RE.test(serverId)) {
    throw new Error("Invalid serverId (expected a UUID)");
  }
}

function credentialsDir(): string {
  return path.join(app.getPath("userData"), "credentials");
}

function encryptedPath(serverId: string): string {
  assertServerId(serverId);
  return path.join(credentialsDir(), `${serverId}.enc`);
}

function plaintextPath(serverId: string): string {
  assertServerId(serverId);
  return path.join(credentialsDir(), `${serverId}.json`);
}

function isTestMode(): boolean {
  // L1: never honor the test flag in a packaged build, so a stray HAILFREQ_TEST=1
  // in a production environment can't enable the plaintext-credential fallback.
  return !app.isPackaged && process.env.HAILFREQ_TEST === "1";
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
