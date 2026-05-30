# Settings Menu + Audio Device Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified Settings menu (⚙ from the sidebar) whose Audio section lets users test + select their mic/speaker any time, persist the choice, and have voice use it live.

**Architecture:** Persist `inputDeviceId`/`outputDeviceId` in the electron-store `Settings`. Reusable renderer audio utils (constraint builder, test tone, mic-level hook) shared by the first-run wizard and a new Audio settings section. A `SettingsMenu` modal (left-nav) hosts the Audio section + the migrated PTT-focus section. `VoiceEngine` applies the devices via `getUserMedia({deviceId})` and `AudioContext.setSinkId`, live.

**Tech Stack:** Electron + React + TypeScript, electron-store, Vitest, Web Audio API.

**Spec:** `docs/superpowers/specs/2026-05-30-settings-menu-audio-devices-design.md`

---

## File structure

**New:**
- `client/src/renderer/audio/deviceConstraints.ts` — pure `micConstraints(deviceId?)` builder (testable).
- `client/src/renderer/audio/testTone.ts` — `playTestTone(deviceId?)` (extracted from OutputStep).
- `client/src/renderer/audio/useMicLevel.ts` — `useMicLevel(deviceId?)` hook (extracted from InputStep metering).
- `client/src/renderer/screens/settings/AudioDevicesSettings.tsx` — Audio section (device pickers + meter + test).
- `client/src/renderer/screens/SettingsMenu.tsx` — modal shell with left-nav sections.
- `client/tests/unit/deviceConstraints.test.ts`, `client/tests/unit/voiceEngineDevices.test.ts`.

**Modified:**
- `client/src/shared/types.ts` — add `inputDeviceId?`/`outputDeviceId?` to `Settings`.
- `client/src/main/store.ts` — defaults + migration passthrough.
- `client/src/shared/ipc.ts` + `client/src/main/ipc.ts` — `settings:setAudioDevices`.
- `client/src/renderer/voice/VoiceEngine.ts` — device fields + `setAudioDevices()` + apply in `getMicSource`/`ensureAudio`.
- `client/src/renderer/screens/audioSetup/InputStep.tsx`, `OutputStep.tsx` — use the shared utils.
- `client/src/renderer/screens/AudioSetupWizard.tsx` — persist devices.
- `client/src/renderer/screens/FocusedAppPttSettings.tsx` — split content from modal chrome.
- `client/src/renderer/components/Sidebar.tsx` — ⚙ button → SettingsMenu; drop standalone PTT button.
- `client/src/renderer/AppState.tsx` — wire device settings → engine (load + save + live).

Run all commands from `client/`. Tests: `npx vitest run <file>`. Typecheck: `npx tsc --noEmit`.

---

### Task 1: Persist device IDs in Settings type + store

**Files:**
- Modify: `client/src/shared/types.ts` (after the `audioSetupComplete?` field, ~line 122)
- Modify: `client/src/main/store.ts` (defaults ~line 11; migration passthrough ~line 92)
- Test: `client/tests/unit/storeMigration.test.ts` (existing)

- [ ] **Step 1: Add the failing migration test**

Append to `client/tests/unit/storeMigration.test.ts`:
```ts
import { migrateLegacyShape } from "@/main/store";

describe("audio device persistence", () => {
  it("passes through inputDeviceId/outputDeviceId on the multi-server shape", () => {
    const out = migrateLegacyShape({
      servers: [],
      activeServerId: "",
      inputDeviceId: "mic-1",
      outputDeviceId: "spk-1",
    });
    expect(out.inputDeviceId).toBe("mic-1");
    expect(out.outputDeviceId).toBe("spk-1");
  });
  it("leaves them undefined when absent", () => {
    const out = migrateLegacyShape({ servers: [], activeServerId: "" });
    expect(out.inputDeviceId).toBeUndefined();
    expect(out.outputDeviceId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/storeMigration.test.ts`
Expected: FAIL (`inputDeviceId` is `undefined`, not `"mic-1"` — passthrough not implemented).

- [ ] **Step 3: Add the fields to the `Settings` type**

