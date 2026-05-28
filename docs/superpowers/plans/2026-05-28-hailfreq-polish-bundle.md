# Hailfreq Polish Bundle Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 polish bundle on top of the feature-complete product. Adds radio chirps (intro/outro tones on PTT, mimicking Star Comms and real tactical radios), QR code device verification alongside SAS, drag-to-reorder server sidebar, system tray with minimize-to-tray, OS-level desktop notifications, and absorbs the remaining carry-forward minor items from Plan 5's final review. After Plan 6, the product feels finished — every common gameplay-side annoyance has a UX answer.

**Architecture:** Almost entirely client-side additions. Chirps use Web Audio playback of user-supplied files from `userData/chirps/`. QR verification uses matrix-js-sdk's QR-flow APIs (alongside the existing SAS). Drag-to-reorder uses HTML5 native drag events on `ServerIcon`. System tray uses Electron's `Tray` API. Notifications use Electron's `Notification` (which delegates to OS native — Windows toast, Linux libnotify, macOS NSUserNotification). One server-side improvement: `/kick` returns 200 instead of 500 when the LiveKit participant doesn't exist (idempotent semantics).

**Tech Stack:** Same as Plans 1–5. No new heavy dependencies. May add a small library for QR code rendering (e.g., `qrcode` for generating, `jsqr` for scanning if we need scan-via-camera; for v1 we can text-paste the QR payload as a fallback).

**Scope reference:** Closes out the §9.2 v1.5 items that don't depend on game-specific or architecturally-new work. Drag-to-reorder closes the Plan 3 deferred item.

**Out of scope:**
- Star Citizen Game.log integration — Plan 7 (needs Game.log path + sample snippet from operator)
- Focused-app PTT — Plan 8
- Screen sharing UI exposure — Plan 8
- Net Bridges — Plan 8
- Multi-server voice — v1.5 design phase
- Squad-leader limited admin board view (Plan 5 reviewer flag) — requires spec clarification before implementing
- Theme support / light mode — UI polish to defer

**Repo location:** Client work throughout `client/src/`. One small change to `server/livekit-auth/src/index.ts`.

---

## Task 1: Chirp storage + built-in chirps

**Files:**
- Create: `client/src/main/chirps.ts`
- Modify: `client/src/shared/ipc.ts` (chirps:list, chirps:read, chirps:openFolder)
- Modify: `client/src/main/ipc.ts` (register handlers)
- Create: `client/assets/chirps/built-in/classic-two-tone.wav` (placeholder — implementer may generate via tools or fetch from a CC0 source)
- Create: `client/assets/chirps/built-in/motorola-quad.wav` (same)
- Create: `client/assets/chirps/built-in/click.wav` (same)

The main process exposes:
- `chirps:list` — returns `Array<{ id, name, source: "builtin"|"custom" }>`
- `chirps:read(id)` — returns `Uint8Array` of the file bytes
- `chirps:openFolder()` — opens the user's `userData/chirps/` in the OS file manager so they can add custom files

- [ ] **Step 1: Write `client/src/main/chirps.ts`**

