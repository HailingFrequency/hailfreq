# Hailfreq Focused-App PTT Implementation Plan (Plan 8a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the global PTT key on the OS-level focused window matching a user-defined allowlist (process name or window title substring), so the PTT key only fires when the configured app — typically Star Citizen — is the user's actually-active window. When focus is on a different app (browser, chat, terminal), the PTT key press is a no-op and the user's input goes to that app instead of opening the radio.

**Architecture:** A main-process polling probe (`active-win` library, 500ms interval) caches the currently focused OS window's process name + title. The PttController in the renderer reads the cache over IPC at key-press time and decides whether to dispatch the press to the per-net PTT handlers. Key-release always fires so the mic never gets stuck open if focus changes mid-press. Pure decision logic lives in a small testable function (`focusGate.ts`) separate from the IPC/UI plumbing.

**Tech Stack:** Same as Plans 1–7 (Electron + React + TypeScript). New dependency: `active-win` (cross-platform OS-level focused window detection — Windows + macOS + Linux X11; Wayland returns null and the gate fails-open with a UI warning).

**Spec reference:** Beyond original spec — this is operator-requested polish to fix the "my PTT fires while typing in chat" annoyance that all-the-time global key listeners cause. Sits alongside the existing per-net PTT modes (toggle/hold/voice) and the keybind capture UI from Plan 4.

**Out of scope:**
- macOS support (Hailfreq doesn't ship macOS installers per the spec; `active-win` works there but we won't test it)
- Window-title regex matching — only substring matching for v1
- Per-server focus rules — focus gate is a global setting like the existing PTT keybind
- Automatic process-name suggestions (we expose a debug "show current focus" button so users can read off the name themselves)

**Privacy / opt-in:**
- Default: disabled. Existing PTT behavior unchanged for users who don't enable.
- When enabled, the focus probe runs in the main process and the cached process name + title never leave the local machine
- Wayland fail-open is documented in the settings panel as a known limitation

**Repo location:** `/home/shreen/code/tactical-radio`. Commits go to `master` per the established workflow across Plans 1–7.

---

## Task 1: Add `active-win` dependency + main-process focus probe

**Files:**
- Modify: `client/package.json`
- Create: `client/src/main/windowFocus.ts`

`active-win` is a mature cross-platform library that returns the currently focused window's process name, title, and owner info. On Linux X11 it shells out to `xprop` + `xdotool`. On Windows it uses a tiny native binary. On Wayland it has no API and throws, which we treat as "fail-open" by returning `null`.

The probe polls every 500ms (active-win is cheap — single syscall on Win/Mac, ~3ms subprocess on X11). The cache is read synchronously by the IPC handler in Task 2.

- [ ] **Step 1: Add dependency**

```bash
cd /home/shreen/code/tactical-radio/client
npm install active-win@8.2.0
```

Pin to 8.2.0 — version 9.x dropped CommonJS support and Electron's main process is CommonJS in this codebase.

- [ ] **Step 2: Write `client/src/main/windowFocus.ts`**

```ts
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
    const mod = await import("active-win");
    const result = await mod.default();
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
```

- [ ] **Step 3: Start the probe on app ready**

