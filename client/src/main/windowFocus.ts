/**
 * Single-process focus probe for the focused-app PTT gate.
 *
 * On Windows / macOS / Linux X11, polls active-win every 500ms and caches
 * the focused window's process name + title.
 *
 * On Linux Wayland there is no portable API to query the active window
 * (deliberate security model). We detect XDG_SESSION_TYPE=wayland and
 * skip polling entirely; getFocusedApp() returns null and the renderer
 * treats null as "permit" (fail-open) so Wayland users can still use PTT.
 */

import activeWin from "active-win";

export interface FocusedAppInfo {
  processName: string | null;
  title: string | null;
  isWayland: boolean;
}

let cache: FocusedAppInfo = {
  processName: null,
  title: null,
  isWayland: isWaylandSession(),
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

function isWaylandSession(): boolean {
  if (process.platform !== "linux") return false;
  return process.env.XDG_SESSION_TYPE === "wayland";
}

async function pollOnce(): Promise<void> {
  if (cache.isWayland) return;
  try {
    const result = await activeWin();
    if (result) {
      cache = {
        processName: result.owner?.name ?? null,
        title: result.title ?? null,
        isWayland: false,
      };
    } else {
      cache = { processName: null, title: null, isWayland: false };
    }
  } catch (err) {
    // active-win throws on Wayland and on unsupported configurations.
    // Log once and fall back to null (fail-open in the gate decision).
    console.error("[windowFocus] poll failed:", err);
    cache = { processName: null, title: null, isWayland: cache.isWayland };
  }
}

export function startFocusProbe(): void {
  if (pollTimer || cache.isWayland) return;
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), 500);
}

export function stopFocusProbe(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getFocusedApp(): FocusedAppInfo {
  return cache;
}
