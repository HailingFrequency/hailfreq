# Hailfreq Star Citizen Game.log Integration Implementation Plan (Plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the killer Star Citizen-specific feature: automatic ship-net management driven by parsing Star Citizen's `Game.log`. When a member boards their own ship as pilot, Hailfreq automatically creates and monitors a voice-net for that ship. When a crewmate boards the same ship's in-game comms channel, Hailfreq detects it from the owner's log, looks up that crewmate's Matrix identity via their CitizenID-verified RSI handle, and either notifies the owner with a one-click invite button (default) or auto-invites them to the ship-net if they're on the owner's allowlist. When the ship is destroyed or despawns, the ship-net auto-closes. After Plan 7, the friction between "we're forming up in voice for an op" and "we have a working tactical voice-net for this ship" drops from manual setup to zero clicks.

**Architecture:** Pure client-side feature. A main-process log watcher tails Star Citizen's `Game.log` (path discovered via Windows registry / Linux Wine prefix scan / manual override), parses ship-related events with regex, and surfaces them to the renderer over IPC. The renderer correlates events with the active Matrix client to create ship-nets, look up RSI handles, and trigger invites. The user's CitizenID-published profile (Plan 5) provides the RSI-handle-to-Matrix-user-ID mapping needed for crew invites. No cross-client coordination room is needed — each Hailfreq client parses its own log, which already includes events for other players joining the channels you're in.

**Tech Stack:** Same as Plans 1–6. Node's `fs.watch` for log tailing, regex parsers for event extraction.

**Scope reference:** Beyond the original §6 spec. This is the differentiator that makes Hailfreq specifically a Star Citizen guild tool.

**Out of scope:**
- You boarding someone else's ship (auto-join their ship-net) — operator explicitly deprioritized; could be added later by detecting the "owner != self" channel-join case and looking up via Matrix room directory
- Cross-org ship coordination (different Hailfreq servers) — requires federation or shared directories, deferred to v1.5+
- Other game integrations (Elite Dangerous, Eve Online, etc.) — Hailfreq-as-a-general-game-comms is a v2+ vision
- Detection of vehicle types beyond ship classification (ground vehicles, EVA, etc.)
- Real-time presence in-game ("Rocktato is in the Argo's medbay") — out of scope
- Voice-attack-style command output back into SC — fundamentally out of scope

**Repo location:** Client-side under `client/src/main/` (log watcher) and `client/src/renderer/sc/` (a new "Star Citizen" subdomain alongside `matrix/`, `voice/`).

**Privacy + opt-in:**
- Per-server "Watch Game.log" toggle (default off — explicit opt-in)
- Per-server allowlist for auto-invite (default empty — manual one-click invite by default)
- Game.log path is local-only; no path or contents are transmitted
- Auto-created ship-nets are still encrypted Matrix rooms with the same SFrame E2EE as any other net

---

## Task 1: SC install path discovery

**Files:**
- Create: `client/src/main/scInstallPath.ts`
- Modify: `client/src/shared/ipc.ts` (add `sc:findInstall`, `sc:setInstallPath`)
- Modify: `client/src/main/ipc.ts` (register handlers)
- Modify: `client/src/main/store.ts` (add `scInstallPath` to settings)
- Modify: `client/src/shared/types.ts` (extend Settings)

Path discovery strategies, in order:
1. **Manual override** (from settings) — always wins if set + valid
2. **Windows registry** — read `HKLM\SOFTWARE\Cloud Imperium Games\StarCitizen` (if it exists)
3. **Windows default paths** — `C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log`, `\PTU\`, `\EPTU\`
4. **Linux Wine prefix scan** — common prefixes:
   - Lutris: `~/Games/star-citizen/drive_c/Program Files/Roberts Space Industries/StarCitizen/<branch>/Game.log`
   - Wine default: `~/.wine/drive_c/...`
   - Bottles: `~/.var/app/com.usebottles.bottles/data/bottles/bottles/<bottle>/drive_c/...`
   - Steam Proton: `~/.steam/steam/steamapps/compatdata/<appid>/pfx/drive_c/...`
5. **Manual file picker** as final fallback (renderer UI in Task 14)

The discovery returns a list of candidate paths the user can choose from.

- [ ] **Step 1: Write `client/src/main/scInstallPath.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SC_BRANCHES = ["LIVE", "PTU", "EPTU"];

export interface ScInstallCandidate {
  /** Absolute path to a Game.log file that exists. */
  gameLogPath: string;
  /** Which branch this is (LIVE / PTU / EPTU). */
  branch: string;
  /** Source hint for UI: "registry", "default-windows", "wine-lutris", "wine-default", "bottles", "steam-proton", "manual" */
  source: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function probeBranches(installRoot: string, source: string): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  for (const branch of SC_BRANCHES) {
    const candidate = path.join(installRoot, branch, "Game.log");
    if (await fileExists(candidate)) {
      out.push({ gameLogPath: candidate, branch, source });
    }
  }
  return out;
}

