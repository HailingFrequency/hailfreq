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

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable; refusing to store tokens unencrypted.");
  }
  const json = JSON.stringify(creds);
  const buf = safeStorage.encryptString(json);
  await fs.writeFile(tokenFilePath(), buf, { mode: 0o600 });
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const buf = await fs.readFile(tokenFilePath());
    const json = safeStorage.decryptString(buf);
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