```ts
import { app, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const CHIRP_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac"]);
const MAX_CHIRP_BYTES = 5 * 1024 * 1024;

const BUILTIN_CHIRPS = [
  { id: "builtin:classic-two-tone", name: "Classic two-tone", file: "classic-two-tone.wav" },
  { id: "builtin:motorola-quad", name: "Motorola quad tone", file: "motorola-quad.wav" },
  { id: "builtin:click", name: "Short radio click", file: "click.wav" },
  { id: "builtin:none", name: "None", file: "" },
];

export interface ChirpSummary {
  id: string;
  name: string;
  source: "builtin" | "custom";
}

export async function ensureChirpFolder(): Promise<string> {
  const folder = path.join(app.getPath("userData"), "chirps");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}

function builtinChirpsDir(): string {
  return path.join(app.getAppPath(), "assets", "chirps", "built-in");
}

export async function listChirps(): Promise<ChirpSummary[]> {
  const out: ChirpSummary[] = BUILTIN_CHIRPS.map((c) => ({
    id: c.id,
    name: c.name,
    source: "builtin",
  }));
  try {
    const folder = await ensureChirpFolder();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CHIRP_EXTENSIONS.has(ext)) continue;
      out.push({
        id: `custom:${encodeURIComponent(entry.name)}`,
        name: path.parse(entry.name).name,
        source: "custom",
      });
    }
  } catch (err) {
    console.error("Failed to list custom chirps:", err);
  }
  return out;
}

export async function readChirp(id: string): Promise<Uint8Array> {
  if (id === "builtin:none") return new Uint8Array(0);
  if (id.startsWith("builtin:")) {
    const entry = BUILTIN_CHIRPS.find((c) => c.id === id);
    if (!entry || !entry.file) throw new Error(`Unknown built-in chirp: ${id}`);
    const filePath = path.join(builtinChirpsDir(), entry.file);
    return Uint8Array.from(await fs.readFile(filePath));
  }
  if (id.startsWith("custom:")) {
    const fileName = decodeURIComponent(id.slice("custom:".length));
    if (!fileName || fileName !== path.basename(fileName)) {
      throw new Error("Invalid chirp file name");
    }
    const ext = path.extname(fileName).toLowerCase();
    if (!CHIRP_EXTENSIONS.has(ext)) {
      throw new Error("Custom chirps must be WAV, MP3, OGG, or FLAC files");
    }
    const folder = await ensureChirpFolder();
    const filePath = path.join(folder, fileName);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("Selected chirp is not a file");
    if (stat.size > MAX_CHIRP_BYTES) throw new Error("Selected chirp is larger than 5 MB");
    return Uint8Array.from(await fs.readFile(filePath));
  }
  throw new Error(`Unknown chirp id: ${id}`);
}

export async function openChirpFolder(): Promise<string> {
  const folder = await ensureChirpFolder();
  const result = await shell.openPath(folder);
  if (result) throw new Error(result);
  return folder;
}
```

- [ ] **Step 2: Add IPC channels** in `client/src/shared/ipc.ts`:

```ts
import type { ChirpSummary } from "../main/chirps";

"chirps:list": { args: []; result: ChirpSummary[] };
"chirps:read": { args: [{ id: string }]; result: Uint8Array };
"chirps:openFolder": { args: []; result: string };
```

- [ ] **Step 3: Register handlers** in `client/src/main/ipc.ts`:

```ts
import { listChirps, readChirp, openChirpFolder } from "./chirps";

ipcMain.handle("chirps:list", () => listChirps());
ipcMain.handle("chirps:read", (_e, args: { id: string }) => readChirp(args.id));
ipcMain.handle("chirps:openFolder", () => openChirpFolder());
```

- [ ] **Step 4: Generate placeholder built-in chirp WAV files**

A 0.3-second two-tone WAV can be made with `sox` (if installed) or Python's `wave` module. Implementer note: if generating tones is hard, use silence (1ms of zeros) as a placeholder so the file exists and the codec doesn't choke — chirps are a UX feature, exact tones can be improved later.

```bash
cd /home/shreen/code/tactical-radio/client
mkdir -p assets/chirps/built-in
# Three short WAVs (placeholders — implementer should improve later if time)
python3 << 'EOF'
import struct, math, wave

def make_tone(filename, freqs_ms, sample_rate=22050):
    frames = []
    for freq, ms in freqs_ms:
        n = int(sample_rate * ms / 1000)
        for i in range(n):
            t = i / sample_rate
            v = 0 if freq == 0 else int(math.sin(2 * math.pi * freq * t) * 12000)
            frames.append(struct.pack("<h", v))
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"".join(frames))

make_tone("assets/chirps/built-in/classic-two-tone.wav", [(800, 80), (1200, 80)])
make_tone("assets/chirps/built-in/motorola-quad.wav", [(700, 50), (900, 50), (1100, 50), (1300, 50)])
make_tone("assets/chirps/built-in/click.wav", [(0, 5), (300, 25), (0, 5)])
print("Done")
EOF
ls -lh assets/chirps/built-in/
```

- [ ] **Step 5: Add `assets/chirps/built-in/` to electron-builder include**

In `client/electron-builder.yml`, ensure the `files:` block includes `assets/**/*` (it likely already does — verify). If not, add it.

- [ ] **Step 6: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/chirps.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/assets/chirps/
git commit -m "client(chirps): main-process chirp storage + IPC + 3 built-in tones"
```

---

## Task 2: Chirp playback in VoiceEngine

**Files:**
- Modify: `client/src/renderer/voice/VoiceEngine.ts`
- Create: `client/src/renderer/voice/chirpPlayer.ts`

The VoiceEngine plays inbound and outbound chirps when PTT starts/stops on each net. Chirps are per-net (different nets can have different chirps).

- [ ] **Step 1: Write `client/src/renderer/voice/chirpPlayer.ts`**

```ts
const decodedCache = new Map<string, AudioBuffer>();