async function findWindows(): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  if (process.platform !== "win32") return out;
  const candidates = [
    "C:\\Program Files\\Roberts Space Industries\\StarCitizen",
    "C:\\Program Files (x86)\\Roberts Space Industries\\StarCitizen",
  ];
  for (const root of candidates) {
    out.push(...(await probeBranches(root, "default-windows")));
  }
  return out;
}

async function scanDirForWinePrefix(baseDir: string, source: string): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const driveC = path.join(baseDir, entry.name, "drive_c");
      const installRoot = path.join(driveC, "Program Files", "Roberts Space Industries", "StarCitizen");
      try {
        await fs.access(installRoot);
        out.push(...(await probeBranches(installRoot, source)));
      } catch {
        // Not a SC prefix; ignore
      }
    }
  } catch {
    // baseDir doesn't exist; ignore
  }
  return out;
}

async function findLinux(): Promise<ScInstallCandidate[]> {
  if (process.platform !== "linux") return [];
  const home = os.homedir();
  const out: ScInstallCandidate[] = [];

  // Lutris
  out.push(...(await scanDirForWinePrefix(path.join(home, "Games"), "wine-lutris")));

  // Standard ~/.wine
  const wineRoot = path.join(home, ".wine", "drive_c", "Program Files", "Roberts Space Industries", "StarCitizen");
  try {
    await fs.access(wineRoot);
    out.push(...(await probeBranches(wineRoot, "wine-default")));
  } catch {}

  // Bottles
  out.push(...(await scanDirForWinePrefix(
    path.join(home, ".var", "app", "com.usebottles.bottles", "data", "bottles", "bottles"),
    "bottles",
  )));

  // Steam Proton
  const protonBase = path.join(home, ".steam", "steam", "steamapps", "compatdata");
  try {
    const entries = await fs.readdir(protonBase, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const installRoot = path.join(protonBase, e.name, "pfx", "drive_c", "Program Files", "Roberts Space Industries", "StarCitizen");
      try {
        await fs.access(installRoot);
        out.push(...(await probeBranches(installRoot, "steam-proton")));
      } catch {}
    }
  } catch {}

  return out;
}

export async function findScInstallCandidates(): Promise<ScInstallCandidate[]> {
  const out: ScInstallCandidate[] = [];
  out.push(...(await findWindows()));
  out.push(...(await findLinux()));
  return out;
}

export async function validateGameLogPath(p: string): Promise<boolean> {
  return fileExists(p);
}
```

- [ ] **Step 2: IPC + Settings**

In `shared/ipc.ts`:
```ts
"sc:findInstall": { args: []; result: ScInstallCandidate[] };
"sc:validatePath": { args: [{ path: string }]; result: boolean };
```

In `main/ipc.ts`: register handlers using `findScInstallCandidates` and `validateGameLogPath`.

Extend `Settings` (in `shared/types.ts`) with `scInstallPath?: string` — global, not per-server, since one machine has one SC install.

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/scInstallPath.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/shared/types.ts client/src/main/store.ts
git commit -m "client(sc): Star Citizen install path discovery (Win/Linux Wine prefixes)"
```

---

## Task 2: Log tailer

**Files:**
- Create: `client/src/main/scLogTail.ts`
- Modify: `client/src/shared/ipc.ts` (`sc:startWatch`, `sc:stopWatch`, plus renderer event `sc:logLine`)
- Modify: `client/src/main/ipc.ts`
- Modify: `client/src/preload/index.ts` (expose `onScLogLine` subscription)

A tailer that:
- Opens `Game.log` and remembers its current size
- Uses `fs.watch` to detect appends
- On change, reads from the last known offset to the new end
- Splits by newlines and emits each new line to the renderer
- Handles log rotation (file truncated / reopened)

- [ ] **Step 1: Write `client/src/main/scLogTail.ts`**

```ts
import { BrowserWindow } from "electron";
import fs from "node:fs";
import { promises as fsp } from "node:fs";

interface WatchState {
  path: string;
  watcher: fs.FSWatcher | null;
  offset: number;
  buffer: string;
  stopped: boolean;
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

  // Stash a teardown closure on the state object for stopWatch
  (state as any)._teardown = () => {
    state.stopped = true;
    if (state.watcher) state.watcher.close();
    if (pollTimer) clearInterval(pollTimer);
  };
}

export async function stopWatch(): Promise<void> {
  if (active) {
    const teardown = (active as any)._teardown as undefined | (() => void);
    if (teardown) teardown();
    active = null;
  }
}
```