Modify `client/src/main/main.ts` (or wherever the app's main process initializes — look for `app.whenReady().then(...)` or the existing IPC registration). Add:

```ts
import { startFocusProbe, stopFocusProbe } from "./windowFocus";

// Inside the app.whenReady block, after other initializers:
startFocusProbe();

// In app.on("before-quit") or app.on("window-all-closed") handler:
stopFocusProbe();
```

If the existing main entry has a clear initialization function (e.g., `registerIpcHandlers()` or `bootstrap()`), invoke `startFocusProbe()` from there to keep main.ts tidy.

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

Expected: clean build. The `active-win` package may show a one-time install message about pulling a native helper — that's normal.

```bash
cd /home/shreen/code/tactical-radio
git add client/package.json client/package-lock.json client/src/main/windowFocus.ts client/src/main/main.ts
git commit -m "client(focus): main-process focused-window probe via active-win"
```

(Replace `main.ts` with the actual file name if different in this codebase.)

---

## Task 2: IPC channel `focus:get`

**Files:**
- Modify: `client/src/shared/ipc.ts`
- Modify: `client/src/main/ipc.ts`

A synchronous-from-renderer's-perspective IPC call that returns the cached `FocusedAppInfo`. No new async work — the handler just reads the cache populated by Task 1's probe.

- [ ] **Step 1: Add channel to `shared/ipc.ts`**

Locate the `IpcChannels` interface. Add a new entry:

```ts
"focus:get": { args: []; result: FocusedAppInfo };
```

Add the import for `FocusedAppInfo`:

```ts
import type { FocusedAppInfo } from "@main/windowFocus";
// OR if there's no @main alias, use the relative path:
// import type { FocusedAppInfo } from "../main/windowFocus";
```

**Layering note:** `shared/` importing from `main/` is normally a violation. Move the `FocusedAppInfo` interface definition into `shared/ipc.ts` and re-export it from `windowFocus.ts` instead — the same pattern Task 1 of Plan 7 used for `ScInstallCandidate`. Specifically:

In `shared/ipc.ts`, add:

```ts
export interface FocusedAppInfo {
  processName: string | null;
  title: string | null;
  isWayland: boolean;
}
```

Then in `client/src/main/windowFocus.ts`, replace the local interface declaration with:

```ts
import type { FocusedAppInfo } from "@shared/ipc";
export type { FocusedAppInfo };
```

(or relative import if `@shared` isn't aliased — match the convention used by other files in `main/`).

- [ ] **Step 2: Register the handler in `main/ipc.ts`**

```ts
import { getFocusedApp } from "./windowFocus";

// In the handler registration block:
ipcMain.handle("focus:get", (): FocusedAppInfo => {
  return getFocusedApp();
});
```

No validation needed — it takes no arguments and returns a snapshot of the local cache.

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/windowFocus.ts client/src/main/ipc.ts client/src/shared/ipc.ts
git commit -m "client(focus): IPC channel focus:get returns cached focused-app info"
```

---

## Task 3: Settings shape extension

**Files:**
- Modify: `client/src/shared/types.ts`
- Modify: `client/src/main/store.ts`

The focused-app PTT config is a GLOBAL setting (not per-server), because the PTT key binding itself is global. Stored alongside the existing global voice settings.

The shape:

```ts
focusedAppPtt: {
  enabled: boolean;
  // Case-insensitive substring matches against (processName + " " + title).
  // Example entries: "StarCitizen", "Hailfreq", "Element"
  allowlistEntries: string[];
}
```

Default: `{ enabled: false, allowlistEntries: ["StarCitizen"] }`. The default "StarCitizen" matches both Windows-native (`StarCitizen.exe`) and Wine prefix (`StarCitizen.exe` or sometimes `wine64-preloader` with a "Star Citizen" window title).

- [ ] **Step 1: Extend `Settings` interface in `shared/types.ts`**

Find the `Settings` interface and add the new optional field:

```ts
export interface FocusedAppPttSettings {
  enabled: boolean;
  allowlistEntries: string[];
}

export interface Settings {
  // ... existing fields ...
  focusedAppPtt?: FocusedAppPttSettings;
}
```

- [ ] **Step 2: Add the default in store.ts**

Find the existing `defaults` object passed to `new Store<Settings>(...)`. Add:

```ts
focusedAppPtt: { enabled: false, allowlistEntries: ["StarCitizen"] },
```

If `focusedAppPtt` is omitted from the defaults block (because the field is optional), legacy stores will simply have it absent. The renderer reads it as `settings.focusedAppPtt ?? { enabled: false, allowlistEntries: ["StarCitizen"] }`. Either approach is fine; including the default explicitly in `defaults` is preferred so the very first launch already has the field present.

- [ ] **Step 3: Preserve through migration**

In `migrateLegacyShape`, the field is at the top level of `Settings` (not per-server like `scIntegration`). The Task 1-of-Plan-7 fix (`settings.store = migrated`) already preserves any unknown top-level keys, so the migration will pass `focusedAppPtt` through. No code change needed in the legacy V1 branch other than confirming the pass-through branch doesn't strip it.

Double-check: in the legacy V1 → V2 conversion, the new V2 object should include `focusedAppPtt`:

```ts
// In the legacy branch:
return {
  servers: [...],
  activeServerId: ...,
  ui: typed.ui ?? { theme: "dark" },
  focusedAppPtt: typeof typed.focusedAppPtt === "object" && typed.focusedAppPtt !== null
    ? typed.focusedAppPtt as FocusedAppPttSettings
    : { enabled: false, allowlistEntries: ["StarCitizen"] },
};
```

Apply the same conditional preservation pattern that Plan 7 Task 1 used for `scInstallPath`.

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/main/store.ts
git commit -m "client(focus): focusedAppPtt settings field with sensible defaults"
```

---

## Task 4: Pure focus-gate decision function + unit tests

**Files:**
- Create: `client/src/renderer/voice/focusGate.ts`
- Create: `client/tests/unit/focusGate.test.ts`

The decision logic is a small pure function: given the cached focus info and the allowlist, return `true` if PTT should fire. Easy to unit-test, easy to reason about. Lives in `voice/` because that's where the PTT controller lives.

- [ ] **Step 1: Write the failing tests**

Create `client/tests/unit/focusGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldGatePass, type FocusGateInput } from "@/renderer/voice/focusGate";

const baseFocus = { processName: null as string | null, title: null as string | null, isWayland: false };

function input(overrides: Partial<FocusGateInput["focus"]> & Partial<Pick<FocusGateInput, "allowlist">>): FocusGateInput {
  const { allowlist, ...focusOverrides } = overrides;
  return {
    focus: { ...baseFocus, ...focusOverrides },
    allowlist: allowlist ?? [],
  };
}

describe("shouldGatePass", () => {
  it("passes (fail-open) on Wayland regardless of allowlist", () => {
    expect(shouldGatePass(input({ isWayland: true, allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("passes (fail-open) when focus probe has no data", () => {
    expect(shouldGatePass(input({ processName: null, title: null, allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("passes when allowlist is empty (gate effectively disabled)", () => {
    expect(shouldGatePass(input({ processName: "FirefoxNightly.exe", allowlist: [] }))).toBe(true);
  });

  it("passes when process name contains an allowlist entry (case-insensitive)", () => {
    expect(shouldGatePass(input({ processName: "StarCitizen.exe", allowlist: ["starcitizen"] }))).toBe(true);
  });

  it("passes when window title contains an allowlist entry (case-insensitive)", () => {
    expect(shouldGatePass(input({ processName: "wine64-preloader", title: "Star Citizen", allowlist: ["StarCitizen"] }))).toBe(true);
  });

  it("blocks when neither process name nor title matches any allowlist entry", () => {
    expect(shouldGatePass(input({ processName: "firefox.exe", title: "Inbox", allowlist: ["StarCitizen"] }))).toBe(false);
  });

  it("passes when any single allowlist entry matches", () => {
    expect(
      shouldGatePass(
        input({ processName: "elementx.exe", allowlist: ["StarCitizen", "ElementX"] }),
      ),
    ).toBe(true);
  });

  it("ignores empty allowlist entries when matching", () => {
    expect(shouldGatePass(input({ processName: "firefox.exe", allowlist: ["", "  "] }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run tests/unit/focusGate.test.ts 2>&1 | tail -8
```

Expected: 8 tests fail with "Cannot find module" — the implementation doesn't exist yet.

- [ ] **Step 3: Write `client/src/renderer/voice/focusGate.ts`**

```ts
import type { FocusedAppInfo } from "@shared/ipc";

export interface FocusGateInput {
  focus: FocusedAppInfo;
  allowlist: string[];
}

/**
 * Decide whether the global PTT key press should be dispatched, given the
 * current OS-level focused window and the user's configured allowlist.
 *
 * Fail-open semantics:
 *   - Wayland (no focus data available) → pass
 *   - focus probe returned no data       → pass
 *   - allowlist empty                    → pass (gate effectively disabled)
 *
 * Match semantics:
 *   - Case-insensitive substring match against (processName + " " + title)
 *   - Empty / whitespace-only allowlist entries are ignored
 */
export function shouldGatePass({ focus, allowlist }: FocusGateInput): boolean {
  if (focus.isWayland) return true;
  if (focus.processName === null && focus.title === null) return true;

  const cleanedAllowlist = allowlist.map((e) => e.trim()).filter((e) => e.length > 0);
  if (cleanedAllowlist.length === 0) return true;

  const haystack = `${focus.processName ?? ""} ${focus.title ?? ""}`.toLowerCase();
  return cleanedAllowlist.some((entry) => haystack.includes(entry.toLowerCase()));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run tests/unit/focusGate.test.ts 2>&1 | tail -8
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/focusGate.ts client/tests/unit/focusGate.test.ts
git commit -m "client(focus): pure shouldGatePass decision function + 8 unit tests"
```

---

## Task 5: Wire the gate into PttController

**Files:**
- Modify: `client/src/renderer/voice/PttController.ts`

The PttController already receives global key events from `node-global-key-listener` (set up in Plan 4). It dispatches them to per-net handlers based on the per-net PTT mode (toggle / hold / voice). The focus gate runs BEFORE that dispatch on key-PRESS only.

Key-release is always dispatched so the mic never gets stuck open. Voice activation mode is unaffected (no key involved).

The gate config (enabled flag + allowlist) is read from a `Settings` snapshot that the renderer already has access to. The focus snapshot is fetched via the IPC channel from Task 2.

- [ ] **Step 1: Read the existing PttController.ts**

Read the file end-to-end to understand the existing key dispatch structure. Specifically look for:
- Where the key-press event is received
- The signature of the handler
- How settings are currently passed in (constructor arg, observer pattern, prop?)
- Whether the controller is async or sync

The implementation depends on the existing pattern. The plan below assumes a constructor that takes a settings-source callback, but if the controller has a different shape, adapt to match.

- [ ] **Step 2: Modify PttController to accept a focus-gate config provider**

Add a constructor argument or property:

```ts
export interface PttFocusGateConfig {
  enabled: boolean;
  allowlist: string[];
}

// Inside the PttController class:
private getFocusGateConfig: () => PttFocusGateConfig = () => ({ enabled: false, allowlist: [] });

setFocusGateConfig(provider: () => PttFocusGateConfig): void {
  this.getFocusGateConfig = provider;
}
```

The provider pattern is preferred over a static config because it lets `AppState` flow settings updates to the controller without re-instantiating.

- [ ] **Step 3: Apply the gate to key-press events**

Find the key-press handler (probably named like `onKeyDown` or `handlePress`). Wrap the body:

```ts
import { shouldGatePass } from "./focusGate";

// In the key-press handler:
const config = this.getFocusGateConfig();
if (config.enabled) {
  const focus = await window.hailfreq.invoke("focus:get");
  if (!shouldGatePass({ focus, allowlist: config.allowlist })) {
    // Gate blocked — do not dispatch to per-net handlers
    return;
  }
}
// existing dispatch logic continues here
```

If the existing key-press handler is sync, make it async or use `.then()`. Since active-win polling is already async, the IPC round-trip is the only addition; ~1ms latency is below human perception for PTT.

- [ ] **Step 4: Wire the config provider from AppState**

In `client/src/renderer/AppState.tsx`, find where the PttController is instantiated (or where its settings change). Add:

```ts
// After pttController is created OR in a useEffect that runs when settings change:
pttController.setFocusGateConfig(() => ({
  enabled: stateRef.current.settings.focusedAppPtt?.enabled ?? false,
  allowlist: stateRef.current.settings.focusedAppPtt?.allowlistEntries ?? [],
}));
```

If `AppState` doesn't have a `stateRef`, use whatever pattern it uses for accessing live state from non-render contexts (e.g., closing over the `setState` callback, or capturing `settings` in a ref).

- [ ] **Step 5: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/PttController.ts client/src/renderer/AppState.tsx
git commit -m "client(focus): gate PttController key-press on focused-app allowlist (release always fires)"
```

---

## Task 6: Settings UI — Focused-app PTT section

**Files:**
- Modify: existing voice/PTT settings panel (likely `client/src/renderer/screens/VoiceSettings.tsx` — verify location)
- Possibly modify: `client/src/renderer/AppState.tsx` (if a new save handler is needed)

Add a section to the existing voice/PTT settings panel with:
1. Enable toggle
2. Allowlist editor (add/remove substrings)
3. "Show current focus" debug button — calls `focus:get` and displays the result so the user can see what to type
4. Wayland warning banner if `focus.isWayland === true`

- [ ] **Step 1: Read the existing settings panel**

Find where the existing PTT keybind capture or voice activation threshold UI lives. Look in `client/src/renderer/screens/` for `VoiceSettings.tsx`, `Settings.tsx`, or similar. The new "Focused-app PTT" section goes adjacent to the existing PTT settings.

If the existing panel is split into multiple settings files (e.g., per-server vs global), put this in the GLOBAL one because focused-app PTT is a global setting.

- [ ] **Step 2: Add the section UI**

Pattern (adapt classes/components to the existing codebase):

```tsx
import { useState, useEffect } from "react";
import type { FocusedAppInfo } from "@shared/ipc";

// Inside the settings component:

const focusedAppPtt = settings.focusedAppPtt ?? { enabled: false, allowlistEntries: ["StarCitizen"] };
const [allowlistDraft, setAllowlistDraft] = useState<string[]>(focusedAppPtt.allowlistEntries);
const [enabledDraft, setEnabledDraft] = useState<boolean>(focusedAppPtt.enabled);
const [entryInput, setEntryInput] = useState("");
const [currentFocus, setCurrentFocus] = useState<FocusedAppInfo | null>(null);

async function refreshCurrentFocus() {
  const focus = await window.hailfreq.invoke("focus:get");
  setCurrentFocus(focus);
}

function addEntry() {
  const trimmed = entryInput.trim();
  if (!trimmed) return;
  if (allowlistDraft.some((e) => e.toLowerCase() === trimmed.toLowerCase())) {
    setEntryInput("");
    return;
  }
  setAllowlistDraft([...allowlistDraft, trimmed]);
  setEntryInput("");
}

function removeEntry(entry: string) {
  setAllowlistDraft(allowlistDraft.filter((e) => e !== entry));
}

async function handleSave() {
  await window.hailfreq.invoke("settings:setFocusedAppPtt", {
    focusedAppPtt: { enabled: enabledDraft, allowlistEntries: allowlistDraft },
  });
  // Trigger a settings refresh in AppState (use the same pattern as other settings saves)
  onSettingsChanged?.();
}

// Render:
<section className="space-y-3">
  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
    Focused-app PTT
  </h3>
  <p className="text-xs text-slate-500">
    Only fire the PTT key when one of these apps has window focus. Leave disabled to keep
    the global "PTT works everywhere" behavior. Match is a case-insensitive substring on
    the focused window's process name + title.
  </p>

  {currentFocus?.isWayland && (
    <div className="rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-200">
      Wayland has no portable focused-window API. Focus gating is disabled on this session;
      the PTT key will fire as if always permitted. X11 sessions work normally.
    </div>
  )}

  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={enabledDraft}
      onChange={(e) => setEnabledDraft(e.target.checked)}
    />
    Enable focus gating
  </label>

  <div className="space-y-2">
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
      Allowlist (process name or window title substrings)
    </p>
    {allowlistDraft.map((entry) => (
      <div key={entry} className="flex items-center gap-2">
        <span className="flex-1 text-sm">{entry}</span>
        <button
          className="text-xs text-rose-300 hover:text-rose-200"
          onClick={() => removeEntry(entry)}
        >
          Remove
        </button>
      </div>
    ))}
    <div className="flex gap-2">
      <input
        type="text"
        value={entryInput}
        onChange={(e) => setEntryInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") addEntry(); }}
        placeholder="e.g. StarCitizen"
        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
      />
      <button onClick={addEntry} className="text-sm text-brand-300 hover:text-brand-200">
        Add
      </button>
    </div>
  </div>

  <div className="space-y-1">
    <button
      onClick={refreshCurrentFocus}
      className="text-xs text-slate-400 hover:text-slate-200 underline"
    >
      Show current focus
    </button>
    {currentFocus && (
      <p className="text-xs text-slate-500">
        Process: <code>{currentFocus.processName ?? "(none)"}</code><br />
        Title: <code>{currentFocus.title ?? "(none)"}</code>
      </p>
    )}
  </div>

  <div className="flex gap-2">
    <button onClick={handleSave} className="rounded bg-brand-600 px-3 py-1 text-sm">
      Save
    </button>
  </div>
</section>
```

If the existing settings panel uses a different Button component or layout primitives, adapt — the structure above is the logical content, not necessarily the exact JSX.

- [ ] **Step 3: Add the `settings:setFocusedAppPtt` IPC channel**

In `client/src/shared/ipc.ts`:

```ts
"settings:setFocusedAppPtt": { args: [{ focusedAppPtt: FocusedAppPttSettings }]; result: void };
```

Add the `FocusedAppPttSettings` import from `shared/types.ts` if not already imported.

In `client/src/main/ipc.ts`:

```ts
ipcMain.handle("settings:setFocusedAppPtt", (_event, args: unknown): void => {
  if (args === null || typeof args !== "object" || !("focusedAppPtt" in args)) {
    throw new Error("settings:setFocusedAppPtt: args must be { focusedAppPtt: FocusedAppPttSettings }");
  }
  const { focusedAppPtt } = args as { focusedAppPtt: unknown };
  if (
    focusedAppPtt === null ||
    typeof focusedAppPtt !== "object" ||
    typeof (focusedAppPtt as FocusedAppPttSettings).enabled !== "boolean" ||
    !Array.isArray((focusedAppPtt as FocusedAppPttSettings).allowlistEntries)
  ) {
    throw new Error("settings:setFocusedAppPtt: focusedAppPtt must have boolean enabled + string[] allowlistEntries");
  }
  const list = (focusedAppPtt as FocusedAppPttSettings).allowlistEntries;
  if (!list.every((e) => typeof e === "string")) {
    throw new Error("settings:setFocusedAppPtt: allowlistEntries must contain only strings");
  }
  settings.set("focusedAppPtt", focusedAppPtt as FocusedAppPttSettings);
});
```

Apply the same runtime validation pattern Plan 7 Task 10 established.

- [ ] **Step 4: Wire save into AppState**

When `settings:setFocusedAppPtt` succeeds, AppState should update its in-memory `settings` so the PttController's config provider (Task 5) sees the new values. Pattern:

```ts
// In AppState, when the settings panel triggers a save:
async function handleSaveFocusedAppPtt(value: FocusedAppPttSettings): Promise<void> {
  await window.hailfreq.invoke("settings:setFocusedAppPtt", { focusedAppPtt: value });
  setState((prev) => ({ ...prev, settings: { ...prev.settings, focusedAppPtt: value } }));
}
```

Pass `handleSaveFocusedAppPtt` to the settings panel as a prop.

- [ ] **Step 5: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/ client/src/renderer/AppState.tsx client/src/main/ipc.ts client/src/shared/ipc.ts
git commit -m "client(focus): focused-app PTT settings section with allowlist editor + current-focus debug"
```

---

## Task 7: Build installers + smoke test

**Files:** none (build artifacts only)

- [ ] **Step 1: Run linux + windows installer builds**

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
```

Expected: both succeed. `active-win` includes a native helper binary on Windows (small, ~30KB) and an X11 utility shim on Linux. electron-builder should bundle them automatically.

- [ ] **Step 2: List the output**

```bash
ls -lh /home/shreen/code/tactical-radio/client/release/Hailfreq-*
```

Expected: AppImage + .exe + .blockmap files. Sizes within ~5MB of the Plan 7 installers.

- [ ] **Step 3: Smoke-test the focus probe (manual)**

Skip this in CI/agentic runs, but document for human verification:

1. Launch the Linux AppImage on an X11 desktop session
2. Open the Voice Settings panel
3. Click "Show current focus" — should display the Hailfreq window's process name (typically `Hailfreq`)
4. Alt-tab to another window (browser, terminal)
5. Wait 1 second for the cache to update
6. Click "Show current focus" again — should display the new app's name

On Wayland sessions, the Wayland banner should appear with the warning text.

No commit unless something broke.

---

## Task 8: README + spec note

**Files:**
- Modify: `client/README.md`
- Modify: `docs/superpowers/specs/2026-05-26-hailfreq-design.md`

- [ ] **Step 1: Add to client/README.md**

Find the bullet list of features (under the heading near the top). Add a new bullet at the end of the existing list:

```markdown
- Focused-app PTT — gate the global PTT key on a chosen app (e.g., Star Citizen) having window focus, so the key passes through to chat / browser / terminal when the game isn't active
```

- [ ] **Step 2: Add to the spec**

In `docs/superpowers/specs/2026-05-26-hailfreq-design.md`, append a new section after §13 (Star Citizen Game.log Integration):

```markdown
## 14. Focused-app PTT (Hailfreq extension, beyond original spec)

Implemented in Plan 8a. Adds an OS-level "focus gate" to the global PTT key handler so the key only fires when a user-chosen app (typically Star Citizen) has window focus. When the gate is off, PTT works as it did before (always-on global). When the gate is on, the PTT key is a no-op while the user is typing in chat, browser, or terminal — those apps receive the keystroke normally.

### Implementation

- Main-process polling probe via `active-win` (500ms interval), caches focused window's process name + title
- Pure decision function `shouldGatePass({ focus, allowlist })` lives in the renderer, unit-tested
- PttController reads the cache over IPC at key-press time and decides whether to dispatch
- Key-release always fires regardless of focus — guarantees the mic never gets stuck open

### Wayland fallback

Wayland has no portable API for querying the active window (deliberate compositor security model). On Wayland sessions, the focus probe is skipped and the gate fails-open (permits all PTT). The settings panel displays a non-blocking warning so users know their gate config is inactive on this session type. X11 sessions work normally.

### Allowlist semantics

- Case-insensitive substring match against (`processName` + " " + `title`)
- Default entry: `"StarCitizen"` — matches both Windows-native and Wine-prefix process names + window titles
- Users can add additional substrings (e.g., `"ElementX"`, `"Firefox"`) via the settings UI
- Empty allowlist = gate effectively disabled (fail-open)
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/2026-05-26-hailfreq-design.md
git commit -m "docs: focused-app PTT shipped (Plan 8a)"
```

---

## Done

After Task 8, the deliverable is:

- Cross-platform focused-window probe (`active-win` 500ms polling, Wayland-aware)
- Pure decision function with 8 unit tests
- IPC channel `focus:get` for cache reads + `settings:setFocusedAppPtt` for persistence
- PttController gate at key-press, release always fires
- Settings UI section: enable toggle + allowlist editor + Wayland warning + "show current focus" debug
- Default-off behavior so existing users see no change
- Rebuilt installers
- README + spec note

**Known v1 limitations:**

- macOS not tested (no macOS installer per spec scope)
- Wayland fail-open (technical limitation of the platform)
- No regex matching on allowlist entries — substring only
- 500ms polling means up to a 500ms window where the cached value lags reality. Below human perception for PTT but worth noting.

**Next plans:**

- **Plan 8b** — Screen sharing (LiveKit screen track + SFrame E2EE + receiver pane UI), ~8-10 tasks
- **Plan 8c** — Net Bridges (cross-server allies coordination, needs design pass on default mode + dedup), ~15+ tasks
