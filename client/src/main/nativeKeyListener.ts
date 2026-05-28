import { GlobalKeyboardListener } from "node-global-key-listener";
import { BrowserWindow } from "electron";
import crypto from "node:crypto";

interface HoldRegistration {
  id: string;
  /** The Electron-style accelerator (e.g., "F13", "Control+Shift+P"). */
  accelerator: string;
  /** Native-key matcher derived from the accelerator. */
  matchKey: string;
  matchModifiers: string[];
  metadata: unknown;
}

const registry = new Map<string, HoldRegistration>();
let listener: GlobalKeyboardListener | null = null;
let listenerActive = false;

function isWayland(): boolean {
  return (
    process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY)
  );
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function ensureListener(): Promise<boolean> {
  if (listenerActive) return true;
  if (isWayland()) return false; // Wayland blocks global key hooks
  try {
    listener = new GlobalKeyboardListener();
    listener.addListener((event, down) => {
      // event.name is the key name (e.g., "F13", "A", "LEFT CTRL"); event.state is "DOWN" or "UP"
      // event.rawKey provides modifier state details across platforms
      const eventModifiers = new Set<string>();
      if (down["LEFT CTRL"] || down["RIGHT CTRL"]) eventModifiers.add("Control");
      if (down["LEFT ALT"] || down["RIGHT ALT"]) eventModifiers.add("Alt");
      if (down["LEFT SHIFT"] || down["RIGHT SHIFT"]) eventModifiers.add("Shift");
      if (down["LEFT META"] || down["RIGHT META"]) eventModifiers.add("Super");

      for (const reg of registry.values()) {
        if (event.name !== reg.matchKey) continue;
        const allMatch = reg.matchModifiers.every((m) => eventModifiers.has(m));
        const noExtras = eventModifiers.size === reg.matchModifiers.length;
        if (!allMatch || !noExtras) continue;
        if (event.state === "DOWN") {
          broadcast("nativeHotkey:down", { id: reg.id, accelerator: reg.accelerator });
        } else if (event.state === "UP") {
          broadcast("nativeHotkey:up", { id: reg.id, accelerator: reg.accelerator });
        }
      }
    });
    listenerActive = true;
    return true;
  } catch (err) {
    console.error("Failed to start native key listener:", err);
    return false;
  }
}

function normalizeKeyForListener(key: string): string {
  // node-global-key-listener uses "NUMPAD 0", "NUMPAD 1", etc.
  const numpadMatch = key.match(/^NUM(\d)$/);
  if (numpadMatch) return `NUMPAD ${numpadMatch[1]}`;
  if (key === "NUMPADDOT" || key === "NUMPADDECIMAL") return "NUMPAD DOT";
  if (key === "NUMPADENTER") return "NUMPAD ENTER";
  if (key === "NUMPADADD" || key === "NUMPADPLUS") return "NUMPAD +";
  if (key === "NUMPADSUBTRACT" || key === "NUMPADMINUS") return "NUMPAD -";
  if (key === "NUMPADMULTIPLY") return "NUMPAD *";
  if (key === "NUMPADDIVIDE") return "NUMPAD /";
  return key;
}

function acceleratorToMatcher(accelerator: string): { key: string; modifiers: string[] } {
  const parts = accelerator.split("+");
  const modifiers: string[] = [];
  let key = "";
  for (const p of parts) {
    if (p === "Control" || p === "Alt" || p === "Shift" || p === "Super") {
      modifiers.push(p);
    } else {
      key = p.toUpperCase(); // node-global-key-listener uses uppercase
    }
  }
  key = normalizeKeyForListener(key);
  return { key, modifiers };
}

export async function registerHold(
  accelerator: string,
  metadata: unknown,
): Promise<{ id: string } | { error: string }> {
  const started = await ensureListener();
  if (!started) {
    return {
      error:
        "Press-and-hold not supported on this platform (Wayland blocks global key hooks). Use tap-to-toggle or voice activation.",
    };
  }
  const { key, modifiers } = acceleratorToMatcher(accelerator);
  if (!key) return { error: `Invalid accelerator: ${accelerator}` };
  const id = crypto.randomUUID();
  registry.set(id, { id, accelerator, matchKey: key, matchModifiers: modifiers, metadata });
  return { id };
}

export function unregisterHold(id: string): void {
  registry.delete(id);
  // Tear down listener if no remaining registrations
  if (registry.size === 0 && listener && listenerActive) {
    listener.kill();
    listener = null;
    listenerActive = false;
  }
}

export function unregisterAllHolds(): void {
  registry.clear();
  if (listener && listenerActive) {
    listener.kill();
    listener = null;
    listenerActive = false;
  }
}