export async function loadChirp(audioCtx: AudioContext, id: string): Promise<AudioBuffer | null> {
  if (id === "builtin:none") return null;
  if (decodedCache.has(id)) return decodedCache.get(id) ?? null;
  const bytes = await window.hailfreq.invoke("chirps:read", { id });
  if (bytes.length === 0) return null;
  // Need a fresh ArrayBuffer copy because Uint8Array.buffer may be a SharedArrayBuffer in IPC
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoded = await audioCtx.decodeAudioData(ab as ArrayBuffer);
  decodedCache.set(id, decoded);
  return decoded;
}

export function playChirp(audioCtx: AudioContext, buffer: AudioBuffer, gainNode: GainNode, volume = 0.7): void {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const localGain = audioCtx.createGain();
  localGain.gain.value = volume;
  source.connect(localGain);
  localGain.connect(gainNode);
  source.start();
}
```

- [ ] **Step 2: Modify VoiceEngine** to play chirps:
- Add `setChirps(matrixRoomId, { inbound: string; outbound: string })` method storing per-net chirp IDs
- Add `setChirpVolume(volume)` (defaults to 0.7)
- In `startPtt`: load + play the outbound chirp (mixed to the OWN output, not transmitted)
- In `stopPtt`: load + play the click chirp
- In track-subscribed events: play the inbound chirp the first time a participant on that net starts speaking (debounced — don't play it again until they've been silent for >2s)

The implementation needs to:
- Track per-net "currently-active speakers" + a timer for inbound debounce
- Use the existing `audioCtx` + a dedicated chirp gain node connected to `outputGain` (parallel to the volumeGain chain so chirps aren't ducked)

The plan's verbatim sketch is in Task 7's VoiceEngine (review Plan 4) — this task adds to it incrementally.

- [ ] **Step 3: Wire chirp selection from NetListPanel UI** — Task 3 below adds UI; for now just verify the engine compiles + works programmatically.

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/VoiceEngine.ts client/src/renderer/voice/chirpPlayer.ts
git commit -m "client(voice): per-net chirp playback on PTT start/stop + inbound debounced"
```

---

## Task 3: Chirp selection UI in NetRow

**Files:**
- Modify: `client/src/renderer/components/NetRow.tsx`
- Modify: `client/src/renderer/components/NetListPanel.tsx`
- Modify: `client/src/shared/types.ts` (chirpIds in NetPreferences)

Add a chirp dropdown to each NetRow: "Outbound chirp" + "Inbound chirp" + "Open chirps folder" link.

- [ ] **Step 1: Extend `NetPreferences`** in `client/src/shared/types.ts`:

```ts
export interface NetPreferences {
  // ... existing fields ...
  /** Per-net outbound chirp ID. Default: "builtin:click". */
  outboundChirps: Record<string, string>;
  /** Per-net inbound chirp ID. Default: "builtin:classic-two-tone". */
  inboundChirps: Record<string, string>;
}
```

Update `store.ts` `addServer` + `migrateLegacyShape` to initialize these.

- [ ] **Step 2: Fetch chirp list once in NetListPanel** via `chirps:list` IPC; pass to each NetRow via prop.

- [ ] **Step 3: Add dropdown UI in NetRow** — two `<select>` elements showing the list of available chirps. On change, persist via servers:update.

- [ ] **Step 4: Wire chirp IDs into VoiceEngine** — when `monitorNet` runs, call `engine.setChirps(roomId, { inbound, outbound })` with the per-net selections from the user's prefs.

