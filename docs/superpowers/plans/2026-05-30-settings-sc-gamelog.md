# Star Citizen / Ship Link Settings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Star Citizen" section to the ⚙ Settings menu that is the single home for the global Game.log path (Browse / Auto-detect / Clear + validity) with a live "is Ship Link watching?" status line, and remove the path field from the per-server SC modal.

**Architecture:** Reuse all existing Game.log machinery (the `sc:pickGameLog` / `sc:findInstall` / `sc:validatePath` IPC, the global tailer in `scLogTail.ts`, the `settings:setScInstallPath` persistence, and the AppState watcher effect that already restarts the tailer on path change). Add one new pure renderer helper module for the status logic, one new `getWatchStatus()` accessor + `lastLineAt` stamp on the tailer, one new `sc:watchStatus` IPC, one new React section component, then wire it through AppState → Sidebar → SettingsMenu and strip the path UI out of the per-server modal.

**Tech Stack:** Electron + React + TypeScript, Vitest (node environment), typed IPC (`src/shared/ipc.ts` channel map + `src/main/ipc.ts` handlers + `window.hailfreq.invoke`).

**Branch:** `feat/settings-sc-gamelog` (already created, stacked on `feat/settings-audio-devices`).

**Critical workflow note:** Do NOT run `npm run build` during development — it emits stale `.js` into `src/` that shadow the `.ts` (Vite/Vitest resolve `.js` first), which makes tests ignore your `.ts` edits. If tests behave strangely, run `git clean -Xfd src` to remove build artifacts. Use `npx vitest run <file>` for tests and `npx tsc --noEmit` for typechecking.

---

### Task 1: Pure watch-status helpers

Pure, dependency-free functions that encode the spec's four status states and the "last activity" relative-time string. These are the unit-testable core; the React component (Task 4) just renders their output.

**Files:**
- Create: `client/src/renderer/sc/watchStatus.ts`
- Test: `client/tests/unit/scWatchStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/tests/unit/scWatchStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveScWatchStatus, formatActivity } from "@/renderer/sc/watchStatus";

describe("deriveScWatchStatus", () => {
  it("returns 'unset' when no path is configured", () => {
    expect(deriveScWatchStatus({ scInstallPath: undefined, enabledServerNames: [], watching: false })).toBe("unset");
    expect(deriveScWatchStatus({ scInstallPath: "", enabledServerNames: ["A"], watching: true })).toBe("unset");
  });

  it("returns 'disabled' when a path is set but no server has Ship Link enabled", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: [], watching: false })).toBe("disabled");
  });

  it("returns 'watching' when path set, a server is enabled, and the tailer is active", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: ["A"], watching: true })).toBe("watching");
  });

  it("returns 'not-watching' when path set + enabled but tailer is not active (file missing)", () => {
    expect(deriveScWatchStatus({ scInstallPath: "/x/Game.log", enabledServerNames: ["A"], watching: false })).toBe("not-watching");
  });
});

describe("formatActivity", () => {
  it("reports no activity when lastLineAt is null", () => {
    expect(formatActivity(null, 1000)).toBe("no activity yet");
  });
  it("reports 'just now' under one second", () => {
    expect(formatActivity(1000, 1400)).toBe("just now");
  });
  it("reports seconds", () => {
    expect(formatActivity(1000, 4000)).toBe("3s ago");
  });
  it("reports minutes", () => {
    expect(formatActivity(0, 120_000)).toBe("2m ago");
  });
  it("reports hours", () => {
    expect(formatActivity(0, 7_200_000)).toBe("2h ago");
  });
  it("never returns a negative age", () => {
    expect(formatActivity(5000, 1000)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run tests/unit/scWatchStatus.test.ts`
Expected: FAIL — cannot resolve `@/renderer/sc/watchStatus` (module not found).

- [ ] **Step 3: Write the minimal implementation**

Create `client/src/renderer/sc/watchStatus.ts`:

