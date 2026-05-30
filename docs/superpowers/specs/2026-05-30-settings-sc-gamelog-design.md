# Star Citizen / Ship Link Settings Section — Design

**Date:** 2026-05-30
**Status:** Approved in brainstorming; pending implementation plan.

## Overview

Surface the **global Game.log path** (the input that powers "Ship Link" — Star Citizen Game.log-driven ship-net auto-creation / join prompts) as its own section in the unified ⚙ **Settings menu**, alongside Audio devices and PTT focus.

Today the Game.log path is a global setting (`Settings.scInstallPath`) but is only reachable by right-clicking a server → **Star Citizen Integration**, where it sits inside a *per-server* modal. That places a machine-global value under a per-server context. This feature makes the ⚙ Settings menu the single home for the path and adds a **live watch-status** line so the user can confirm Ship Link is actually reading the game without having to board a ship.

This also closes a discoverability gap: a user who hasn't opened a server's context menu may never find where to point Hailfreq at their Game.log.

## Goals

- A **Star Citizen** section in the ⚙ Settings menu that is the single place to set the global Game.log path.
- Path controls: show current path (or "Not set"), **Browse…**, **Auto-detect**, **Clear**, and a valid/invalid indicator.
- A **live watch-status** line confirming whether Ship Link is currently watching the log and when it last saw activity.
- Remove the path field from the per-server **Star Citizen Integration** modal; replace it with a hint pointing to ⚙ Settings. Keep the genuinely per-server controls there (enable toggle, auto-invite allowlist, auto-close).
- Reuse all existing machinery (file picker, validation, auto-detect, persistence, tailer lifecycle) — no new tailer plumbing.

## Non-goals

- Changing how ship-link detection/auto-creation works (parser, ship-net creation, allowlist invites, auto-close) — unchanged.
- Making the path per-server (it stays global / machine-wide).
- A global "enable Ship Link" master switch — enable stays per-server (`ServerEntry.scIntegration.enabled`).
- macOS support.

## Current state (what already exists — reuse, don't rebuild)

- **Storage:** `Settings.scInstallPath?: string` — global, in `src/shared/types.ts`; defaulted/migrated in `src/main/store.ts`. Persisted via IPC `settings:setScInstallPath`.
- **Per-server settings:** `ServerEntry.scIntegration` (`enabled`, allowlist, auto-close) in `src/shared/types.ts`; persisted via `servers:update`.
- **Existing UI:** `src/renderer/screens/ScIntegrationSettings.tsx` — per-server modal that today renders BOTH the per-server `scIntegration` controls AND the global Game.log path (text input + Browse + Auto-detect + debounced validation). Opened from `Sidebar.tsx` via `scIntegrationFor` state.
- **IPC (main):** `sc:pickGameLog` (native open dialog, validates basename == `Game.log`, returns absolute path or `null`), `sc:findInstall` (auto-detect), `sc:validatePath` (`{ path }`), `sc:startWatch` (`{ gameLogPath }`), `sc:stopWatch` — in `src/main/ipc.ts`.
- **Tailer:** `src/main/scLogTail.ts` — a single global watcher (`active: WatchState | null`); broadcasts `sc:logLine` per parsed line and `sc:tailerReplaced` on path change.
- **Lifecycle:** `AppState.tsx` effect (~lines 548–638) starts/stops the watcher whenever `state.scInstallPath` or the set of ship-link-enabled servers changes. **This already handles restart-on-path-change** — the new section just updates `scInstallPath`.
- **Settings menu:** `src/renderer/screens/SettingsMenu.tsx` — left-nav `Section` union (`"audio" | "ptt"`) + content pane. Section components take their value(s) as props + an `onChange` that persists via IPC then updates `AppState`. `AudioDevicesSettings` is the pattern to follow.

## Architecture / components

### New: `src/renderer/screens/settings/ScGameLogSettings.tsx`
A global settings section. Props:
```ts
interface ScGameLogSettingsProps {
  scInstallPath?: string;
  // Servers that currently have Ship Link enabled — used only for the status line.
  enabledServerNames: string[];
  onChange: (path: string | undefined) => Promise<void>;
}
```
Renders:
- **Path row:** current path (or "Not set"), **Browse…** (`sc:pickGameLog`), **Auto-detect** (`sc:findInstall`), **Clear** (calls `onChange(undefined)`). On a successful pick/detect, calls `onChange(path)`.
- **Validity indicator:** debounced `sc:validatePath` on the current path → ✓ valid / ✗ message (reuse the existing validation logic lifted from `ScIntegrationSettings`).
- **Watch-status line** (see data flow): one of
  - `Not set` — no path configured.
  - `Path set — Ship Link isn't enabled on any server` (+ "enable it from a server's Star Citizen Integration menu") when `scInstallPath` is set but `enabledServerNames` is empty.
  - `Watching ✓ — last activity <relative time>` when the tailer is active (and, if `lastLineAt` is null, `Watching ✓ — no activity yet`).
  - `Not watching — file not found` when the path is set + enabled but the tailer reports it isn't active / file missing.