- [ ] **Step 2: IPC + preload**

In `shared/ipc.ts`:
```ts
"sc:startWatch": { args: [{ gameLogPath: string }]; result: void };
"sc:stopWatch": { args: []; result: void };
```

In `main/ipc.ts`: register handlers using `startWatch` and `stopWatch`.

In `preload/index.ts`: expose `onScLogLine(cb)` that subscribes to `sc:logLine` events.

In `shared/types.ts`: extend the `Window.hailfreq` declaration.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/scLogTail.ts client/src/shared/ipc.ts client/src/main/ipc.ts client/src/preload/index.ts client/src/shared/types.ts
git commit -m "client(sc): Game.log tailer with append + rotation handling"
```

---

## Task 3: Event parser

**Files:**
- Create: `client/src/renderer/sc/parser.ts`
- Create: `client/src/renderer/sc/events.ts` (event types)

Parse raw log lines into typed events. Three event types we care about (more can be added later):

| Event | Regex anchor | Extracted fields |
|---|---|---|
| `LoginEvent` | `<Expect Incoming Connection>` + `nickname=` + `playerGEID=` | `nickname`, `geid`, `timestamp` |
| `YouJoinedChannel` | `<SHUDEvent_OnNotification>` + `Added notification "You have joined channel '` | `shipType`, `owner`, `timestamp` |
| `OtherJoinedChannel` | `<TIMESTAMP> <player> has joined the channel '<ship> : <owner>'` | `player`, `shipType`, `owner`, `timestamp` |
| `ShipDestroyed` | **Best-effort placeholder** — `<Vehicle Destruction>` OR `<EntityDestroyed>` containing ship class name | `shipType`, `owner`, `timestamp` — implementer should refine against real destruction logs |

- [ ] **Step 1: Write `client/src/renderer/sc/events.ts`**

```ts
export interface BaseScEvent {
  timestamp: string; // ISO-8601 from log
}

export interface LoginEvent extends BaseScEvent {
  kind: "login";
  nickname: string;
  geid: string;
}

export interface YouJoinedChannelEvent extends BaseScEvent {
  kind: "you-joined-channel";
  shipType: string;
  owner: string;
}

export interface OtherJoinedChannelEvent extends BaseScEvent {
  kind: "other-joined-channel";
  player: string;
  shipType: string;
  owner: string;
}

export interface ShipDestroyedEvent extends BaseScEvent {
  kind: "ship-destroyed";
  shipType: string;
  owner: string | null;
}

export type ScEvent = LoginEvent | YouJoinedChannelEvent | OtherJoinedChannelEvent | ShipDestroyedEvent;
```

- [ ] **Step 2: Write `client/src/renderer/sc/parser.ts`**

```ts
import type { ScEvent } from "./events";

// Anchors (case-sensitive; SC logs are consistent)
const TIMESTAMP_RE = /^<([0-9TZ:.\-]+)>/;
const LOGIN_RE = /<Expect Incoming Connection>.*nickname="([^"]+)".*playerGEID=(\d+)/;
const YOU_JOINED_RE = /<SHUDEvent_OnNotification>.*Added notification "You have joined channel '([^:']+?) : ([^']+?)'/;
const OTHER_JOINED_RE = /^<[0-9TZ:.\-]+>\s+([A-Za-z0-9_-]+)\s+has joined the channel '([^:']+?) : ([^']+?)'/;
// Placeholder — implementer should refine against real destruction log lines
const DESTROYED_RE = /(?:<Vehicle Destruction>|<EntityDestroyed>).*?(?:vehicleType|className)=["']?([A-Za-z0-9_]+)/;

export function parseLine(line: string): ScEvent | null {
  const ts = line.match(TIMESTAMP_RE)?.[1] ?? new Date().toISOString();

  // YOU_JOINED — check FIRST because it's more specific than OTHER_JOINED's looser pattern
  let m = line.match(YOU_JOINED_RE);
  if (m) {
    return {
      kind: "you-joined-channel",
      timestamp: ts,
      shipType: m[1].trim(),
      owner: m[2].trim(),
    };
  }

  // OTHER_JOINED — matches lines like "<TS> Playername has joined the channel '...'"
  m = line.match(OTHER_JOINED_RE);
  if (m) {
    return {
      kind: "other-joined-channel",
      timestamp: ts,
      player: m[1].trim(),
      shipType: m[2].trim(),
      owner: m[3].trim(),
    };
  }

  // LOGIN
  m = line.match(LOGIN_RE);
  if (m) {
    return {
      kind: "login",
      timestamp: ts,
      nickname: m[1],
      geid: m[2],
    };
  }

  // SHIP_DESTROYED — best-effort
  m = line.match(DESTROYED_RE);
  if (m) {
    return {
      kind: "ship-destroyed",
      timestamp: ts,
      shipType: m[1],
      owner: null,
    };
  }

  return null;
}
```

