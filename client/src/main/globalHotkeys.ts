import { globalShortcut, BrowserWindow, app } from "electron";
import crypto from "node:crypto";

interface HotkeyRegistration {
  id: string;
  accelerator: string;
  /** Logical net identifier (the renderer chooses; we just round-trip it). */
  metadata: unknown;
}

const registry = new Map<string, HotkeyRegistration>();

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export function registerHotkey(accelerator: string, metadata: unknown): { id: string } | { error: string } {
  // Check if already registered with the same accelerator
  for (const existing of registry.values()) {
    if (existing.accelerator === accelerator) {
      return { error: `accelerator ${accelerator} already registered` };
    }
  }
  const id = crypto.randomUUID();
  const ok = globalShortcut.register(accelerator, () => {
    broadcast("hotkey:pressed", { id, accelerator });
    // Electron has no native "release" event; we synthesize it on the next tick.
    // For PTT we rely on the renderer wrapping start/stop around press.
    setImmediate(() => broadcast("hotkey:released", { id, accelerator }));
  });
  if (!ok) {
    return { error: `failed to register accelerator ${accelerator} (in use by another app?)` };
  }
  registry.set(id, { id, accelerator, metadata });
  return { id };
}

export function unregisterHotkey(id: string): void {
  const reg = registry.get(id);
  if (!reg) return;
  globalShortcut.unregister(reg.accelerator);
  registry.delete(id);
}

export function unregisterAllHotkeys(): void {
  for (const reg of registry.values()) {
    globalShortcut.unregister(reg.accelerator);
  }
  registry.clear();
}

export function listHotkeys(): HotkeyRegistration[] {
  return Array.from(registry.values());
}

// Clean up on app quit
app.on("will-quit", () => {
  unregisterAllHotkeys();
});