- [ ] **Step 5: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/main/store.ts client/src/renderer/components/NetRow.tsx client/src/renderer/components/NetListPanel.tsx
git commit -m "client(chirps): per-net inbound/outbound chirp selection UI + persistence"
```

---

## Task 4: QR code device verification (alongside SAS)

**Files:**
- Modify: `client/src/renderer/matrix/verification.ts` (extend to support QR flow)
- Create: `client/src/renderer/components/QrVerification.tsx`
- Modify: `client/src/renderer/AppState.tsx` (route to QR flow when offered)

matrix-js-sdk supports two QR-based verification methods:
- `m.qr_code.scan.v1` — scan the other party's QR (need camera or paste payload)
- `m.qr_code.show.v1` — show your own QR for the other party to scan

For v1 of QR support, we offer **show-only** (display QR, other side scans) plus a **paste fallback** (paste the other side's QR payload as text). True camera scanning is deferred.

- [ ] **Step 1: Add a `qrcode` dependency for rendering**

```bash
cd /home/shreen/code/tactical-radio/client
npm install qrcode@^1.5.4 @types/qrcode@^1.5.5
```

- [ ] **Step 2: Extend `verification.ts`** to expose both SAS and QR start helpers. The verification request from another device may offer multiple methods; the user picks one.

- [ ] **Step 3: Write `client/src/renderer/components/QrVerification.tsx`** — renders a QR image (via qrcode lib) from the verification request's payload + has a "Paste their QR" textarea for the other direction. On confirm, completes the verification.

- [ ] **Step 4: Modify the AppState verification flow** to show a method picker when a request arrives (radio buttons: "Compare emoji" / "Scan QR" / "Show QR"), then route to either EmojiVerification (existing) or QrVerification (new).

- [ ] **Step 5: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/package.json client/package-lock.json client/src/renderer/matrix/verification.ts client/src/renderer/components/QrVerification.tsx client/src/renderer/AppState.tsx
git commit -m "client(verify): QR code device verification alongside SAS emoji"
```

---

## Task 5: Drag-to-reorder server sidebar

**Files:**
- Modify: `client/src/renderer/components/Sidebar.tsx`
- Modify: `client/src/renderer/components/ServerIcon.tsx`
- Modify: `client/src/main/store.ts` (add `reorderServers` helper)
- Modify: `client/src/shared/ipc.ts` + `client/src/main/ipc.ts` (`servers:reorder` channel)
- Modify: `client/src/renderer/AppState.tsx` (wire reorder + update local state)

- [ ] **Step 1: Add store helper + IPC channel**

In `store.ts`:
```ts
export function reorderServers(orderedIds: string[]): void {
  const servers = settings.get("servers");
  const byId = new Map(servers.map((s) => [s.id, s]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter((s): s is ServerEntry => !!s);
  for (const s of servers) {
    if (!orderedIds.includes(s.id)) reordered.push(s);
  }
  settings.set("servers", reordered);
}
```

In `shared/ipc.ts`: `"servers:reorder": { args: [{ orderedIds: string[] }]; result: void };`

In `main/ipc.ts`: register the handler.

- [ ] **Step 2: HTML5 drag-and-drop in Sidebar**

ServerIcon gets `draggable={true}` + `onDragStart` setting `dataTransfer.setData("text/plain", serverId)`. Sidebar wraps each icon in a `<div>` with `onDragOver={(e) => e.preventDefault()}` and `onDrop` that computes the new order and calls a parent callback `onReorder(orderedIds)`.

- [ ] **Step 3: AppState wires `onReorder`** — calls `servers:reorder` IPC, updates the local state's `servers` Map order.

- [ ] **Step 4: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/Sidebar.tsx client/src/renderer/components/ServerIcon.tsx client/src/main/store.ts client/src/shared/ipc.ts client/src/main/ipc.ts client/src/renderer/AppState.tsx
git commit -m "client(sidebar): drag-to-reorder server icons (Plan 3 deferred item)"
```

---

## Task 6: System tray icon

**Files:**
- Create: `client/src/main/tray.ts`
- Modify: `client/src/main/index.ts` (create tray on whenReady, hide window on close)

A persistent system tray icon. Left-click toggles window visibility. Right-click menu: "Show/Hide Hailfreq", "Quit". On close (X button), the app hides to tray instead of quitting (with a "really quit" hold-shift-close escape hatch).

- [ ] **Step 1: Write `client/src/main/tray.ts`**

```ts
import { Tray, Menu, BrowserWindow, nativeImage, app } from "electron";
import path from "node:path";

let tray: Tray | null = null;
let isQuitting = false;

export function markQuitting(): void {
  isQuitting = true;
}

export function shouldQuitOnClose(): boolean {
  return isQuitting;
}