### Extract from `ScIntegrationSettings.tsx`
- Lift the Game.log **path sub-form** (text/path display, Browse, Auto-detect, validation) into `ScGameLogSettings` so both the new section and (historically) the modal don't duplicate it.
- The per-server modal **loses** the path UI and shows a hint: *"Game.log path is set in ⚙ Settings → Star Citizen."* It keeps: enable toggle, auto-invite allowlist, auto-close. Its `onSave` no longer carries `scInstallPath` (only `scIntegration`).

### `SettingsMenu.tsx`
- Extend `Section` to `"audio" | "ptt" | "sc"`; add nav entry `["sc", "Star Citizen"]`; render `<ScGameLogSettings .../>` when selected. Pass `scInstallPath`, derived `enabledServerNames`, and the new `onChange` from props (threaded down from `AppState`, same as audio devices).

### `AppState.tsx`
- Add `handleChangeScInstallPath(path?: string)` (useCallback): `await window.hailfreq.invoke("settings:setScInstallPath", { path })` then `setState(prev => ({ ...prev, scInstallPath: path }))`. The existing watcher effect reacts to the `scInstallPath` change (start/stop/replace) — no extra lifecycle code.
- Derive `enabledServerNames` from the server list (`entry.scIntegration?.enabled`) and pass into the Settings menu.
- `settings:setScInstallPath` **already** accepts `{ path: string | undefined }` (shared/ipc.ts; handler validates string-or-undefined), so Clear works by passing `{ path: undefined }` — no IPC change. The plan should confirm the handler `delete`s the stored key (not stores `undefined`) so a cleared path truly resets to default.

### Watch-status data flow
- **New main IPC `sc:watchStatus`** → `{ watching: boolean; path: string | null; lastLineAt: number | null }`, read from the authoritative tailer state in `scLogTail.ts`.
  - Add a `lastLineAt: number | null` field to the watcher, stamped each time a line is read/broadcast.
  - `watching` = there is an `active` watcher; `path` = the path it's watching.
- `ScGameLogSettings` **polls `sc:watchStatus` every ~2s while mounted** (cleared on unmount) and also refreshes immediately when a `sc:logLine` or `sc:tailerReplaced` event arrives (so "last activity" feels live without a fast poll).

## Data flow (set path)

1. User opens ⚙ → **Star Citizen**. Section reads `scInstallPath` from props, validates it, and begins polling `sc:watchStatus`.
2. User clicks **Browse…**/**Auto-detect** → gets an absolute path → `onChange(path)` → `AppState` persists via `settings:setScInstallPath` + updates state.
3. `AppState`'s existing watcher effect sees the new `scInstallPath` and (for each enabled server) restarts the global tailer (`sc:startWatch`).
4. `sc:watchStatus` now reports `watching: true`; as the game writes lines, `sc:logLine` fires and the status line shows recent activity.
5. **Clear** → `onChange(undefined)` → path removed → effect stops the tailer → status shows "Not set".

## Error handling / edge cases

- **No path set:** status "Not set"; Browse/Auto-detect available; Clear hidden/disabled.
- **Path set but no server enabled:** tailer isn't running by design → status explains this and points to the per-server enable.
- **File missing/renamed/invalid:** validation shows ✗; `sc:watchStatus.watching` is false (or file-not-found) → status reflects it.
- **`sc:findInstall` finds nothing:** inline "No SC install found — use Browse…".
- **Picker cancelled or wrong file:** `sc:pickGameLog` returns `null` → no change (existing behavior).
- **`sc:watchStatus` unsupported/throws:** treat as `watching:false`; never crash the section.

## Testing

- **Unit:**
  - `ScGameLogSettings` status-string selection given `{ scInstallPath, enabledServerNames, watchStatus }` across the four states (not-set / set-but-disabled / watching / not-watching-file-missing) and the `lastLineAt` "no activity yet" vs relative-time cases.
  - `sc:watchStatus` return shape from a mocked tailer state (active vs null, lastLineAt set vs null).
  - Tailer `lastLineAt` is stamped on each broadcast line.
  - `settings:setScInstallPath` clears the key when passed `undefined`.
- **Manual:** set a real Game.log via the new section → "Watching ✓" with recent activity; confirm the per-server modal now defers to Settings for the path; Clear stops the tailer; Auto-detect populates the path.

## Anticipated files

- **New:** `src/renderer/screens/settings/ScGameLogSettings.tsx`; tests under `client/tests/unit/`.
- **Modified:** `src/renderer/screens/SettingsMenu.tsx` (new `"sc"` section + props), `src/renderer/components/Sidebar.tsx` (thread `scInstallPath`/`enabledServerNames`/`onChangeScInstallPath` into `SettingsMenu`; drop `scInstallPath` from the per-server `onSaveScIntegration` patch), `src/renderer/screens/ScIntegrationSettings.tsx` (remove path sub-form, add hint, drop `scInstallPath` from `onSave`), `src/renderer/AppState.tsx` (new `handleChangeScInstallPath`, derive `enabledServerNames`, thread props), `src/main/scLogTail.ts` (`lastLineAt` stamp + status accessor), `src/main/ipc.ts` (`sc:watchStatus` handler), `src/shared/ipc.ts` (`sc:watchStatus` channel type). Note: `settings:setScInstallPath` already accepts `string | undefined` — no change there.