In `client/src/shared/types.ts`, immediately after the `audioSetupComplete?: boolean;` field (inside the `Settings` interface, before its closing `}`):
```ts
  /**
   * Persisted global audio device selections (deviceId from enumerateDevices).
   * Undefined = use the system default. Set via the Settings → Audio menu and
   * the first-run wizard.
   */
  inputDeviceId?: string;
  outputDeviceId?: string;
```

- [ ] **Step 4: Pass them through in `migrateLegacyShape`**

In `client/src/main/store.ts`, in the multi-server-shape return object `settingsWithFocus` (the block ending ~line 93-94), add after the `audioSetupComplete` line:
```ts
    ...(typeof typed.inputDeviceId === "string" ? { inputDeviceId: typed.inputDeviceId } : {}),
    ...(typeof typed.outputDeviceId === "string" ? { outputDeviceId: typed.outputDeviceId } : {}),
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run tests/unit/storeMigration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/shared/types.ts client/src/main/store.ts client/tests/unit/storeMigration.test.ts
git commit -m "feat(settings): persist input/output audio device IDs"
```

---

### Task 2: `settings:setAudioDevices` IPC

**Files:**
- Modify: `client/src/shared/ipc.ts` (after `settings:setAudioSetupComplete`, ~line 90)
- Modify: `client/src/main/ipc.ts` (after the `settings:setAudioSetupComplete` handler, ~line 158)

- [ ] **Step 1: Add the IPC channel type**

In `client/src/shared/ipc.ts`, after the `"settings:setAudioSetupComplete"` line:
```ts
  "settings:setAudioDevices": { args: [{ inputDeviceId?: string; outputDeviceId?: string }]; result: void };
```

- [ ] **Step 2: Add the main-process handler**

In `client/src/main/ipc.ts`, after the `settings:setAudioSetupComplete` handler block:
```ts
  ipcMain.handle("settings:setAudioDevices", (_event, args: unknown): void => {
    if (!args || typeof args !== "object") {
      throw new Error("settings:setAudioDevices: args must be an object");
    }
    const { inputDeviceId, outputDeviceId } = args as {
      inputDeviceId?: unknown;
      outputDeviceId?: unknown;
    };
    if (inputDeviceId !== undefined && typeof inputDeviceId !== "string") {
      throw new Error("settings:setAudioDevices: inputDeviceId must be a string or undefined");
    }
    if (outputDeviceId !== undefined && typeof outputDeviceId !== "string") {
      throw new Error("settings:setAudioDevices: outputDeviceId must be a string or undefined");
    }
    if (inputDeviceId !== undefined) settings.set("inputDeviceId", inputDeviceId);
    if (outputDeviceId !== undefined) settings.set("outputDeviceId", outputDeviceId);
  });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add client/src/shared/ipc.ts client/src/main/ipc.ts
git commit -m "feat(settings): settings:setAudioDevices IPC"
```

---

### Task 3: `micConstraints` builder (pure, tested)

**Files:**
- Create: `client/src/renderer/audio/deviceConstraints.ts`
- Test: `client/tests/unit/deviceConstraints.test.ts`

- [ ] **Step 1: Write the failing test**

`client/tests/unit/deviceConstraints.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { micConstraints } from "@/renderer/audio/deviceConstraints";

describe("micConstraints", () => {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 48000 };
  it("uses default audio when no device id", () => {
    expect(micConstraints(undefined)).toEqual({ audio: base });
  });
  it("adds an exact deviceId when provided", () => {
    expect(micConstraints("mic-1")).toEqual({ audio: { ...base, deviceId: { exact: "mic-1" } } });
  });
  it("ignores an empty string device id", () => {
    expect(micConstraints("")).toEqual({ audio: base });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/deviceConstraints.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`client/src/renderer/audio/deviceConstraints.ts`:
```ts
/** Base mic capture constraints, shared by the wizard, settings, and VoiceEngine. */
export const BASE_MIC_AUDIO = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48000,
} as const;