export function createTray(getMainWindow: () => BrowserWindow | null): void {
  const iconPath = path.join(app.getAppPath(), "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Hailfreq");

  const buildMenu = () => {
    const win = getMainWindow();
    const isVisible = win?.isVisible() ?? false;
    return Menu.buildFromTemplate([
      {
        label: isVisible ? "Hide Hailfreq" : "Show Hailfreq",
        click: () => {
          const w = getMainWindow();
          if (!w) return;
          if (w.isVisible()) w.hide();
          else { w.show(); w.focus(); }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
  };

  tray.setContextMenu(buildMenu());
  tray.on("click", () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isVisible()) w.hide();
    else { w.show(); w.focus(); }
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
```

- [ ] **Step 2: Modify `index.ts`**:
- Call `createTray(() => mainWindow)` after `mainWindow = createMainWindow()`
- On `mainWindow.on("close", (event) => { if (!shouldQuitOnClose()) { event.preventDefault(); mainWindow?.hide(); } })`
- Replace `app.on("window-all-closed", ...)` to NOT quit on Linux/Windows (keep app alive in tray)
- On `app.on("before-quit", () => markQuitting())`

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/tray.ts client/src/main/index.ts
git commit -m "client(main): system tray icon + minimize-to-tray on window close"
```

---

## Task 7: OS-level desktop notifications

**Files:**
- Create: `client/src/main/notifications.ts`
- Modify: `client/src/shared/ipc.ts` + `client/src/main/ipc.ts` (`notify:show` channel)
- Modify: `client/src/renderer/AppState.tsx` (fire notification on unread incoming when window not focused)

Show a native OS notification when a message arrives on a server that isn't the active server OR when the window isn't focused. Click the notification → focus the window + switch to that server.

- [ ] **Step 1: Write `client/src/main/notifications.ts`**

```ts
import { Notification, BrowserWindow } from "electron";

export interface NotifyOptions {
  title: string;
  body: string;
  /** Server ID to switch to on click. */
  serverId?: string;
}

export function showNotification(opts: NotifyOptions, getMainWindow: () => BrowserWindow | null): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: opts.title,
    body: opts.body,
    silent: false,
  });
  n.on("click", () => {
    const win = getMainWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.focus();
    if (opts.serverId) {
      win.webContents.send("notify:clicked", { serverId: opts.serverId });
    }
  });
  n.show();
}
```

- [ ] **Step 2: IPC channels**

```ts
"notify:show": { args: [NotifyOptions]; result: void };
// + a renderer-bound event "notify:clicked" exposed via preload (onNotifyClicked callback)
```

- [ ] **Step 3: Wire firing in AppState**

In the existing Plan 3 unread-count subscription, when an incoming message arrives on a non-active server OR while the window is not focused (`window.hailfreq.invoke("app:windowFocused")` returns false), call `notify:show`.

Add a small `app:windowFocused` IPC that returns `mainWindow?.isFocused()`. Or simpler: track focus state in the renderer via `document.hasFocus()`.

- [ ] **Step 4: Subscribe to `notify:clicked` in AppState** — on click, switch active server to the clicked one.

- [ ] **Step 5: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/notifications.ts client/src/shared/ipc.ts client/src/main/ipc.ts client/src/renderer/AppState.tsx client/src/preload/index.ts
git commit -m "client(notify): OS desktop notifications for incoming messages on inactive server"
```

---

## Task 8: Per-server notification preferences

**Files:**
- Modify: `client/src/shared/types.ts` (`notificationsEnabled: boolean` per server)
- Modify: `client/src/renderer/components/ServerContextMenu.tsx` (toggle)
- Modify: `client/src/renderer/AppState.tsx` (gate `notify:show` on the per-server flag)

Add a per-server "Notifications enabled" toggle in the existing right-click context menu. Defaults to true. When false, no OS notifications fire for that server.

- [ ] **Step 1: Extend ServerEntry**

Add `notificationsEnabled?: boolean` to `ServerEntry` (default true via `?? true`).

- [ ] **Step 2: Toggle in ServerContextMenu**

Between the "Rename" option and "Remove" option, add a toggleable item: "Notifications: On/Off".

- [ ] **Step 3: Gate firing in AppState**

In the notify trigger, check the server's `notificationsEnabled` before calling `notify:show`.

- [ ] **Step 4: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/renderer/components/ServerContextMenu.tsx client/src/renderer/AppState.tsx
git commit -m "client(notify): per-server notifications-enabled toggle in context menu"
```

---

## Task 9: livekit-auth /kick — idempotent NOT_FOUND handling

**Files:**
- Modify: `server/livekit-auth/src/index.ts`

Plan 5's reviewer flagged: if the target user isn't currently in the LiveKit room (e.g., already disconnected), `roomService.removeParticipant` throws and we return 500. This should be a no-op success (200) — the operator's intent ("get this user off voice") is already satisfied.

- [ ] **Step 1: Catch the NOT_FOUND case**

LiveKit's server SDK throws errors that include a `code` property. NOT_FOUND for participant is typically gRPC code 5 or the message contains "not found". Pattern:

```ts
try {
  await roomService.removeParticipant(liveKitRoom, targetUserId);
} catch (err) {
  // Treat "participant not in room" as success — operator intent already satisfied
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("not found") || msg.includes("no participant")) {
    return res.json({ ok: true, note: "participant not in room (idempotent)" });
  }
  throw err;
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /home/shreen/code/tactical-radio/server/livekit-auth
npm run build 2>&1 | tail -3
```

```bash
cd /home/shreen/code/tactical-radio
git add server/livekit-auth/src/index.ts
git commit -m "server(livekit-auth): /kick treats NOT_FOUND participant as idempotent success"
```

---

## Task 10: window.__matrixHandle test-mode hook

**Files:**
- Modify: `client/src/renderer/AppState.tsx`

Plan 5's reviewer flagged that the admin-board E2E test self-skips at Level 1 because `window.__matrixHandle` is never exposed. Add a useEffect under `HAILFREQ_TEST=1` that exposes the active server's `ClientHandle` for the test harness.

- [ ] **Step 1: Expose `window.__matrixHandle` in AppState**

In `ActiveServerView` (or wherever the active server's handle is in scope):

```tsx
useEffect(() => {
  if (process.env.HAILFREQ_TEST !== "1") return;
  if (!handle) return;
  (window as any).__matrixHandle = handle;
  return () => {
    if ((window as any).__matrixHandle === handle) {
      delete (window as any).__matrixHandle;
    }
  };
}, [handle]);
```

(Mirror the pattern already used for `window.__voiceEngine` in NetListPanel.)

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx
git commit -m "client(test): expose window.__matrixHandle in HAILFREQ_TEST mode (unlocks admin E2E Level 2+)"
```

---

## Task 11: Vitest unit tests for new modules

**Files:**
- Create: `client/tests/unit/chirpPlayer.test.ts`
- Create: `client/tests/unit/sidebarReorder.test.ts`

Light unit tests for the pure parts (chirp ID parsing, reorder pure-function logic).

- [ ] **Step 1: Write tests** for `loadChirp` (mocked IPC + cache hit/miss) and for the reorder logic (verify orderedIds maps + missing-IDs append).

- [ ] **Step 2: Run + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run 2>&1 | tail -10
# Expect: 25 previous + ~4 new = ~29 tests passing
```

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/chirpPlayer.test.ts client/tests/unit/sidebarReorder.test.ts
git commit -m "client(test): unit tests for chirp loading + sidebar reorder logic"
```

---

## Task 12: Rebuild installers + smoke test

- [ ] **Step 1: Linux + Windows**

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
ls -lh release/Hailfreq-*
chmod +x release/Hailfreq-*x86_64.AppImage
timeout 5 ./release/Hailfreq-*x86_64.AppImage 2>&1 | head -5 || true
```

No commit unless something broke.

---

## Task 13: README + spec markers

- [ ] **Step 1: Update `client/README.md`** — add to feature list:

```markdown
- Radio chirps on PTT (built-in tones + custom files from `userData/chirps/`)
- QR code device verification (alongside SAS emoji)
- Drag-to-reorder server sidebar
- System tray with minimize-to-tray
- OS-level desktop notifications (per-server toggle)
```

- [ ] **Step 2: Mark spec §9.2 items as moved to v1** — in the design spec, find the v1.5 list and either move the shipped items into v1 (§9.1) or annotate them as "shipped in Plan 6".

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/
git commit -m "docs: polish bundle shipped; note Plan 6 v1.5-promoted items in spec"
```

---

## Done

After Task 13, the deliverable is:

- Radio chirps with built-in + custom file support, per-net inbound/outbound selection
- QR device verification alongside SAS
- Drag-to-reorder server sidebar
- System tray + minimize-to-tray
- OS-level desktop notifications with per-server toggle
- `/kick` is now idempotent on NOT_FOUND
- `window.__matrixHandle` test hook exposed
- ~29 unit tests passing

**Known remaining v1.5+ items (for transparency):**
- Squad-leader limited admin board view — needs spec clarification before implementing
- Theme support / light mode — UI polish, can ship anytime
- Module-level profile cache scope — minor doc concern only

**Next plans:**

- **Plan 7** — Star Citizen integration (Game.log tailing + ship-nets + auto-join). Needs Game.log path + sample snippet from operator before writing.
- **Plan 8** — Focused-app PTT + screen sharing + Net Bridges.
- **v1.5 design phase** — Multi-server voice (architectural design, then plan).