```ts
/**
 * Pure helpers for the ⚙ Settings → Star Citizen section's status line.
 * Kept dependency-free so they unit-test in the node environment.
 */

export interface ScWatchStatusInput {
  /** The global Game.log path, or undefined when unset. */
  scInstallPath?: string;
  /** Display names of servers that currently have Ship Link enabled. */
  enabledServerNames: string[];
  /** Whether the main-process tailer is currently active. */
  watching: boolean;
}

export type ScWatchStatusKind = "unset" | "disabled" | "watching" | "not-watching";

/**
 * - unset:        no Game.log path configured.
 * - disabled:     path set, but no server has Ship Link enabled (tailer won't run).
 * - watching:     path set, a server is enabled, tailer is active.
 * - not-watching: path set + enabled but tailer isn't active (e.g. file missing).
 */
export function deriveScWatchStatus(input: ScWatchStatusInput): ScWatchStatusKind {
  if (!input.scInstallPath) return "unset";
  if (input.enabledServerNames.length === 0) return "disabled";
  return input.watching ? "watching" : "not-watching";
}

/** Human-readable age of the last Game.log line, e.g. "3s ago". */
export function formatActivity(lastLineAt: number | null, now: number): string {
  if (lastLineAt === null) return "no activity yet";
  const sec = Math.max(0, Math.round((now - lastLineAt) / 1000));
  if (sec < 1) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd client && npx vitest run tests/unit/scWatchStatus.test.ts`
Expected: PASS (10 assertions across 2 describes).

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/sc/watchStatus.ts client/tests/unit/scWatchStatus.test.ts
git commit -m "feat(sc): pure watch-status helpers for Game.log settings section"
```

---

### Task 2: Tailer `lastLineAt` stamp + `getWatchStatus()` accessor

Give the main-process tailer an authoritative status accessor and a "last line seen" timestamp so the renderer can show live activity.

**Files:**
- Modify: `client/src/main/scLogTail.ts` (add `lastLineAt` to `WatchState`, stamp it on broadcast, export `getWatchStatus`)
- Test: `client/tests/unit/scLogTail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/tests/unit/scLogTail.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && npx vitest run tests/unit/scLogTail.test.ts`
Expected: FAIL — `getWatchStatus` is not exported from `@/main/scLogTail`.

- [ ] **Step 3: Add `lastLineAt` to `WatchState`**

In `client/src/main/scLogTail.ts`, add the field to the `WatchState` interface (after `path: string;` at line 18):

```ts
interface WatchState {
  path: string;
  /** Timestamp (ms) of the last Game.log line broadcast; null until first line. */
  lastLineAt: number | null;
  watcher: fs.FSWatcher | null;
  offset: number;
  buffer: string;
  stopped: boolean;
  reading: boolean;
  _teardown: (() => void) | null;
}
```

- [ ] **Step 4: Stamp `lastLineAt` when broadcasting a line**

In `readNewBytes`, inside the `for (const line of lines)` loop, stamp the timestamp when a line is broadcast. Replace the existing loop body:

```ts
      for (const line of lines) {
        if (line.length > 0 && line.length <= MAX_LINE) {
          state.lastLineAt = Date.now();
          broadcast("sc:logLine", { line });
        }
      }
```

- [ ] **Step 5: Initialize `lastLineAt` in the `state` object**

In `startWatch`, add `lastLineAt: null,` to the `WatchState` literal (alongside `path: gameLogPath,`):

```ts
  const state: WatchState = {
    path: gameLogPath,
    lastLineAt: null,
    watcher: null,
    offset: initialSize,
    buffer: "",
    stopped: false,
    reading: false,
    _teardown: null,
  };
```

- [ ] **Step 6: Export `getWatchStatus`**

At the end of `client/src/main/scLogTail.ts` (after `stopWatch`), add:

```ts
export interface ScWatchStatus {
  watching: boolean;
  path: string | null;
  lastLineAt: number | null;
}