**Implementer note:** the `DESTROYED_RE` regex is genuinely a placeholder. The operator does not have a sample destruction line. On first execution, implementers should test against real logs (e.g., have an operator crash their ship and share the resulting line) and refine the regex. The other three regexes are anchored against confirmed log formats from the operator.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/sc/parser.ts client/src/renderer/sc/events.ts
git commit -m "client(sc): event parser for login + channel-join + destruction"
```

---

## Task 4: SC watcher orchestrator (renderer side)

**Files:**
- Create: `client/src/renderer/sc/ScWatcher.ts`

Subscribes to `sc:logLine` events from the main process, runs each line through the parser, dispatches typed events to callbacks. Tracks the local player's nickname/GEID from the first login event so subsequent events can be correctly classified (your ship vs. someone else's).

- [ ] **Step 1: Write `client/src/renderer/sc/ScWatcher.ts`**

```ts
import { parseLine } from "./parser";
import type { ScEvent, LoginEvent, YouJoinedChannelEvent, OtherJoinedChannelEvent, ShipDestroyedEvent } from "./events";

export interface ScWatcherEvents {
  /** Fired the first time we see a login event. */
  onLogin?: (event: LoginEvent) => void;
  /** Fired when YOU board YOUR ship (owner matches login nickname). */
  onOwnShipBoarded?: (event: YouJoinedChannelEvent) => void;
  /** Fired when YOU board SOMEONE ELSE's ship (owner != login nickname). */
  onOtherShipBoarded?: (event: YouJoinedChannelEvent) => void;
  /** Fired when ANOTHER player joins a channel for YOUR ship. */
  onCrewJoined?: (event: OtherJoinedChannelEvent) => void;
  /** Fired when a ship-destroyed event is parsed (best-effort). */
  onShipDestroyed?: (event: ShipDestroyedEvent) => void;
}

export class ScWatcher {
  private localNickname: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners: ScWatcherEvents = {};