/**
 * Build getUserMedia constraints for the mic, optionally pinned to a device.
 * Empty/undefined deviceId → system default.
 */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  if (deviceId) {
    return { audio: { ...BASE_MIC_AUDIO, deviceId: { exact: deviceId } } };
  }
  return { audio: { ...BASE_MIC_AUDIO } };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/deviceConstraints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/audio/deviceConstraints.ts client/tests/unit/deviceConstraints.test.ts
git commit -m "feat(audio): micConstraints device-id builder"
```

---

### Task 4: VoiceEngine applies devices (input constraint + setSinkId)

**Files:**
- Modify: `client/src/renderer/voice/VoiceEngine.ts` (fields near line 66; `ensureAudio` ~125; `getMicSource` ~365; add methods)
- Test: `client/tests/unit/voiceEngineDevices.test.ts`

- [ ] **Step 1: Write the failing test for the setSinkId support guard**

`client/tests/unit/voiceEngineDevices.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { audioContextSupportsSinkId } from "@/renderer/voice/VoiceEngine";

describe("audioContextSupportsSinkId", () => {
  it("true when AudioContext.prototype has setSinkId", () => {
    const ctor = { prototype: { setSinkId: () => {} } } as unknown as typeof AudioContext;
    expect(audioContextSupportsSinkId(ctor)).toBe(true);
  });
  it("false when it does not", () => {
    const ctor = { prototype: {} } as unknown as typeof AudioContext;
    expect(audioContextSupportsSinkId(ctor)).toBe(false);
  });
  it("false when ctor is undefined", () => {
    expect(audioContextSupportsSinkId(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/voiceEngineDevices.test.ts`
Expected: FAIL (`audioContextSupportsSinkId` not exported).

- [ ] **Step 3: Implement the guard + device application**

In `client/src/renderer/voice/VoiceEngine.ts`:

(a) Add the import at the top:
```ts
import { micConstraints } from "../audio/deviceConstraints";
```

(b) Add this exported helper near the top of the file (after imports, before the class):
```ts
/** True if this AudioContext implementation supports setSinkId (Chromium 110+). */
export function audioContextSupportsSinkId(ctor?: typeof AudioContext): boolean {
  return !!ctor && typeof ctor.prototype === "object" && "setSinkId" in ctor.prototype;
}
```

(c) Add private fields alongside the other audio fields (near `private micStream` ~line 66):
```ts
  private inputDeviceId?: string;
  private outputDeviceId?: string;
```

(d) Add public methods (place after `getMicSource`):
```ts
  /** Set persisted audio devices and apply them live. Call after construction and on settings change. */
  async setAudioDevices(opts: { inputDeviceId?: string; outputDeviceId?: string }): Promise<void> {
    const inputChanged = opts.inputDeviceId !== this.inputDeviceId;
    this.inputDeviceId = opts.inputDeviceId;
    this.outputDeviceId = opts.outputDeviceId;
    // Output: route the live context to the chosen sink (best-effort).
    await this.applyOutputDevice();
    // Input: drop the cached mic so the next getMicSource re-acquires on the new device.
    if (inputChanged && this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      if (this.micSourceNode) {
        this.micSourceNode.disconnect();
        this.micSourceNode = null;
        this.localMicAnalyser = null;
      }
    }
  }

  private async applyOutputDevice(): Promise<void> {
    if (!this.audioCtx || !this.outputDeviceId) return;
    if (!audioContextSupportsSinkId(AudioContext)) return;
    try {
      await (this.audioCtx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(
        this.outputDeviceId,
      );
    } catch (err) {
      console.error("[VoiceEngine] setSinkId failed; using default output:", err);
    }
  }
```

(e) In `ensureAudio()`, after `this.chirpGain.connect(this.outputGain);`, add:
```ts
    void this.applyOutputDevice();
```

(f) In `getMicSource()`, replace the `getUserMedia({ audio: {...} })` call with:
```ts
      this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints(this.inputDeviceId));
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/voiceEngineDevices.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full unit run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all green).

- [ ] **Step 6: Commit**

```bash
git add client/src/renderer/voice/VoiceEngine.ts client/tests/unit/voiceEngineDevices.test.ts
git commit -m "feat(voice): apply persisted input/output devices (getUserMedia + setSinkId)"
```

---

### Task 5: Shared `playTestTone` util + adopt in OutputStep

**Files:**
- Create: `client/src/renderer/audio/testTone.ts`
- Modify: `client/src/renderer/screens/audioSetup/OutputStep.tsx` (replace inline `playTestTone`)

- [ ] **Step 1: Create the util (lifted verbatim from OutputStep so behavior is identical)**

`client/src/renderer/audio/testTone.ts`:
```ts
/**
 * Play a short 660 Hz beep to a specific output device. Uses an <audio> element
 * + setSinkId because AudioContext can't target an arbitrary sink directly.
 * No-ops the sink (plays on default) if deviceId is empty or setSinkId is unsupported.
 */
export async function playTestTone(deviceId?: string): Promise<void> {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 660;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  osc.connect(gain).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);

  const audio = new Audio();
  audio.srcObject = dest.stream;
  try {
    if (deviceId && "setSinkId" in audio) {
      await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
    }
  } catch (err) {
    console.error("setSinkId failed:", err);
  }
  void audio.play();
  setTimeout(() => {
    void ctx.close();
    audio.srcObject = null;
  }, 400);
}
```

- [ ] **Step 2: Use it in OutputStep**

In `client/src/renderer/screens/audioSetup/OutputStep.tsx`: add `import { playTestTone } from "../../audio/testTone";` at the top, delete the local `async function playTestTone() { ... }` (lines ~24-55), and change the button to `onClick={() => void playTestTone(selected)}`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/audio/testTone.ts client/src/renderer/screens/audioSetup/OutputStep.tsx
git commit -m "refactor(audio): extract playTestTone util, reuse in OutputStep"
```

---

### Task 6: Shared `useMicLevel` hook + adopt in InputStep

**Files:**
- Create: `client/src/renderer/audio/useMicLevel.ts`
- Modify: `client/src/renderer/screens/audioSetup/InputStep.tsx` (replace inline metering effect)

- [ ] **Step 1: Create the hook (metering logic lifted from InputStep)**

`client/src/renderer/audio/useMicLevel.ts`:
```ts
import { useEffect, useRef, useState } from "react";

/**
 * Open the given input device and report a live RMS level (0..1). Re-opens on
 * deviceId change; tears down on unmount. Returns 0 until a device is selected.
 */
export function useMicLevel(deviceId: string | undefined): number {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        await ctxRef.current?.close();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = setInterval(() => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          setLevel(Math.sqrt(s / buf.length));
        }, 50);
      } catch (err) {
        console.error("useMicLevel: getUserMedia failed", err);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
    };
  }, [deviceId]);

  return level;
}
```

- [ ] **Step 2: Use it in InputStep**

In `client/src/renderer/screens/audioSetup/InputStep.tsx`: add `import { useMicLevel } from "../../audio/useMicLevel";`, delete the `level` `useState` and the metering `useEffect` (the `[selected]` effect at ~lines 35-80) and the `streamRef`/`ctxRef` refs, and replace with `const level = useMicLevel(selected);`. Keep the device-enumeration effect and the `pct`/render unchanged.

- [ ] **Step 3: Typecheck + full unit run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/audio/useMicLevel.ts client/src/renderer/screens/audioSetup/InputStep.tsx
git commit -m "refactor(audio): extract useMicLevel hook, reuse in InputStep"
```

---

### Task 7: `AudioDevicesSettings` section component

**Files:**
- Create: `client/src/renderer/screens/settings/AudioDevicesSettings.tsx`

- [ ] **Step 1: Implement the section (reuses the shared utils)**

`client/src/renderer/screens/settings/AudioDevicesSettings.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { useMicLevel } from "../../audio/useMicLevel";
import { playTestTone } from "../../audio/testTone";

interface Props {
  inputDeviceId?: string;
  outputDeviceId?: string;
  onChange: (devices: { inputDeviceId?: string; outputDeviceId?: string }) => void;
}

export function AudioDevicesSettings({ inputDeviceId, outputDeviceId, onChange }: Props) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(inputDeviceId ?? "");
  const [output, setOutput] = useState(outputDeviceId ?? "");
  const level = useMicLevel(input || undefined);

  useEffect(() => {
    void (async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch { /* labels stay blank without permission */ }
      const all = await navigator.mediaDevices.enumerateDevices();
      setInputs(all.filter((d) => d.kind === "audioinput"));
      setOutputs(all.filter((d) => d.kind === "audiooutput"));
    })();
  }, []);

  const pct = Math.min(100, Math.round(Math.pow(level, 0.5) * 130));

  function pickInput(id: string) { setInput(id); onChange({ inputDeviceId: id, outputDeviceId: output || undefined }); }
  function pickOutput(id: string) { setOutput(id); onChange({ inputDeviceId: input || undefined, outputDeviceId: id }); }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Microphone</h3>
        <select value={input} onChange={(e) => pickInput(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm">
          <option value="">System default</option>
          {inputs.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label || "(unnamed device)"}</option>))}
        </select>
        <div className="h-3 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-500">Speak — the bar should move.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Speakers / output</h3>
        <select value={output} onChange={(e) => pickOutput(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm">
          <option value="">System default</option>
          {outputs.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label || "(default output)"}</option>))}
        </select>
        <Button onClick={() => void playTestTone(output || undefined)}>Test tone</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/screens/settings/AudioDevicesSettings.tsx
git commit -m "feat(settings): AudioDevicesSettings section"
```

---

### Task 8: Split FocusedAppPttSettings into embeddable content

**Files:**
- Modify: `client/src/renderer/screens/FocusedAppPttSettings.tsx`

**Context:** `FocusedAppPttSettings` is currently a self-contained modal (`fixed inset-0 …` overlay + an `onClose` button). To host it as a section inside `SettingsMenu`, separate the form content from the modal chrome.

- [ ] **Step 1: Extract the inner content**

In `client/src/renderer/screens/FocusedAppPttSettings.tsx`, rename the current exported component body to a new exported `FocusedAppPttSettingsContent` that renders ONLY the form (the contents currently inside the modal's inner `<div>`), with props `{ focusedAppPtt?, onSave }` (drop `onClose` from the content). Keep all existing state/handlers. Then re-add a thin wrapper that preserves the old modal API:
```tsx
export function FocusedAppPttSettings({ focusedAppPtt, onSave, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-xl rounded border border-slate-700 bg-slate-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">PTT focus</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <FocusedAppPttSettingsContent focusedAppPtt={focusedAppPtt} onSave={onSave} />
      </div>
    </div>
  );
}
```
(If the original already had a heading/close button, reuse its exact markup; the key change is that the *content* is now a separate exported component.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/screens/FocusedAppPttSettings.tsx
git commit -m "refactor(settings): split FocusedAppPttSettings content from modal chrome"
```

---

### Task 9: `SettingsMenu` modal shell

**Files:**
- Create: `client/src/renderer/screens/SettingsMenu.tsx`

- [ ] **Step 1: Implement the shell**

`client/src/renderer/screens/SettingsMenu.tsx`:
```tsx
import { useState } from "react";
import type { FocusedAppPttSettings as FocusedAppPttSettingsType } from "@shared/types";
import { AudioDevicesSettings } from "./settings/AudioDevicesSettings";
import { FocusedAppPttSettingsContent } from "./FocusedAppPttSettings";

type Section = "audio" | "ptt";

interface Props {
  inputDeviceId?: string;
  outputDeviceId?: string;
  onChangeAudioDevices: (devices: { inputDeviceId?: string; outputDeviceId?: string }) => void;
  focusedAppPtt?: FocusedAppPttSettingsType;
  onSaveFocusedAppPtt: (value: FocusedAppPttSettingsType) => Promise<void>;
  onClose: () => void;
}

export function SettingsMenu(props: Props) {
  const [section, setSection] = useState<Section>("audio");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="flex h-[32rem] w-full max-w-3xl overflow-hidden rounded border border-slate-700 bg-slate-900">
        <nav className="w-48 shrink-0 border-r border-slate-800 p-3">
          <div className="mb-2 px-2 text-xs uppercase tracking-wider text-slate-500">Settings</div>
          {([["audio", "Audio devices"], ["ptt", "PTT focus"]] as [Section, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`block w-full rounded px-2 py-1.5 text-left text-sm ${section === id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 p-4">
            <h2 className="text-base font-semibold text-slate-100">{section === "audio" ? "Audio devices" : "PTT focus"}</h2>
            <button onClick={props.onClose} className="text-slate-400 hover:text-slate-200">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {section === "audio" && (
              <AudioDevicesSettings
                inputDeviceId={props.inputDeviceId}
                outputDeviceId={props.outputDeviceId}
                onChange={props.onChangeAudioDevices}
              />
            )}
            {section === "ptt" && (
              <FocusedAppPttSettingsContent focusedAppPtt={props.focusedAppPtt} onSave={props.onSaveFocusedAppPtt} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/screens/SettingsMenu.tsx
git commit -m "feat(settings): SettingsMenu modal shell (Audio + PTT focus sections)"
```

---

### Task 10: Wire the ⚙ button in the Sidebar

**Files:**
- Modify: `client/src/renderer/components/Sidebar.tsx`

**Context:** The Sidebar currently has a standalone "PTT focus settings" button (the crosshair `<svg>` at `mt-auto`, ~line 130-141) gated on `onSaveFocusedAppPtt`, and renders `<FocusedAppPttSettingsPanel>` when `focusedAppPttOpen`. Replace this with a ⚙ Settings button that opens the new `SettingsMenu` (which contains the PTT-focus section).

- [ ] **Step 1: Swap the button + panel**

In `client/src/renderer/components/Sidebar.tsx`:
- Add import: `import { SettingsMenu } from "../screens/SettingsMenu";`
- Add new props to the component's `Props` interface: `inputDeviceId?: string; outputDeviceId?: string; onChangeAudioDevices?: (d: { inputDeviceId?: string; outputDeviceId?: string }) => void;`
- Rename the `focusedAppPttOpen` state to `settingsOpen` (or add a new `settingsOpen` state).
- Replace the crosshair button block with:
```tsx
        {onSaveFocusedAppPtt && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.29.95c-1.37-.84-2.94.73-2.1 2.1.62 1.02.05 2.34-1.1 2.58-1.56.38-1.56 2.6 0 2.98a1.53 1.53 0 01.95 2.29c-.84 1.37.73 2.94 2.1 2.1a1.53 1.53 0 012.29.95c.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 012.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 01.95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 01-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 01-2.29-.95zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
        )}
```
- Replace the `{focusedAppPttOpen && …}` render block with:
```tsx
      {settingsOpen && onSaveFocusedAppPtt && (
        <SettingsMenu
          inputDeviceId={inputDeviceId}
          outputDeviceId={outputDeviceId}
          onChangeAudioDevices={(d) => onChangeAudioDevices?.(d)}
          focusedAppPtt={focusedAppPtt}
          onSaveFocusedAppPtt={onSaveFocusedAppPtt}
          onClose={() => setSettingsOpen(false)}
        />
      )}
```
- Remove the now-unused `FocusedAppPttSettingsPanel` import if nothing else uses it. (`ScIntegrationSettingsPanel` stays — it's per-server.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: may error in `AppState.tsx` about the new Sidebar props — that's wired in Task 11. Confirm the only errors are the missing `inputDeviceId`/`outputDeviceId`/`onChangeAudioDevices` props at the `<Sidebar>` call site.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/components/Sidebar.tsx
git commit -m "feat(settings): sidebar gear opens SettingsMenu (replaces standalone PTT button)"
```

---

### Task 11: Wire device settings through AppState

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (state shape ~line 98/1167; settings load ~line 272; VoiceEngine construction ~lines 194 & 719; save handler near the `setFocusedAppPtt` one ~line 1005; `<Sidebar>` render ~line 1115/1137)

- [ ] **Step 1: Carry the device IDs in state + load them**

- Add `inputDeviceId?: string; outputDeviceId?: string;` to the AppState state type (wherever `focusedAppPtt?` is declared, ~line 98 and the props type ~1167).
- In the `setState({...})` that loads settings (~line 272), add: `inputDeviceId: settings.inputDeviceId, outputDeviceId: settings.outputDeviceId,`.

- [ ] **Step 2: Apply devices to each VoiceEngine on construction**

After **each** `const voiceEngine = new VoiceEngine(handle.client);` (lines ~194 and ~719), add:
```ts
        void voiceEngine.setAudioDevices({ inputDeviceId: settings.inputDeviceId, outputDeviceId: settings.outputDeviceId });
```
(Use the same `settings` object already in scope at those sites; if not in scope, read from the loaded settings/state available there.)

- [ ] **Step 3: Add the save handler (mirror setFocusedAppPtt)**

Near the existing focused-app-ptt save handler (~line 1005), add:
```ts
  async function handleChangeAudioDevices(devices: { inputDeviceId?: string; outputDeviceId?: string }) {
    await window.hailfreq.invoke("settings:setAudioDevices", devices);
    setState((prev) => ({ ...prev, inputDeviceId: devices.inputDeviceId, outputDeviceId: devices.outputDeviceId }));
    // Apply live to every active engine.
    for (const [, , engine] of signedInWithEngine) {
      void engine.setAudioDevices(devices);
    }
  }
```
(Use whatever iterable of active `VoiceEngine`s AppState exposes — match the variable used elsewhere to reach engines, e.g. `signedInWithEngine`. If engines aren't iterable there, store the latest devices and apply on next `monitorNet` instead, and note that in the commit.)

- [ ] **Step 4: Pass the new props to `<Sidebar>`**

At the `<Sidebar … focusedAppPtt={state.focusedAppPtt} … />` call site(s), add:
```tsx
            inputDeviceId={state.inputDeviceId}
            outputDeviceId={state.outputDeviceId}
            onChangeAudioDevices={handleChangeAudioDevices}
```

- [ ] **Step 5: Typecheck + full unit run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (all green; Sidebar prop errors from Task 10 resolved).

- [ ] **Step 6: Commit**

```bash
git add client/src/renderer/AppState.tsx
git commit -m "feat(settings): wire audio device settings through AppState (load + save + live)"
```

---

### Task 12: Persist devices from the first-run wizard

**Files:**
- Modify: `client/src/renderer/screens/AudioSetupWizard.tsx` (`persistAndFinish`, ~line 17-22)

- [ ] **Step 1: Persist the chosen devices on finish**

In `persistAndFinish`, before `await window.hailfreq.invoke("settings:setAudioSetupComplete", { value: true });`, add:
```ts
    await window.hailfreq.invoke("settings:setAudioDevices", {
      inputDeviceId: inputDeviceId || undefined,
      outputDeviceId: outputDeviceId || undefined,
    });
```
(`inputDeviceId`/`outputDeviceId` are already tracked in the wizard's state.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/screens/AudioSetupWizard.tsx
git commit -m "fix(audio): persist selected devices from the first-run wizard"
```

---

### Task 13: Build + package verification

- [ ] **Step 1: Full typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all PASS.

- [ ] **Step 2: Production build (and clean tsc-emitted artifacts from src)**

Run: `npm run build && git clean -Xfd src`
Expected: build exit 0. (`git clean -Xfd src` removes the gitignored `.js` tsc-build artifacts so they don't shadow `.ts` in later runs — see CLAUDE/memory note.)

- [ ] **Step 3: Manual smoke test (operator)**

Launch the dev app or AppImage. Open the ⚙ Settings → Audio devices: switch mic (meter moves), switch speaker + Test tone (plays on the chosen device); confirm the PTT-focus section works. Join a net and confirm an active call switches input/output when changed. (Live audio can't be unit-tested.)

- [ ] **Step 4: Commit any build-config fixes if needed, then push**

```bash
git push origin feat/settings-audio-devices
```
(The draft PR #29 updates automatically; mark it ready for review when the smoke test passes.)
</content>