/** Snapshot of the tailer state for the Settings status line. */
export function getWatchStatus(): ScWatchStatus {
  if (!active) return { watching: false, path: null, lastLineAt: null };
  return { watching: true, path: active.path, lastLineAt: active.lastLineAt };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd client && npx vitest run tests/unit/scLogTail.test.ts`
Expected: PASS (4 assertions). The "stamps lastLineAt" test may take up to ~1s due to the 500ms poll.

- [ ] **Step 8: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/scLogTail.ts client/tests/unit/scLogTail.test.ts
git commit -m "feat(sc): add lastLineAt stamp + getWatchStatus accessor to tailer"
```

---

### Task 3: `sc:watchStatus` IPC channel + handler

Expose `getWatchStatus()` to the renderer. This is typed wiring verified by the typechecker (IPC handlers need `ipcMain` and aren't unit-tested in this repo; the logic they delegate to is covered by Task 2).

**Files:**
- Modify: `client/src/shared/ipc.ts` (add channel type, after line 86 `sc:stopWatch`)
- Modify: `client/src/main/ipc.ts` (import `getWatchStatus`, register handler)

- [ ] **Step 1: Add the channel type**

In `client/src/shared/ipc.ts`, immediately after the `"sc:stopWatch"` line (line 86), add:

```ts
  "sc:watchStatus": {
    args: [];
    result: { watching: boolean; path: string | null; lastLineAt: number | null };
  };
```

- [ ] **Step 2: Import the accessor in the main IPC module**

In `client/src/main/ipc.ts`, change the existing import (line 10) from:

```ts
import { startWatch, stopWatch } from "./scLogTail";
```

to:

```ts
import { startWatch, stopWatch, getWatchStatus } from "./scLogTail";
```

- [ ] **Step 3: Register the handler**

In `client/src/main/ipc.ts`, immediately after the `"sc:stopWatch"` handler (line 110, `ipcMain.handle("sc:stopWatch", () => stopWatch());`), add:

```ts
  ipcMain.handle("sc:watchStatus", () => getWatchStatus());
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (exit 0). The new channel's `result` type matches `ScWatchStatus`.

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/ipc.ts client/src/main/ipc.ts
git commit -m "feat(sc): sc:watchStatus IPC channel + handler"
```

---

### Task 4: `ScGameLogSettings` section component

The new global settings section. Persists the path immediately on Browse / Auto-detect / Clear (like `AudioDevicesSettings` persists on select — no Save button), shows a validity indicator, and renders the live watch-status line by polling `sc:watchStatus` (every 2s while mounted) and refreshing on `sc:logLine` / `sc:tailerReplaced` push events. Vitest runs in the node environment, so this UI component is verified by `tsc` + the manual test in Task 7 (the existing `AudioDevicesSettings` is likewise not unit-tested; its logic lives in the tested helpers).

**Files:**
- Create: `client/src/renderer/screens/settings/ScGameLogSettings.tsx`

- [ ] **Step 1: Write the component**

Create `client/src/renderer/screens/settings/ScGameLogSettings.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ScInstallCandidate } from "@shared/ipc";
import { Button } from "../../components/Button";
import { deriveScWatchStatus, formatActivity } from "../../sc/watchStatus";

interface Props {
  /** Current global Game.log path (undefined if never set). */
  scInstallPath?: string;
  /** Display names of servers that currently have Ship Link enabled. */
  enabledServerNames: string[];
  /** Persist a new path (or undefined to clear). */
  onChange: (path: string | undefined) => Promise<void> | void;
}

interface WatchStatus {
  watching: boolean;
  lastLineAt: number | null;
}

export function ScGameLogSettings({ scInstallPath, enabledServerNames, onChange }: Props) {
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [candidates, setCandidates] = useState<ScInstallCandidate[] | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [pickError, setPickError] = useState("");
  const [status, setStatus] = useState<WatchStatus>({ watching: false, lastLineAt: null });
  const [now, setNow] = useState(() => Date.now());

  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate the configured path (debounced) whenever it changes.
  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    setPathValid(null);
    const p = scInstallPath?.trim();
    if (!p) return;
    validateTimer.current = setTimeout(() => {
      void window.hailfreq
        .invoke("sc:validatePath", { path: p })
        .then((valid) => setPathValid(valid))
        .catch(() => setPathValid(false));
    }, 300);
    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [scInstallPath]);

  // Poll watch status every 2s; refresh immediately on log activity / tailer change.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.hailfreq
        .invoke("sc:watchStatus")
        .then((s) => {
          if (!cancelled) setStatus({ watching: s.watching, lastLineAt: s.lastLineAt });
        })
        .catch(() => {
          if (!cancelled) setStatus({ watching: false, lastLineAt: null });
        });
    };
    refresh();
    const poll = setInterval(refresh, 2000);
    const offLine = window.hailfreq.onScLogLine(() => refresh());
    const offReplaced = window.hailfreq.onScTailerReplaced(() => refresh());
    return () => {
      cancelled = true;
      clearInterval(poll);
      offLine();
      offReplaced();
    };
  }, []);

  // Tick "now" once a second so the relative activity time stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleBrowse() {
    setPickError("");
    try {
      const picked = await window.hailfreq.invoke("sc:pickGameLog");
      if (picked) {
        setCandidates(null);
        setDetectError("");
        await onChange(picked);
      }
    } catch {
      setPickError("Could not open file picker");
    }
  }

  async function handleAutoDetect() {
    setDetectBusy(true);
    setDetectError("");
    setCandidates(null);
    try {
      const found = await window.hailfreq.invoke("sc:findInstall");
      setCandidates(found);
      if (found.length === 0) setDetectError("No Star Citizen installation found automatically.");
    } catch {
      setDetectError("Auto-detect failed. Try browsing manually.");
    } finally {
      setDetectBusy(false);
    }
  }

  async function handleSelectCandidate(candidate: ScInstallCandidate) {
    setCandidates(null);
    setDetectError("");
    await onChange(candidate.gameLogPath);
  }

  async function handleClear() {
    setCandidates(null);
    setDetectError("");
    setPickError("");
    await onChange(undefined);
  }

  const kind = deriveScWatchStatus({ scInstallPath, enabledServerNames, watching: status.watching });
  const statusLine = (() => {
    switch (kind) {
      case "unset":
        return { text: "No Game.log selected.", tone: "text-slate-400" };
      case "disabled":
        return {
          text: "Path set, but Ship Link isn't enabled on any server. Enable it from a server's Star Citizen Integration menu.",
          tone: "text-amber-400",
        };
      case "watching":
        return { text: `Watching ✓ — last activity ${formatActivity(status.lastLineAt, now)}`, tone: "text-green-400" };
      case "not-watching":
        return { text: "Not watching — Game.log not found at the configured path.", tone: "text-rose-400" };
    }
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Star Citizen Game.log</h3>
        <p className="text-xs text-slate-500">
          Point Hailfreq at your Game.log so Ship Link can spin up a voice net (or invite your crew) when you board your ship.
        </p>
        <div className="rounded border border-slate-700 bg-slate-900 p-2 text-xs break-all">
          {scInstallPath ? (
            <span className="text-slate-200">{scInstallPath}</span>
          ) : (
            <span className="text-slate-500 italic">Not set</span>
          )}
        </div>
        {scInstallPath && pathValid === true && <p className="text-xs text-green-400">Path looks valid.</p>}
        {scInstallPath && pathValid === false && (
          <p className="text-xs text-rose-400">Path not found or not a valid Game.log file.</p>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void handleAutoDetect()} disabled={detectBusy} className="text-xs px-3 py-1.5">
            {detectBusy ? "Detecting…" : "Auto-detect"}
          </Button>
          <Button variant="ghost" onClick={() => void handleBrowse()} className="text-xs px-3 py-1.5">
            Browse…
          </Button>
          {scInstallPath && (
            <Button variant="ghost" onClick={() => void handleClear()} className="text-xs px-3 py-1.5">
              Clear
            </Button>
          )}
        </div>
        {pickError && <p className="text-xs text-rose-400">{pickError}</p>}
        {detectError && <p className="text-xs text-rose-400">{detectError}</p>}
        {candidates !== null && candidates.length > 0 && (
          <ul className="rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
            {candidates.map((c) => (
              <li key={c.gameLogPath}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors"
                  onClick={() => void handleSelectCandidate(c)}
                >
                  <span className="block text-xs text-brand-300 font-medium">
                    {c.branch} <span className="text-slate-500">({c.source})</span>
                  </span>
                  <span className="block text-xs text-slate-400 break-all">{c.gameLogPath}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-200">Ship Link status</h3>
        <p className={`text-xs ${statusLine.tone}`}>{statusLine.text}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. (`window.hailfreq.onScLogLine` / `onScTailerReplaced` / `invoke("sc:watchStatus")` all resolve against the preload API + IPC map.)

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/settings/ScGameLogSettings.tsx
git commit -m "feat(sc): ScGameLogSettings section component"
```

---

### Task 5: Wire the section into AppState → Sidebar → SettingsMenu

Add the persistence handler + derived enabled-server names in AppState, thread them through Sidebar, and render the new "Star Citizen" section in the Settings menu.

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (add `handleChangeScInstallPath`; pass `enabledServerNames` + handler to `<Sidebar>`)
- Modify: `client/src/renderer/components/Sidebar.tsx` (accept + forward the two new props to `<SettingsMenu>`)
- Modify: `client/src/renderer/screens/SettingsMenu.tsx` (new `"sc"` section + props)

- [ ] **Step 1: Add `handleChangeScInstallPath` in AppState**

In `client/src/renderer/AppState.tsx`, immediately after the `handleChangeAudioDevices` useCallback (ends at line ~1043), add:

```tsx
  /**
   * Save the global Game.log path from ⚙ Settings → Star Citizen. Persists to
   * settings then updates state; the existing watcher effect (keyed on
   * state.scInstallPath) starts/stops/replaces the tailer automatically.
   */
  const handleChangeScInstallPath = useCallback(
    async (path: string | undefined): Promise<void> => {
      await window.hailfreq.invoke("settings:setScInstallPath", { path });
      setState((prev) => ({ ...prev, scInstallPath: path }));
    },
    [],
  );
```

- [ ] **Step 2: Pass new props to `<Sidebar>`**

In `client/src/renderer/AppState.tsx`, in the `<Sidebar ... />` JSX (around lines 1133–1153), add two props after `onChangeAudioDevices={handleChangeAudioDevices}`:

```tsx
        onChangeAudioDevices={handleChangeAudioDevices}
        enabledServerNames={Array.from(state.servers.values())
          .filter((s) => s.entry.scIntegration?.enabled)
          .map((s) => s.entry.label)}
        onChangeScInstallPath={handleChangeScInstallPath}
```

- [ ] **Step 3: Add the new props to `SidebarProps`**

In `client/src/renderer/components/Sidebar.tsx`, in the `SidebarProps` interface, after `onChangeAudioDevices?: (...)` (line ~37), add:

```tsx
  onChangeAudioDevices?: (d: { inputDeviceId?: string; outputDeviceId?: string }) => void;
  /** Display names of servers with Ship Link enabled (for the SC settings status line). */
  enabledServerNames?: string[];
  /** Persist the global Game.log path from the SC settings section. */
  onChangeScInstallPath?: (path: string | undefined) => Promise<void> | void;
```

- [ ] **Step 4: Destructure the new props**

In `client/src/renderer/components/Sidebar.tsx`, in the `export function Sidebar({ ... })` destructuring (ends ~line 56), add after `onChangeAudioDevices,`:

```tsx
  onChangeAudioDevices,
  enabledServerNames,
  onChangeScInstallPath,
```

- [ ] **Step 5: Forward them to `<SettingsMenu>`**

In `client/src/renderer/components/Sidebar.tsx`, in the `{settingsOpen && onSaveFocusedAppPtt && ( <SettingsMenu ... /> )}` block (lines ~180–188), add two props:

```tsx
        <SettingsMenu
          inputDeviceId={inputDeviceId}
          outputDeviceId={outputDeviceId}
          onChangeAudioDevices={onChangeAudioDevices ?? (() => {})}
          enabledServerNames={enabledServerNames ?? []}
          onChangeScInstallPath={onChangeScInstallPath ?? (() => {})}
          scInstallPath={scInstallPath}
          focusedAppPtt={focusedAppPtt}
          onSaveFocusedAppPtt={onSaveFocusedAppPtt}
          onClose={() => setSettingsOpen(false)}
        />
```

(`scInstallPath` is already a Sidebar prop in scope.)

- [ ] **Step 6: Add the `"sc"` section to `SettingsMenu`**

In `client/src/renderer/screens/SettingsMenu.tsx`, make these four edits:

(a) Add the import after the `FocusedAppPttSettingsContent` import (line 4):

```tsx
import { FocusedAppPttSettingsContent } from "./FocusedAppPttSettings";
import { ScGameLogSettings } from "./settings/ScGameLogSettings";
```

(b) Extend the `Section` union (line 6):

```tsx
type Section = "audio" | "ptt" | "sc";
```

(c) Add the three new props to `Props` (after `onChangeAudioDevices`, line 11):

```tsx
  onChangeAudioDevices: (devices: { inputDeviceId?: string; outputDeviceId?: string }) => void;
  scInstallPath?: string;
  enabledServerNames: string[];
  onChangeScInstallPath: (path: string | undefined) => Promise<void> | void;
```

(d) Add the nav entry and the title + content rendering. Replace the nav list array (line 24) to include the new section:

```tsx
          {([["audio", "Audio devices"], ["ptt", "PTT focus"], ["sc", "Star Citizen"]] as [Section, string][]).map(([id, label]) => (
```

Replace the header title expression (line 33):

```tsx
            <h2 className="text-base font-semibold text-slate-100">{section === "audio" ? "Audio devices" : section === "ptt" ? "PTT focus" : "Star Citizen"}</h2>
```

And add the new section body after the `{section === "ptt" && (...)}` block (after line 46):

```tsx
            {section === "sc" && (
              <ScGameLogSettings
                scInstallPath={props.scInstallPath}
                enabledServerNames={props.enabledServerNames}
                onChange={props.onChangeScInstallPath}
              />
            )}
```

- [ ] **Step 7: Verify typecheck + existing tests**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; all existing tests still pass (incl. Tasks 1–2 + the prior suite).

- [ ] **Step 8: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/screens/SettingsMenu.tsx
git commit -m "feat(sc): wire Star Citizen Game.log section into the Settings menu"
```

---

### Task 6: Remove the path UI from the per-server SC modal

The Game.log path now lives in ⚙ Settings. Strip the path sub-form (input, Browse, Auto-detect, validation, candidates) out of `ScIntegrationSettings`, replace it with a hint, and drop `scInstallPath` from its save patch — then update the `onSave` type everywhere it's threaded.

**Files:**
- Modify: `client/src/renderer/screens/ScIntegrationSettings.tsx`
- Modify: `client/src/renderer/components/Sidebar.tsx` (`onSaveScIntegration` patch type)
- Modify: `client/src/renderer/AppState.tsx` (`handleSaveScIntegration` no longer persists `scInstallPath`)

- [ ] **Step 1: Rewrite `ScIntegrationSettings.tsx` (full file)**

Replace the ENTIRE contents of `client/src/renderer/screens/ScIntegrationSettings.tsx` with the following. This drops the path input / Browse / Auto-detect / validation / candidates and their state, effects, handlers, and the `useEffect`/`useRef`/`Input`/`ScInstallCandidate` imports; adds the global-settings hint; replaces the path-error display with a `saveError` line; and narrows `onSave` to `{ scIntegration }`:

```tsx
import { useState } from "react";
import type { ScIntegrationSettings as ScIntegrationSettingsType } from "@shared/types";
import { Button } from "../components/Button";

interface Props {
  serverId: string;
  /** Current per-server SC integration settings (may be undefined if never set). */
  scIntegration?: ScIntegrationSettingsType;
  onSave: (patch: { scIntegration: ScIntegrationSettingsType }) => Promise<void>;
  onClose: () => void;
}

const DEFAULT_SC_INTEGRATION: ScIntegrationSettingsType = {
  enabled: false,
  autoInviteAllowlist: [],
  autoCloseOnDestruction: true,
};

export function ScIntegrationSettings({ scIntegration, onSave, onClose }: Props) {
  const [enabled, setEnabled] = useState(scIntegration?.enabled ?? DEFAULT_SC_INTEGRATION.enabled);
  const [allowlist, setAllowlist] = useState<string[]>(
    scIntegration?.autoInviteAllowlist ?? DEFAULT_SC_INTEGRATION.autoInviteAllowlist,
  );
  const [autoClose, setAutoClose] = useState(
    scIntegration?.autoCloseOnDestruction ?? DEFAULT_SC_INTEGRATION.autoCloseOnDestruction,
  );
  const [allowlistInput, setAllowlistInput] = useState("");
  const [allowlistError, setAllowlistError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setSaving] = useState(false);

  function handleAddToAllowlist() {
    const handle = allowlistInput.trim();
    if (!handle) {
      setAllowlistError("Handle cannot be empty");
      return;
    }
    const lower = handle.toLowerCase();
    const duplicate = allowlist.some((h) => h.toLowerCase() === lower);
    if (duplicate) {
      setAllowlistError("This handle is already in the list");
      return;
    }
    setAllowlist((prev) => [...prev, handle]);
    setAllowlistInput("");
    setAllowlistError("");
  }

  function handleRemoveFromAllowlist(handle: string) {
    setAllowlist((prev) => prev.filter((h) => h !== handle));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave({
        scIntegration: {
          enabled,
          autoInviteAllowlist: allowlist,
          autoCloseOnDestruction: autoClose,
        },
      });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex w-[30rem] max-h-[90vh] flex-col rounded-lg border border-slate-800 bg-slate-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold text-brand-400">Star Citizen Integration</h2>
          <p className="mt-1 text-xs text-slate-500">Per-server settings</p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Section 1: Enable toggle */}
          <section>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="text-sm text-slate-200">Watch Game.log for this server</span>
            </label>
            {enabled && (
              <p className="mt-2 ml-6 text-xs text-amber-400">
                The watcher only runs once a valid Game.log path is set in ⚙ Settings → Star Citizen.
              </p>
            )}
          </section>

          {/* Section 2: Game.log path now lives in global Settings */}
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Game.log path</p>
            <p className="text-xs text-slate-400">
              The Game.log path is set in ⚙ Settings → Star Citizen (it&apos;s shared across all your servers).
            </p>
          </section>

          {/* Section 3: Allowlist */}
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Auto-invite allowlist
            </p>
            <p className="mb-3 text-xs text-slate-400">
              RSI handles added here are auto-invited without a confirmation prompt when they board your ship.
            </p>
            {allowlist.length > 0 ? (
              <ul className="mb-3 rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
                {allowlist.map((handle) => (
                  <li key={handle} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-slate-200">{handle}</span>
                    <button
                      className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                      onClick={() => handleRemoveFromAllowlist(handle)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-slate-500 italic">No handles in the allowlist.</p>
            )}
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                placeholder="RSI handle"
                value={allowlistInput}
                onChange={(e) => {
                  setAllowlistInput(e.target.value);
                  setAllowlistError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddToAllowlist();
                  }
                }}
              />
              <Button variant="ghost" onClick={handleAddToAllowlist} className="shrink-0 text-sm">
                Add
              </Button>
            </div>
            {allowlistError && (
              <p className="mt-1 text-xs text-rose-400">{allowlistError}</p>
            )}
          </section>

          {/* Section 4: Auto-close toggle */}
          <section>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoClose}
                onChange={(e) => setAutoClose(e.target.checked)}
              />
              <span className="text-sm text-slate-200">Auto-close ship-net on destruction</span>
            </label>
            <p className="mt-1 ml-6 text-xs text-slate-500">
              Automatically leaves the ship net when Game.log reports your ship was destroyed.
            </p>
          </section>

          {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-800 p-4">
          <Button onClick={() => void handleSave()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the `onSaveScIntegration` type in Sidebar**

In `client/src/renderer/components/Sidebar.tsx`, change the `onSaveScIntegration` prop type (lines 24–26) to drop `scInstallPath`:

```tsx
  onSaveScIntegration?: (
    serverId: string,
    patch: { scIntegration: ScIntegrationSettings },
  ) => Promise<void>;
```

The existing `<ScIntegrationSettingsPanel ... />` render (lines 172–177) must drop the `scInstallPath={scInstallPath}` prop (the panel no longer accepts it):

```tsx
        <ScIntegrationSettingsPanel
          serverId={scIntegrationFor.id}
          scIntegration={scIntegrationFor.scIntegration}
          onSave={(patch) => onSaveScIntegration(scIntegrationFor.id, patch)}
          onClose={() => setScIntegrationFor(null)}
        />
```

(`scInstallPath` remains a Sidebar prop — it's still used by the new Settings section in Task 5.)

- [ ] **Step 4: Update `handleSaveScIntegration` in AppState**

In `client/src/renderer/AppState.tsx`, replace the `handleSaveScIntegration` useCallback (lines ~1067–1089) with a version that only persists per-server settings:

```tsx
  const handleSaveScIntegration = useCallback(
    async (serverId: string, patch: { scIntegration: ScIntegrationSettings }) => {
      await window.hailfreq.invoke("servers:update", {
        serverId,
        patch: { scIntegration: patch.scIntegration },
      });
      setState((s) => {
        const existing = s.servers.get(serverId);
        if (!existing) return s;
        return patchServer(s, serverId, {
          entry: { ...existing.entry, scIntegration: patch.scIntegration },
        });
      });
    },
    [],
  );
```

- [ ] **Step 5: Verify typecheck + full test suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0 (no unused-import or type errors); all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/ScIntegrationSettings.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/AppState.tsx
git commit -m "refactor(sc): move Game.log path out of per-server modal into Settings"
```

---

## Final verification (after all tasks)

- [ ] `cd client && npx tsc --noEmit` — exit 0.
- [ ] `cd client && npx vitest run` — all tests pass (prior suite + `scWatchStatus` + `scLogTail`).
- [ ] **Manual smoke (user-run — live SC/audio path):**
  - Open ⚙ Settings → **Star Citizen**. With no path: status reads "No Game.log selected."
  - **Browse…** to a real `Game.log` (or **Auto-detect** → pick a candidate); path appears + "Path looks valid."
  - With no server enabled: status reads "Path set, but Ship Link isn't enabled on any server."
  - Enable Ship Link on a server (right-click server → Star Citizen Integration → check the box → Save). The modal now shows only the enable/allowlist/auto-close controls and a "set the path in ⚙ Settings" hint.
  - Back in ⚙ Settings → Star Citizen: status flips to "Watching ✓"; with the game writing to Game.log, "last activity" updates.
  - **Clear** → tailer stops, status returns to "No Game.log selected."
