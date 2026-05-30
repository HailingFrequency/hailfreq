# Settings Menu + Audio Device Testing — Design

**Date:** 2026-05-30
**Status:** Approved in brainstorming; pending implementation plan.

## Overview

Add a unified, persistent **Settings menu** to the Hailfreq client, opened from a gear (⚙) button in the sidebar. Its primary section lets users **test and select their audio input (mic) and output (speaker) devices at any time** — not just during the first-run wizard — with a live mic-level meter, an output test tone, and device pickers. The chosen devices are **persisted and actually used by voice**.

The existing global **PTT-focus** settings move into this menu. Per-server **SC integration** settings stay where they are (they're per-server; "which server" only makes sense in that context).

This also closes an existing gap: the first-run `AudioSetupWizard` currently does **not** persist the selected input/output devices (`persistAndFinish` only marks setup complete — there's a `// Future: persist` TODO).

## Goals

- A persistent Settings menu reachable anytime.
- Audio section: pick + test mic (live level meter) and speaker (test tone); persist both.
- Persisted devices are used by voice — input via `getUserMedia` constraints, output via `AudioContext.setSinkId`.
- Changing a device applies **live** (active nets switch without reconnecting).
- Migrate the global PTT-focus settings into the menu.
- Share the device-test code between the first-run wizard and the new Settings section, and make the wizard persist its selection too.

## Non-goals

- Migrating per-server SC integration settings (they stay per-server).
- Per-net device overrides (global default only).
- Advanced audio controls (noise suppression, gain sliders) — future.
- macOS support.

## Architecture / components

### Entry & shell
- **`components/Sidebar.tsx`** — add a ⚙ "Settings" button; remove the standalone "PTT focus settings" button (folded into the menu).
- **`screens/SettingsMenu.tsx`** (new) — a modal overlay (same visual pattern as `AudioSetupWizard`) with a left section nav and a content pane. Sections: **Audio devices**, **PTT focus**.
- The "PTT focus" section reuses the existing **`FocusedAppPttSettings`** screen as-is.

### Audio devices section
- **`screens/settings/AudioDevicesSettings.tsx`** (new):
  - **Input row:** `<select>` of `audioinput` devices + a live **mic-level meter**.
  - **Output row:** `<select>` of `audiooutput` devices + a **"Test"** button that plays a short tone to the *selected* device.
  - Selecting a device persists it immediately; both fall back to the system default if nothing is saved or a saved device disappears.
- **Reuse / extract** the shared bits from `screens/audioSetup/InputStep.tsx` + `OutputStep.tsx` so the wizard and Settings share one implementation:
  - `renderer/audio/useAudioDevices.ts` (new) — `enumerateDevices` for a kind, permission handling, and a `devicechange` listener.
  - A reusable mic-level meter (extract from `InputStep` + the existing `MicLevelBar`).
  - `playTestTone(deviceId)` util — the `<audio>` + `setSinkId` tone (the technique `OutputStep` already uses, since `AudioContext` can't `setSinkId` an arbitrary sink directly via an element).

### Persistence
- **`shared/types.ts`** `AppSettings` — add `inputDeviceId?: string`, `outputDeviceId?: string`.
- **`main/store.ts`** — defaults (`undefined`) + migration passthrough (same shape as the existing `audioSetupComplete` handling).
- **IPC** — `settings:setAudioDevices` (`{ inputDeviceId?, outputDeviceId? }`) persists; the existing `settings:get` returns the new fields.

### Apply to voice (`voice/VoiceEngine.ts`)
- **Input:** `getMicSource()` builds constraints `{ audio: inputDeviceId ? { deviceId: { exact: inputDeviceId } } : true }`. On `OverconstrainedError` (device gone), retry with default.
- **Output:** `ensureAudio()` — after creating the `AudioContext`, `await audioCtx.setSinkId(outputDeviceId)` when set and `"setSinkId" in AudioContext.prototype`; wrapped in try/catch so an unsupported/failed sink is non-fatal (stays on default).
- **Live-apply:** `AppState` passes the device settings to `VoiceEngine`; on change it calls:
  - `setOutputDevice(id)` → `setSinkId` on the live `AudioContext`.
  - `setInputDevice(id)` → re-acquire `micStream` so active nets/PTT pick up the new input.

### First-run wizard
- **`screens/AudioSetupWizard.tsx`** — `persistAndFinish` now persists `inputDeviceId`/`outputDeviceId` via the same IPC (closes the existing TODO), using the extracted shared components.

## Data flow

1. App load: `AppState` reads settings (incl. `inputDeviceId`/`outputDeviceId`) and configures `VoiceEngine` with them.
2. User opens Settings → Audio: sees current devices; mic meter is live; test tone on demand.
3. User selects a device → IPC persist → `AppState` state updates → `VoiceEngine` applies it live.

## Error handling / edge cases

- **Saved device absent:** dropdown marks it unavailable / falls back to default; voice uses default.
- **Mic permission denied:** the Audio section shows a clear message (reuse the wizard's handling); device labels are blank until permission is granted (same as the wizard).
- **`setSinkId` unsupported or fails:** output stays on the system default; logged, non-fatal.

## Testing

- **Unit:** settings store add/migrate `inputDeviceId`/`outputDeviceId`; the `getUserMedia` constraint builder (deviceId set vs unset vs overconstrained-fallback); the `setSinkId` support guard.
- **Manual:** open Settings, switch mic + speaker, verify the live meter, the test tone routes to the chosen speaker, and an active net switches input/output live.

## Anticipated files

- **New:** `screens/SettingsMenu.tsx`, `screens/settings/AudioDevicesSettings.tsx`, `renderer/audio/useAudioDevices.ts` (+ extracted meter/tone utils).
- **Modified:** `components/Sidebar.tsx`, `screens/AudioSetupWizard.tsx`, `screens/audioSetup/InputStep.tsx` + `OutputStep.tsx` (extract shared), `voice/VoiceEngine.ts`, `renderer/AppState.tsx` (wire settings → engine), `shared/types.ts`, `main/store.ts`, `main/ipc.ts` (settings IPC).
