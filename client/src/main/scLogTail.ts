/**
 * Single-process Game.log tailer. Only one tailer is active at a time per
 * Electron main process. If `startWatch` is called with a path different
 * from the active one, the previous tailer is stopped and a
 * `sc:tailerReplaced` push event is broadcast so renderer integrations
 * can react (e.g. stop their ScIntegration cleanly).
 *
 * Hailfreq is designed for one SC install per machine, so this is acceptable.
 * Multi-server users with different scInstallPath values will see only the
 * most-recently-started tailer's events.
 */

import { BrowserWindow } from "electron";
import fs from "node:fs";
import { promises as fsp } from "node:fs";

interface WatchState {
  path: string;
  watcher: fs.FSWatcher | null;
  offset: number;
  buffer: string;
  stopped: boolean;
  reading: boolean;
  _teardown: (() => void) | null;
}

let active: WatchState | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function readNewBytes(state: WatchState): Promise<void> {
  if (state.stopped || state.reading) return;
  state.reading = true;
  try {
    let stat;
    try {
      stat = await fsp.stat(state.path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error("scLogTail: stat failed", err);
      }
      return;
    }
    // Handle log rotation: file truncated → reset to 0
    if (stat.size < state.offset) {
      state.offset = 0;
      state.buffer = "";
    }
    if (stat.size === state.offset) return;

    const fd = await fsp.open(state.path, "r");
    try {
      const length = stat.size - state.offset;
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, state.offset);
      state.offset = stat.size;
      state.buffer += buf.toString("utf8");
      // Split on \n; keep partial trailing line in buffer
      const lines = state.buffer.split(/\r?\n/);
      state.buffer = lines.pop() ?? "";
      // L4: cap line length. Drop a partial trailing line that has grown past the
      // cap with no newline (so the buffer can't grow unbounded from a malformed
      // or maliciously-huge log line), and skip over-long complete lines.
      const MAX_LINE = 8192;
      if (state.buffer.length > MAX_LINE) state.buffer = "";
      for (const line of lines) {
        if (line.length > 0 && line.length <= MAX_LINE) {
          broadcast("sc:logLine", { line });
        }
      }
    } finally {
      await fd.close().catch((err) => {
        console.error("scLogTail: fd.close failed", err);
      });
    }
  } finally {
    state.reading = false;
  }
}

export async function startWatch(gameLogPath: string): Promise<void> {
  if (active && active.path === gameLogPath) return;
  if (active) {
    // Notify renderer that the previous tailer is being replaced
    broadcast("sc:tailerReplaced", { oldPath: active.path, newPath: gameLogPath });
  }
  await stopWatch();

  // Initial read: skip existing content; we only care about appends from "now" forward
  let initialSize = 0;
  try {
    const stat = await fsp.stat(gameLogPath);
    initialSize = stat.size;
  } catch {
    throw new Error(`Game.log not found at ${gameLogPath}`);
  }

  // Declare pollTimer before state so the _teardown closure can reference it
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const state: WatchState = {
    path: gameLogPath,
    watcher: null,
    offset: initialSize,
    buffer: "",
    stopped: false,
    reading: false,
    _teardown: null,
  };

  // fs.watch may not catch all changes on all platforms; combine with periodic polling as backup
  try {
    state.watcher = fs.watch(gameLogPath, { persistent: true }, () => {
      void readNewBytes(state);
    });
    state.watcher.on("error", (err) => {
      console.error("scLogTail: fs.watch error, falling back to polling only:", err);
      state.watcher?.close();
      state.watcher = null;
    });
  } catch (err) {
    console.error("fs.watch failed; relying on polling:", err);
  }
  pollTimer = setInterval(() => void readNewBytes(state), 500);

  // Set _teardown before assigning active so a concurrent stopWatch sees a fully-formed state
  state._teardown = () => {
    state.stopped = true;
    if (state.watcher) state.watcher.close();
    if (pollTimer) clearInterval(pollTimer);
  };

  active = state;
}

export async function stopWatch(): Promise<void> {
  if (active) {
    if (active._teardown) active._teardown();
    active = null;
  }
}
