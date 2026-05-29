import { BrowserWindow } from "electron";
import fs from "node:fs";
import { promises as fsp } from "node:fs";

interface WatchState {
  path: string;
  watcher: fs.FSWatcher | null;
  offset: number;
  buffer: string;
  stopped: boolean;
  _teardown: (() => void) | null;
}

let active: WatchState | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function readNewBytes(state: WatchState): Promise<void> {
  if (state.stopped) return;
  let stat;
  try {
    stat = await fsp.stat(state.path);
  } catch {
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
    for (const line of lines) {
      if (line.length > 0) {
        broadcast("sc:logLine", { line });
      }
    }
  } finally {
    await fd.close();
  }
}

export async function startWatch(gameLogPath: string): Promise<void> {
  if (active && active.path === gameLogPath) return;
  await stopWatch();

  // Initial read: skip existing content; we only care about appends from "now" forward
  let initialSize = 0;
  try {
    const stat = await fsp.stat(gameLogPath);
    initialSize = stat.size;
  } catch {
    throw new Error(`Game.log not found at ${gameLogPath}`);
  }

  const state: WatchState = {
    path: gameLogPath,
    watcher: null,
    offset: initialSize,
    buffer: "",
    stopped: false,
    _teardown: null,
  };
  active = state;

  // fs.watch may not catch all changes on all platforms; combine with periodic polling as backup
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  try {
    state.watcher = fs.watch(gameLogPath, { persistent: true }, () => {
      void readNewBytes(state);
    });
  } catch (err) {
    console.error("fs.watch failed; relying on polling:", err);
  }
  pollTimer = setInterval(() => void readNewBytes(state), 500);

  state._teardown = () => {
    state.stopped = true;
    if (state.watcher) state.watcher.close();
    if (pollTimer) clearInterval(pollTimer);
  };
}

export async function stopWatch(): Promise<void> {
  if (active) {
    if (active._teardown) active._teardown();
    active = null;
  }
}
