import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

// Neutralize Electron's BrowserWindow so broadcast() is a no-op in node tests.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import { startWatch, stopWatch, getWatchStatus } from "@/main/scLogTail";

let logPath: string;

beforeEach(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hf-sclog-"));
  logPath = path.join(dir, "Game.log");
  await fsp.writeFile(logPath, "existing content\n");
});

afterEach(async () => {
  await stopWatch();
});

describe("getWatchStatus", () => {
  it("reports not-watching when no tailer is active", async () => {
    await stopWatch();
    expect(getWatchStatus()).toEqual({ watching: false, path: null, lastLineAt: null });
  });

  it("reports watching + path + null lastLineAt right after start (initial content skipped)", async () => {
    await startWatch(logPath);
    const s = getWatchStatus();
    expect(s.watching).toBe(true);
    expect(s.path).toBe(logPath);
    expect(s.lastLineAt).toBeNull();
  });

  it("stamps lastLineAt once a new line is appended", async () => {
    await startWatch(logPath);
    await fsp.appendFile(logPath, "a fresh line\n");
    // Condition-based wait: poll until the 500ms tailer interval picks it up.
    const deadline = Date.now() + 3000;
    while (getWatchStatus().lastLineAt === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(getWatchStatus().lastLineAt).toBeTypeOf("number");
  });

  it("returns to not-watching after stopWatch", async () => {
    await startWatch(logPath);
    await stopWatch();
    expect(getWatchStatus()).toEqual({ watching: false, path: null, lastLineAt: null });
  });
});
