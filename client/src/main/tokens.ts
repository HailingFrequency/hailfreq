import { safeStorage, app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

function tokenFilePath(): string {
  return path.join(app.getPath("userData"), "credentials.enc");
}

/**
 * Whether we can use OS-level encryption (safeStorage).
 * In headless test environments the system keyring is unavailable;
 * we fall back to plain-text storage, gated behind HAILFREQ_TEST=1.
 */
function canEncrypt(): boolean {
  return safeStorage.isEncryptionAvailable();
}

function isTestMode(): boolean {
  return process.env.HAILFREQ_TEST === "1";
}

function plainTextTokenFilePath(): string {
  return path.join(app.getPath("userData"), "credentials.json");
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  if (canEncrypt()) {
    const json = JSON.stringify(creds);
    const buf = safeStorage.encryptString(json);
    await fs.writeFile(tokenFilePath(), buf, { mode: 0o600 });
    return;
  }
  if (!isTestMode()) {
    throw new Error("OS-level encryption unavailable; refusing to store tokens unencrypted.");
  }
  // Test mode fallback: store plain JSON (acceptable because test credentials
  // are ephemeral and the server is torn down after each test run).
  await fs.writeFile(plainTextTokenFilePath(), JSON.stringify(creds), { mode: 0o600 });
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  if (canEncrypt()) {
    try {
      const buf = await fs.readFile(tokenFilePath());
      const json = safeStorage.decryptString(buf);
      return JSON.parse(json) as StoredCredentials;
    } catch (err) {
      if (isNoEntError(err)) return null;
      throw err;
    }
  }
  if (!isTestMode()) return null;
  // Test mode fallback: read plain JSON
  try {
    const json = await fs.readFile(plainTextTokenFilePath(), "utf8");
    return JSON.parse(json) as StoredCredentials;
  } catch (err) {
    if (isNoEntError(err)) return null;
    throw err;
  }
}

export async function clearCredentials(): Promise<void> {
  await fs.rm(tokenFilePath(), { force: true });
}

function isNoEntError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