  on(events: ScWatcherEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  async start(gameLogPath: string): Promise<void> {
    await window.hailfreq.invoke("sc:startWatch", { gameLogPath });
    this.unsubscribe = window.hailfreq.onScLogLine((payload) => {
      const event = parseLine(payload.line);
      if (!event) return;
      this.dispatch(event);
    });
  }

  async stop(): Promise<void> {
    await window.hailfreq.invoke("sc:stopWatch");
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getLocalNickname(): string | null {
    return this.localNickname;
  }

  private dispatch(event: ScEvent): void {
    switch (event.kind) {
      case "login":
        this.localNickname = event.nickname;
        this.listeners.onLogin?.(event);
        return;
      case "you-joined-channel":
        if (this.localNickname && event.owner === this.localNickname) {
          this.listeners.onOwnShipBoarded?.(event);
        } else {
          this.listeners.onOtherShipBoarded?.(event);
        }
        return;
      case "other-joined-channel":
        if (this.localNickname && event.owner === this.localNickname) {
          this.listeners.onCrewJoined?.(event);
        }
        return;
      case "ship-destroyed":
        this.listeners.onShipDestroyed?.(event);
        return;
    }
  }
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/sc/ScWatcher.ts
git commit -m "client(sc): ScWatcher orchestrator with login tracking + event dispatch"
```

---

## Task 5: Ship-net data model extensions

**Files:**
- Modify: `client/src/renderer/matrix/nets.ts` (extend createNet to support ship metadata)

Ship-nets are regular voice nets with extra state events:
- `org.hailfreq.ship.type` — ship class name (e.g., "Anvil Asgard")
- `org.hailfreq.ship.owner-rsi` — RSI handle of the owner
- `org.hailfreq.ship.owner-matrix-id` — Matrix user ID of the owner

The room name follows the convention: `🚢 {shipType} — {ownerName}`.

- [ ] **Step 1: Add helpers to `client/src/renderer/matrix/nets.ts`**

```ts
const SHIP_TYPE_EVENT = "org.hailfreq.ship.type";
const SHIP_OWNER_RSI_EVENT = "org.hailfreq.ship.owner-rsi";
const SHIP_OWNER_MATRIX_EVENT = "org.hailfreq.ship.owner-matrix-id";

export interface ShipNetMetadata {
  shipType: string;
  ownerRsi: string;
  ownerMatrixId: string;
}

export async function createShipNet(
  client: MatrixClient,
  ship: ShipNetMetadata,
): Promise<string> {
  const props: NetProperties = {
    priority: 60,
    name: `🚢 ${ship.shipType} — ${ship.ownerRsi}`,
    color: "#22d3ee",
  };
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name: props.name,
    initial_state: [
      { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
      { type: NET_PRIORITY_EVENT, state_key: "", content: { value: props.priority } },
      { type: NET_NAME_EVENT, state_key: "", content: { value: props.name } },
      { type: NET_COLOR_EVENT, state_key: "", content: { value: props.color } },
      { type: SHIP_TYPE_EVENT, state_key: "", content: { value: ship.shipType } },
      { type: SHIP_OWNER_RSI_EVENT, state_key: "", content: { value: ship.ownerRsi } },
      { type: SHIP_OWNER_MATRIX_EVENT, state_key: "", content: { value: ship.ownerMatrixId } },
    ],
  });
  return create.room_id;
}

export function isShipNet(client: MatrixClient, matrixRoomId: string): boolean {
  const room = client.getRoom(matrixRoomId);
  if (!room) return false;
  return !!room.currentState.getStateEvents(SHIP_TYPE_EVENT, "");
}

export function findShipNetByShip(
  client: MatrixClient,
  shipType: string,
  ownerRsi: string,
): string | null {
  for (const room of client.getRooms()) {
    const typeEv = room.currentState.getStateEvents(SHIP_TYPE_EVENT, "");
    const ownerEv = room.currentState.getStateEvents(SHIP_OWNER_RSI_EVENT, "");
    if (!typeEv || !ownerEv) continue;
    if (typeEv.getContent().value === shipType && ownerEv.getContent().value === ownerRsi) {
      return room.roomId;
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/nets.ts
git commit -m "client(matrix): ship-net data model with createShipNet + findShipNetByShip helpers"
```

---

## Task 6: RSI handle → Matrix user ID lookup

**Files:**
- Modify: `client/src/renderer/matrix/profileCache.ts` (add `lookupByRsiHandle`)

Plan 5 added a profile cache mapping Matrix user ID → CitizenID claim (including RSI handle). For Plan 7 we need the inverse: given a RSI handle from the log, find a Matrix user ID.

- [ ] **Step 1: Add `lookupByRsiHandle` to profileCache.ts**

```ts
/**
 * Search the roster for a member whose published CitizenID profile has the
 * given RSI handle (case-insensitive). Returns the Matrix user ID or null.
 *
 * This relies on members having opted into publishing their RSI handle to
 * their Matrix profile (Plan 5 Task 14). If no match, returns null.
 */
export async function lookupMatrixIdByRsiHandle(
  client: MatrixClient,
  rsiHandle: string,
): Promise<string | null> {
  const target = rsiHandle.toLowerCase();

  // Iterate joined members across all rooms (de-duplicate by user ID)
  const seen = new Set<string>();
  for (const room of client.getRooms()) {
    for (const member of room.getJoinedMembers()) {
      if (seen.has(member.userId)) continue;
      seen.add(member.userId);
      const profile = await fetchCitizenIdProfile(client, member.userId);
      if (!profile?.rsiHandle) continue;
      if (profile.rsiHandle.toLowerCase() === target) {
        return member.userId;
      }
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/profileCache.ts
git commit -m "client(matrix): lookupMatrixIdByRsiHandle for RSI→Matrix mapping"
```

---

## Task 7: Per-server SC integration settings

**Files:**
- Modify: `client/src/shared/types.ts` (add `scIntegration` per server)
- Modify: `client/src/main/store.ts` (initialize in addServer + migrateLegacyShape)

Per-server settings:
- `enabled: boolean` — opt in to watching the log for this server (default false)
- `autoInviteAllowlist: string[]` — RSI handles to auto-invite without confirmation
- `autoCloseOnDestruction: boolean` — auto-close ship-net on detected destruction (default true)

- [ ] **Step 1: Extend ServerEntry**

```ts
export interface ScIntegrationSettings {
  enabled: boolean;
  autoInviteAllowlist: string[];
  autoCloseOnDestruction: boolean;
}

export interface ServerEntry {
  // ... existing fields ...
  scIntegration?: ScIntegrationSettings;
}
```

Update `addServer` and `migrateLegacyShape` to initialize:
```ts
scIntegration: { enabled: false, autoInviteAllowlist: [], autoCloseOnDestruction: true }
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/main/store.ts
git commit -m "client(sc): per-server SC integration settings (opt-in by default)"
```

---

## Task 8: ScIntegration service — auto-create on own ship boarding

**Files:**
- Create: `client/src/renderer/sc/ScIntegration.ts`

A renderer-side service that wires `ScWatcher` to the Matrix client. On `onOwnShipBoarded`:
1. Check if a ship-net already exists for this ship+owner via `findShipNetByShip`
2. If yes: auto-monitor it
3. If no: create via `createShipNet` + upload SFrame key + auto-monitor

- [ ] **Step 1: Write `client/src/renderer/sc/ScIntegration.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";
import type { VoiceEngine } from "../voice/VoiceEngine";
import { ScWatcher } from "./ScWatcher";
import { createShipNet, findShipNetByShip } from "../matrix/nets";
import { generateSframeKey, uploadSframeKey } from "../voice/sframeKeys";
import { lookupMatrixIdByRsiHandle } from "../matrix/profileCache";
import type { ServerEntry } from "@shared/types";

export interface ScIntegrationEvents {
  onCrewBoarded?: (info: { rsiHandle: string; matrixUserId: string | null; shipNetRoomId: string }) => void;
  onShipNetCreated?: (matrixRoomId: string) => void;
  onShipNetClosed?: (matrixRoomId: string) => void;
}

export class ScIntegration {
  private readonly client: MatrixClient;
  private readonly engine: VoiceEngine;
  private serverEntry: ServerEntry;
  private watcher: ScWatcher | null = null;
  private listeners: ScIntegrationEvents = {};

  constructor(client: MatrixClient, engine: VoiceEngine, serverEntry: ServerEntry) {
    this.client = client;
    this.engine = engine;
    this.serverEntry = serverEntry;
  }

  setServerEntry(entry: ServerEntry): void {
    this.serverEntry = entry;
  }

  on(events: ScIntegrationEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  async start(gameLogPath: string): Promise<void> {
    if (this.watcher) return;
    const watcher = new ScWatcher();
    watcher.on({
      onOwnShipBoarded: (e) => void this.handleOwnShipBoarded(e.shipType, e.owner),
      onCrewJoined: (e) => void this.handleCrewJoined(e.player, e.shipType, e.owner),
      onShipDestroyed: (e) => void this.handleShipDestroyed(e.shipType),
    });
    await watcher.start(gameLogPath);
    this.watcher = watcher;
  }

  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.stop();
    this.watcher = null;
  }

  private async handleOwnShipBoarded(shipType: string, ownerNickname: string): Promise<void> {
    // Resolve owner's RSI handle → Matrix user ID (the owner is the local user)
    const ownerMatrixId = this.client.getSafeUserId();
    let roomId = findShipNetByShip(this.client, shipType, ownerNickname);
    if (!roomId) {
      roomId = await createShipNet(this.client, {
        shipType,
        ownerRsi: ownerNickname,
        ownerMatrixId,
      });
      const keyBytes = generateSframeKey();
      await uploadSframeKey(this.client, roomId, keyBytes);
      this.listeners.onShipNetCreated?.(roomId);
    }
    // Auto-monitor the ship-net
    await this.engine.monitorNet({ matrixRoomId: roomId, priority: 60 });
  }

  private async handleCrewJoined(crewNickname: string, shipType: string, ownerNickname: string): Promise<void> {
    // Find the ship-net for this ship (must already exist — own-ship handler created it earlier)
    const shipNetRoomId = findShipNetByShip(this.client, shipType, ownerNickname);
    if (!shipNetRoomId) return;

    // Look up the crew member's Matrix ID via their RSI handle
    const matrixUserId = await lookupMatrixIdByRsiHandle(this.client, crewNickname);

    this.listeners.onCrewBoarded?.({
      rsiHandle: crewNickname,
      matrixUserId,
      shipNetRoomId,
    });

    // If allowlisted, auto-invite (Task 10 handler)
    const allowed = this.serverEntry.scIntegration?.autoInviteAllowlist
      ?.some((h) => h.toLowerCase() === crewNickname.toLowerCase());
    if (allowed && matrixUserId) {
      try {
        await this.client.invite(shipNetRoomId, matrixUserId);
      } catch (err) {
        console.error("auto-invite failed:", err);
      }
    }
  }

  private async handleShipDestroyed(shipType: string): Promise<void> {
    if (!this.serverEntry.scIntegration?.autoCloseOnDestruction) return;
    const ownerNickname = this.watcher?.getLocalNickname();
    if (!ownerNickname) return;
    const shipNetRoomId = findShipNetByShip(this.client, shipType, ownerNickname);
    if (!shipNetRoomId) return;
    await this.engine.unmonitorNet(shipNetRoomId);
    // For v1 we just stop monitoring. Sending a tombstone + leaving is more
    // disruptive (other crew see the room disappear). v1.5 may add a settings
    // toggle "auto-tombstone on destruction".
    this.listeners.onShipNetClosed?.(shipNetRoomId);
  }
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/sc/ScIntegration.ts
git commit -m "client(sc): ScIntegration service wiring log events to Matrix actions"
```

---

## Task 9: Crew-boarding notification UI

**Files:**
- Create: `client/src/renderer/components/CrewBoardingToast.tsx`
- Modify: `client/src/renderer/screens/Home.tsx` (mount toast container + wire ScIntegration callbacks)

When `onCrewBoarded` fires and the crew member is NOT on the allowlist, show a toast at the top of the Home screen with:
- "🚢 W4RB0SS boarded your Anvil Asgard"
- Button: "Invite to net" (immediate one-click)
- Button: "Add to allowlist" (adds to allowlist + invites)
- Button: "Ignore"

If `matrixUserId` is null (no Hailfreq account / no CitizenID profile published), show the boarding event but disable "Invite" and explain.

- [ ] **Step 1: Write `client/src/renderer/components/CrewBoardingToast.tsx`**

```tsx
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";

export interface CrewBoardingToastProps {
  client: MatrixClient;
  rsiHandle: string;
  matrixUserId: string | null;
  shipNetRoomId: string;
  shipType: string;
  onDismiss: () => void;
  onAddToAllowlist: (rsiHandle: string) => Promise<void>;
}

export function CrewBoardingToast({
  client,
  rsiHandle,
  matrixUserId,
  shipNetRoomId,
  shipType,
  onDismiss,
  onAddToAllowlist,
}: CrewBoardingToastProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    if (!matrixUserId) return;
    setBusy(true);
    setError(null);
    try {
      await client.invite(shipNetRoomId, matrixUserId);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAllowlistAndInvite() {
    if (!matrixUserId) return;
    setBusy(true);
    setError(null);
    try {
      await onAddToAllowlist(rsiHandle);
      await client.invite(shipNetRoomId, matrixUserId);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-brand-700 bg-slate-900 p-3 shadow-lg">
      <p className="text-sm">
        🚢 <strong>{rsiHandle}</strong> boarded your {shipType}
      </p>
      {!matrixUserId && (
        <p className="mt-1 text-xs text-slate-500">
          No Hailfreq account found (not signed in with CitizenID).
        </p>
      )}
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={handleInvite} disabled={!matrixUserId || busy}>
          Invite to net
        </Button>
        <Button variant="ghost" onClick={handleAllowlistAndInvite} disabled={!matrixUserId || busy}>
          + Always invite
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={busy}>
          Ignore
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in Home.tsx**

Add a toast container in the Home header area. Wire `ScIntegration.on({ onCrewBoarded })` to push toasts. Stack up to 3 at a time; older toasts auto-dismiss after 30 seconds.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/CrewBoardingToast.tsx client/src/renderer/screens/Home.tsx
git commit -m "client(sc): crew-boarding toast with one-click invite + allowlist add"
```

---

## Task 10: SC integration settings panel

**Files:**
- Create: `client/src/renderer/screens/ScIntegrationSettings.tsx`
- Modify: `client/src/renderer/components/ServerContextMenu.tsx` (add "Star Citizen integration…" menu item)

A modal settings panel reached from the server context menu. Lets the user:
- Toggle "Watch Game.log for this server"
- View/change the Game.log path (with "Browse…" file picker + "Auto-detect" button)
- Manage the allowlist (add/remove RSI handles for auto-invite)
- Toggle "Auto-close ship-net on destruction"

- [ ] **Step 1: Write `ScIntegrationSettings.tsx`**

Standard modal form with the four controls. Uses the IPC channels added in Task 1 for path discovery.

- [ ] **Step 2: Add "Star Citizen integration…" menu item to ServerContextMenu**

Between "Notifications" and "Remove", add a button that opens the settings modal for the selected server.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/ScIntegrationSettings.tsx client/src/renderer/components/ServerContextMenu.tsx
git commit -m "client(sc): per-server Star Citizen integration settings panel"
```

---

## Task 11: Wire ScIntegration into AppState

**Files:**
- Modify: `client/src/renderer/AppState.tsx`

When a server is signed in AND `scIntegration.enabled` AND `settings.scInstallPath` is set, instantiate an `ScIntegration` for that server. Tear down when the server is removed or scIntegration is disabled.

- [ ] **Step 1: Add ScIntegration lifecycle in AppState**

Track `Map<serverId, ScIntegration>`. In a useEffect keyed on the signed-in clients + scInstallPath + per-server enable flag, start/stop ScIntegration instances. Mirror the existing pattern for verification subscriptions.

When `onCrewBoarded` fires, append to a `crewBoardingToasts` array in state. The Home screen renders these via CrewBoardingToast.

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx
git commit -m "client(sc): wire ScIntegration into AppState per-server lifecycle"
```

---

## Task 12: Ship-net visual treatment in NetListPanel

**Files:**
- Modify: `client/src/renderer/components/NetRow.tsx`
- Modify: `client/src/renderer/components/NetListPanel.tsx`

Ship-nets get a 🚢 icon prefix and a subtle "ship-net" style (different border accent) to distinguish them from regular nets. Also: ship-nets get a separator "Ships" header in the list.

- [ ] **Step 1: Detect ship-net status via `isShipNet`** from Task 5

Pass an `isShipNet: boolean` flag to NetRow. Render the 🚢 prefix and use a different border color.

- [ ] **Step 2: Group ship-nets at the top of the list with a "Ships" label**

In NetListPanel, sort nets: ship-nets first (sorted by name), then regular nets.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/NetRow.tsx client/src/renderer/components/NetListPanel.tsx
git commit -m "client(sc): visual distinction for ship-nets (🚢 icon + grouping)"
```

---

## Task 13: Vitest unit tests for the parser

**Files:**
- Create: `client/tests/unit/scParser.test.ts`

Test the four parser patterns against real log line examples (the ones the operator provided):

```ts
import { describe, it, expect } from "vitest";
import { parseLine } from "@/renderer/sc/parser";

describe("parseLine", () => {
  it("parses login event", () => {
    const line = `<2026-05-28T23:10:18.519Z> [Notice] <Expect Incoming Connection> session=319d8f64a48e484537d0405fb9f49c59 node_id=00000000-0000-0000-0000-00000061ee59 nickname="Rocktato" playerGEID=204741507615 [Team_Network][Network][Gateway]`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "login",
      timestamp: "2026-05-28T23:10:18.519Z",
      nickname: "Rocktato",
      geid: "204741507615",
    });
  });

  it("parses you-joined-channel event", () => {
    const line = `<2026-05-28T23:16:57.612Z> [Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'Anvil Asgard : Rocktato'.`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "you-joined-channel",
      timestamp: "2026-05-28T23:16:57.612Z",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });

  it("parses other-joined-channel event", () => {
    const line = `<2026-05-29T00:09:29.495Z> W4RB0SS has joined the channel 'Anvil Asgard : Rocktato'.`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "other-joined-channel",
      timestamp: "2026-05-29T00:09:29.495Z",
      player: "W4RB0SS",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });

  it("returns null for unrelated lines", () => {
    expect(parseLine("some unrelated log line")).toBeNull();
    expect(parseLine("")).toBeNull();
  });
});
```

- [ ] **Step 1: Run + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run 2>&1 | tail -10
# Expect: 29 previous + 4 new = 33 tests passing
```

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/scParser.test.ts
git commit -m "client(test): vitest unit tests for SC log parser against real log lines"
```

---

## Task 14: Rebuild installers + smoke test

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
ls -lh release/Hailfreq-*
```

No commit unless something broke.

---

## Task 15: README + spec note

- [ ] **Step 1: Add to `client/README.md`**:

```markdown
- Star Citizen integration: auto-create ship-nets when you board your ship, detect crew boarding via Game.log, one-click invite with CitizenID-verified RSI handle lookup, auto-close on destruction
```

- [ ] **Step 2: Add a new §10 to the spec** at `docs/superpowers/specs/2026-05-26-hailfreq-design.md` describing the Star Citizen integration as a Hailfreq-specific feature beyond the original spec scope.

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/
git commit -m "docs: Star Citizen integration shipped (Plan 7) — Game.log + ship-nets + CitizenID lookup"
```

---

## Done

After Task 15, the deliverable is:

- Cross-platform Game.log discovery (Windows + Linux Wine prefixes + manual override)
- Log tailer with append + rotation handling
- Event parser anchored against three confirmed event formats + best-effort destruction parser
- ScIntegration service: auto-create ship-net on own ship boarding, crew-boarding detection, optional auto-invite with allowlist
- Per-server SC integration settings (opt-in, with allowlist + path config)
- Ship-net visual distinction in NetListPanel
- Crew-boarding toast with one-click invite
- 4 new unit tests + builds
- Privacy-preserving: opt-in per server, no cross-client coordination, no telemetry

**Known v1 limitations:**
- Ship destruction parser is best-effort; will likely need refinement on first real ship loss
- "You boarding someone else's ship" (auto-join their net) is out of scope per operator priority — could be added later by detecting `you-joined-channel` with owner != self and looking up via Matrix room directory
- Cross-server / cross-org ship coordination not supported (each Hailfreq server is independent)
- RSI handle lookup requires the crew member to have signed in with CitizenID AND opted into publishing their RSI handle to their Matrix profile (Plan 5 Task 14)

**Next plans:**

- **Plan 8** — Focused-app PTT + screen sharing + Net Bridges (~15 tasks)
- **v1.5 design phase** — Multi-server voice (architectural design first)
- **Refinement releases** — refine ship destruction parser against real data; expand event coverage (EVA, ground vehicles, jump events, etc.) based on operator feedback
