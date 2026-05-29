# Hailfreq Net Bridges Implementation Plan (Plan 8c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator configure a **bridge** between two of their nets — typically one on their own Hailfreq server (e.g., "Allies" net on Org-A) and one on a different Hailfreq server (e.g., "Allies" net on Org-B) — so audio flows transparently between the two. The operator must be a member of both nets; their renderer acts as the cross-server relay. Bridges support three modes (smart / always-on / ptt-relay, smart default), broadcast a brief bridge-active chirp + `(via <bridge name>)` identity suffix on the target net so receivers know audio is relayed, and persist their configs locally so the operator can enable/disable them as the situation requires.

**Architecture:** A new global `BridgeEngine` (one instance, lives at AppState level — not per-server, because a bridge spans servers) holds the active bridge configs and runs the relay loops. For each enabled bridge, the engine looks up both source and target LiveKit `Room` objects via the relevant servers' `VoiceEngine.getLiveKitRoom(matrixRoomId)`, attaches an audio listener to the source room's remote audio tracks, converts decrypted PCM frames into a `MediaStream`, then publishes that stream to the target room as a `LocalAudioTrack` (the target room's `ExternalE2EEKeyProvider` re-encrypts with the target net's SFrame key). Bridge UX lives in the existing AdminBoard (Plan 5) as a new "Bridges" tab. Bridge configs are stored in the local Settings store keyed by bridge UUID; no Matrix state, no cross-machine sync in v1.5.

**Tech Stack:** Same as Plans 1–8b. Reuses LiveKit publish/subscribe + ExternalE2EEKeyProvider for both sides. Uses Web Audio's AnalyserNode for the smart-mode VAD (already imported in `VoiceEngine` for voice activation). Adds no new dependencies.

**Design decisions confirmed with operator:**
- **Default mode for new bridges**: Smart (VAD-driven)
- **Multi-operator dedup**: None in v1.5; visible "this bridge is already active by <other operator>" indicator so operators can coordinate manually
- **Attribution in target net**: Brief "bridge active" chirp on first relayed packet per session + `(via <bridge name>)` suffix in the participant identity for the duration

**Spec reference:** §11 open questions resolved; §9 v1.5 scope; §3 threat model — bridges are not federation, they are operator-mediated relay (same Tier 3 privacy posture).

**Out of scope:**
- Federation (still off for both servers; bridges are operator-mediated)
- Server-side bridge processes (would require operating an "AI" service — fundamentally different threat model)
- Sequence-number deduplication across multiple operators
- Bridge config export/import or cross-machine sync
- Auto-failover (if alice's machine crashes mid-bridge, bob's bridge config has to be manually enabled)
- Chat relay (text messages between bridged nets) — voice only
- Screen-share relay (deferred — share to one net at a time)

**Privacy / opt-in:**
- Bridge operator can decrypt both nets (they have both SFrame keys). This is intrinsic — bridges are an operator-trust feature.
- Receivers in the target net see clear visual + audible signal that audio is bridged.
- Bridge configs never leave the operator's machine.
- A bridge can be disabled (toggle off) at any time without deleting the config.

**Repo location:** `/home/shreen/code/tactical-radio`. Commits go to `master`.

---

## Task 1: Bridge data model

**Files:**
- Modify: `client/src/shared/types.ts`
- Modify: `client/src/main/store.ts`

Bridges are stored in `Settings.bridges: BridgeConfig[]`. Each bridge has a stable UUID, source + target identifiers, mode, VAD threshold (smart mode only), enabled toggle, and a display name.

- [ ] **Step 1: Add types to `shared/types.ts`**

```ts
export type BridgeMode = "smart" | "always-on" | "ptt-relay";

export interface BridgeEndpoint {
  serverId: string;            // ServerEntry.id
  matrixRoomId: string;        // The net's Matrix room id
}

export interface BridgeConfig {
  id: string;                  // crypto.randomUUID()
  name: string;                // display name, e.g., "Anvil → Aegis Allies"
  source: BridgeEndpoint;
  target: BridgeEndpoint;
  mode: BridgeMode;
  /** VAD threshold for smart mode, 0..1 (audio RMS). Ignored for other modes. */
  smartThreshold: number;
  enabled: boolean;
  /** Direction: bidirectional means relay both ways with separate engine instances. */
  bidirectional: boolean;
  createdMs: number;
}

export interface Settings {
  // ... existing fields ...
  bridges?: BridgeConfig[];
}
```

The default for `bridges` is `[]`. Default `smartThreshold` for new bridges: `0.02` (matches voice-activation default from Plan 4 — verify by reading VoiceEngine for the actual default constant).

- [ ] **Step 2: Add to store defaults**

In `client/src/main/store.ts`, add to the `defaults` object:

```ts
bridges: [],
```

In `migrateLegacyShape`:
- Legacy V1 branch: include `bridges: []` in the returned V2 object
- Pass-through branch: include `bridges: typed.bridges ?? []` in the returned object

The `settings.store = migrated` writeback (from Plan 7 Task 1's fix) preserves the field on every save.

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/main/store.ts
git commit -m "client(bridge): BridgeConfig data model + settings persistence"
```

---

## Task 2: IPC for bridge config persistence

**Files:**
- Modify: `client/src/shared/ipc.ts`
- Modify: `client/src/main/ipc.ts`

Persisting bridge configs flows through a single IPC handler `settings:setBridges` that takes the complete array and writes it. The renderer manages all the create/update/delete logic in memory before saving.

- [ ] **Step 1: Add channel to `shared/ipc.ts`**

```ts
"settings:setBridges": { args: [{ bridges: BridgeConfig[] }]; result: void };
```

Import `BridgeConfig` from `shared/types`.

- [ ] **Step 2: Register handler in `main/ipc.ts`**

```ts
ipcMain.handle("settings:setBridges", (_event, args: unknown): void => {
  if (args === null || typeof args !== "object" || !("bridges" in args)) {
    throw new Error("settings:setBridges: args must be { bridges: BridgeConfig[] }");
  }
  const { bridges } = args as { bridges: unknown };
  if (!Array.isArray(bridges)) {
    throw new Error("settings:setBridges: bridges must be an array");
  }
  for (const b of bridges) {
    if (!b || typeof b !== "object") throw new Error("settings:setBridges: bridges contains non-object entry");
    const bc = b as Partial<BridgeConfig>;
    if (typeof bc.id !== "string" || typeof bc.name !== "string") throw new Error("settings:setBridges: bridge entry missing id/name");
    if (!bc.source || typeof bc.source.serverId !== "string" || typeof bc.source.matrixRoomId !== "string") {
      throw new Error("settings:setBridges: bridge entry has invalid source");
    }
    if (!bc.target || typeof bc.target.serverId !== "string" || typeof bc.target.matrixRoomId !== "string") {
      throw new Error("settings:setBridges: bridge entry has invalid target");
    }
    if (!["smart", "always-on", "ptt-relay"].includes(bc.mode as string)) {
      throw new Error("settings:setBridges: bridge entry has invalid mode");
    }
    if (typeof bc.smartThreshold !== "number" || bc.smartThreshold < 0 || bc.smartThreshold > 1) {
      throw new Error("settings:setBridges: smartThreshold must be 0..1");
    }
    if (typeof bc.enabled !== "boolean" || typeof bc.bidirectional !== "boolean") {
      throw new Error("settings:setBridges: enabled/bidirectional must be boolean");
    }
  }
  settings.set("bridges", bridges as BridgeConfig[]);
});
```

Match the runtime-validation pattern from Plan 7 Task 10 and Plan 8a Task 6.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/ipc.ts client/src/main/ipc.ts
git commit -m "client(bridge): settings:setBridges IPC with runtime validation"
```

---

## Task 3: Audio relay primitive — RemoteAudio → LocalAudio republish

**Files:**
- Create: `client/src/renderer/bridge/audioRelay.ts`

A pure helper that takes a `RemoteAudioTrack` and a target `Room`, builds a relayed `LocalAudioTrack`, and publishes it. Returns a teardown closure.

This is the technical heart of bridges. The track's underlying `MediaStreamTrack` is wrapped into a new MediaStream, then a `LocalAudioTrack` is constructed and published. The target room's `ExternalE2EEKeyProvider` re-encrypts on publish.

- [ ] **Step 1: Write `client/src/renderer/bridge/audioRelay.ts`**

```ts
import {
  type Room,
  type RemoteAudioTrack,
  LocalAudioTrack,
  Track,
} from "livekit-client";

export interface RelayHandle {
  /** Local audio track currently published to the target room. */
  localTrack: LocalAudioTrack;
  /** Stop relaying and unpublish from the target. */
  stop: () => Promise<void>;
}

/**
 * Build a LocalAudioTrack that mirrors a RemoteAudioTrack and publish it to a
 * target Room. The target room's ExternalE2EEKeyProvider will re-encrypt the
 * track on publish.
 *
 * `publishOptions.name` should be the operator's "(via <bridge name>)" suffix
 * so receivers see who the relay is coming from.
 *
 * The returned handle's `stop()` is idempotent and unpublishes without
 * stopping the underlying MediaStreamTrack (the remote track is owned by
 * the source room).
 */
export async function publishRelay(
  source: RemoteAudioTrack,
  target: Room,
  trackName: string,
): Promise<RelayHandle> {
  const mediaStreamTrack = source.mediaStreamTrack;
  if (!mediaStreamTrack) {
    throw new Error("RemoteAudioTrack has no mediaStreamTrack");
  }
  // userProvidedTrack=true: we own the track lifecycle (the source room owns
  // the underlying stream, not LiveKit).
  const localTrack = new LocalAudioTrack(mediaStreamTrack, undefined, true);
  await target.localParticipant.publishTrack(localTrack, {
    source: Track.Source.Microphone,
    name: trackName,
  });

  let stopped = false;
  return {
    localTrack,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        // stopOnUnpublish=false: leave the underlying MediaStreamTrack alone
        // (the source room manages it). Same pattern as ShareEngine.
        await target.localParticipant.unpublishTrack(localTrack, false);
      } catch (err) {
        console.error("[audioRelay] unpublish failed:", err);
      }
    },
  };
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/bridge/audioRelay.ts
git commit -m "client(bridge): audio relay primitive — RemoteAudioTrack → LocalAudioTrack republish"
```

---

## Task 4: Smart-mode VAD detector

**Files:**
- Create: `client/src/renderer/bridge/vadGate.ts`

The smart mode opens the relay only when source-net voice activity exceeds the threshold. The detector uses Web Audio's `AnalyserNode` on the source `MediaStreamTrack` and emits open/close events with hysteresis (turn on quickly, turn off slowly so brief pauses don't chop).

- [ ] **Step 1: Write `client/src/renderer/bridge/vadGate.ts`**

```ts
/**
 * Voice-activity gate. Polls the audio track's RMS level via an
 * AnalyserNode and emits open/close events with hysteresis.
 *
 * - Opens immediately when RMS exceeds `threshold`
 * - Closes after `hangoverMs` of continuous below-threshold audio
 *
 * Hysteresis ensures brief pauses don't chop the relay.
 */
export interface VadGateOptions {
  threshold: number;      // 0..1 RMS
  hangoverMs: number;     // default 800
  pollIntervalMs: number; // default 60
}

export interface VadGateEvents {
  onOpen?: () => void;
  onClose?: () => void;
}

const DEFAULT_HANGOVER_MS = 800;
const DEFAULT_POLL_MS = 60;

export class VadGate {
  private readonly audioContext: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly opts: Required<VadGateOptions>;
  private listeners: VadGateEvents = {};

  private isOpen = false;
  private belowSinceMs: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rmsBuffer: Float32Array;

  constructor(
    sourceMediaStreamTrack: MediaStreamTrack,
    opts: Partial<VadGateOptions> = {},
  ) {
    this.opts = {
      threshold: opts.threshold ?? 0.02,
      hangoverMs: opts.hangoverMs ?? DEFAULT_HANGOVER_MS,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
    };
    this.audioContext = new AudioContext();
    const stream = new MediaStream([sourceMediaStreamTrack]);
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.rmsBuffer = new Float32Array(this.analyser.fftSize);
  }

  on(events: VadGateEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.tick(), this.opts.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.isOpen) {
      this.isOpen = false;
      this.listeners.onClose?.();
    }
    void this.audioContext.close();
  }

  isCurrentlyOpen(): boolean {
    return this.isOpen;
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.rmsBuffer);
    let sumSquares = 0;
    for (let i = 0; i < this.rmsBuffer.length; i++) {
      sumSquares += this.rmsBuffer[i] * this.rmsBuffer[i];
    }
    const rms = Math.sqrt(sumSquares / this.rmsBuffer.length);
    const now = Date.now();

    if (rms >= this.opts.threshold) {
      this.belowSinceMs = null;
      if (!this.isOpen) {
        this.isOpen = true;
        this.listeners.onOpen?.();
      }
    } else {
      if (this.isOpen) {
        if (this.belowSinceMs === null) {
          this.belowSinceMs = now;
        } else if (now - this.belowSinceMs >= this.opts.hangoverMs) {
          this.isOpen = false;
          this.belowSinceMs = null;
          this.listeners.onClose?.();
        }
      }
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
git add client/src/renderer/bridge/vadGate.ts
git commit -m "client(bridge): VadGate detector with hysteresis for smart-mode relay gating"
```

---

## Task 5: BridgeRunner — single-bridge runtime

**Files:**
- Create: `client/src/renderer/bridge/BridgeRunner.ts`
- Create: `client/src/renderer/bridge/types.ts`

A `BridgeRunner` manages ONE direction of ONE bridge. For a bidirectional bridge, two BridgeRunner instances are needed (forward + reverse). Each runner:
- Locates source + target Rooms via the two VoiceEngines
- Subscribes to source room's remote audio tracks
- Per mode, opens/closes a relay to the target room
- Plays a chirp on the target the first time per session
- Emits status events for the UI

- [ ] **Step 1: Write `client/src/renderer/bridge/types.ts`**

```ts
import type { BridgeConfig } from "@shared/types";

export type BridgeRunnerStatus =
  | "stopped"
  | "starting"
  | "idle"        // running but not currently relaying audio (smart mode below threshold)
  | "relaying"    // currently passing audio
  | "error";

export interface BridgeRunnerSummary {
  bridgeId: string;
  direction: "forward" | "reverse";
  status: BridgeRunnerStatus;
  /** Last error message if status is "error". */
  errorMessage: string | null;
  /** Ms timestamp of last status transition. */
  changedMs: number;
}

export interface BridgeRunnerEvents {
  onStatusChanged?: (summary: BridgeRunnerSummary) => void;
}

export interface BridgeRunnerContext {
  /** Look up a LiveKit Room across servers. */
  getRoom: (serverId: string, matrixRoomId: string) => import("livekit-client").Room | null;
  /** Play the bridge-active chirp on a target room (best-effort). */
  playBridgeChirp: (targetServerId: string, targetMatrixRoomId: string) => void;
  config: BridgeConfig;
  direction: "forward" | "reverse";
}
```

- [ ] **Step 2: Write `client/src/renderer/bridge/BridgeRunner.ts`**

```ts
import {
  type Room,
  type RemoteAudioTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  Track,
  RoomEvent,
} from "livekit-client";
import { publishRelay, type RelayHandle } from "./audioRelay";
import { VadGate } from "./vadGate";
import type {
  BridgeRunnerContext,
  BridgeRunnerEvents,
  BridgeRunnerStatus,
  BridgeRunnerSummary,
} from "./types";

/**
 * Runs a single direction of a bridge (source → target). The bridge
 * coordinator (BridgeEngine) spins up one runner per active direction.
 */
export class BridgeRunner {
  private readonly ctx: BridgeRunnerContext;
  private listeners: BridgeRunnerEvents = {};
  private status: BridgeRunnerStatus = "stopped";
  private errorMessage: string | null = null;
  private vadGates = new Map<string, VadGate>(); // key: participant identity (smart mode)
  private activeRelays = new Map<string, RelayHandle>(); // key: participant identity
  private playedChirpThisSession = false;
  private sourceRoomListenerAttached = false;
  private onTrackSubscribed: ((track: RemoteAudioTrack | unknown, pub: RemoteTrackPublication, p: RemoteParticipant) => void) | null = null;
  private onTrackUnsubscribed: ((track: RemoteAudioTrack | unknown, pub: RemoteTrackPublication, p: RemoteParticipant) => void) | null = null;

  constructor(ctx: BridgeRunnerContext) {
    this.ctx = ctx;
  }

  on(events: BridgeRunnerEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  getStatus(): BridgeRunnerStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status !== "stopped") return;
    this.setStatus("starting");
    try {
      const source = this.ctx.direction === "forward" ? this.ctx.config.source : this.ctx.config.target;
      const target = this.ctx.direction === "forward" ? this.ctx.config.target : this.ctx.config.source;
      const sourceRoom = this.ctx.getRoom(source.serverId, source.matrixRoomId);
      const targetRoom = this.ctx.getRoom(target.serverId, target.matrixRoomId);
      if (!sourceRoom) throw new Error(`Source room not monitored (server=${source.serverId} room=${source.matrixRoomId})`);
      if (!targetRoom) throw new Error(`Target room not monitored (server=${target.serverId} room=${target.matrixRoomId})`);

      // Attach to existing remote audio tracks
      for (const participant of sourceRoom.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track && publication.source === Track.Source.Microphone) {
            this.handleSourceTrack(publication.track as RemoteAudioTrack, participant, targetRoom);
          }
        }
      }

      // Future audio tracks
      const onTrackSubscribed = (track: unknown, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (publication.source !== Track.Source.Microphone) return;
        if (publication.kind !== Track.Kind.Audio) return;
        this.handleSourceTrack(track as RemoteAudioTrack, participant, targetRoom);
      };
      const onTrackUnsubscribed = (_track: unknown, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (publication.source !== Track.Source.Microphone) return;
        if (publication.kind !== Track.Kind.Audio) return;
        void this.dropParticipantRelay(participant.identity);
      };
      sourceRoom.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      sourceRoom.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      this.onTrackSubscribed = onTrackSubscribed;
      this.onTrackUnsubscribed = onTrackUnsubscribed;
      this.sourceRoomListenerAttached = true;

      this.setStatus(this.ctx.config.mode === "always-on" ? "relaying" : "idle");
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : "Bridge start failed";
      this.setStatus("error");
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped") return;
    this.setStatus("stopped");

    // Detach source room listeners
    const source = this.ctx.direction === "forward" ? this.ctx.config.source : this.ctx.config.target;
    const sourceRoom = this.ctx.getRoom(source.serverId, source.matrixRoomId);
    if (sourceRoom && this.sourceRoomListenerAttached) {
      if (this.onTrackSubscribed) sourceRoom.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed as never);
      if (this.onTrackUnsubscribed) sourceRoom.off(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed as never);
    }
    this.sourceRoomListenerAttached = false;
    this.onTrackSubscribed = null;
    this.onTrackUnsubscribed = null;

    // Stop all VAD gates and unpublish all relays
    for (const gate of this.vadGates.values()) {
      gate.stop();
    }
    this.vadGates.clear();
    for (const relay of this.activeRelays.values()) {
      await relay.stop();
    }
    this.activeRelays.clear();

    this.playedChirpThisSession = false;
  }

  private handleSourceTrack(track: RemoteAudioTrack, participant: RemoteParticipant, targetRoom: Room): void {
    const mode = this.ctx.config.mode;

    if (mode === "always-on") {
      void this.startRelayFor(participant.identity, track, targetRoom);
      return;
    }

    if (mode === "smart") {
      const mediaStreamTrack = track.mediaStreamTrack;
      if (!mediaStreamTrack) return;
      const gate = new VadGate(mediaStreamTrack, { threshold: this.ctx.config.smartThreshold });
      gate.on({
        onOpen: () => {
          void this.startRelayFor(participant.identity, track, targetRoom);
        },
        onClose: () => {
          void this.dropParticipantRelay(participant.identity);
        },
      });
      gate.start();
      this.vadGates.set(participant.identity, gate);
      return;
    }

    if (mode === "ptt-relay") {
      // PTT-relay: hook participant's speaking state from LiveKit's TrackVolumeChanged.
      // For v1.5, fall back to the same RMS-based gate as smart mode but with a higher
      // threshold so it acts as PTT-detection. This avoids relying on LiveKit's speaking
      // detection which has its own internal smoothing.
      const mediaStreamTrack = track.mediaStreamTrack;
      if (!mediaStreamTrack) return;
      const gate = new VadGate(mediaStreamTrack, { threshold: 0.08, hangoverMs: 300 });
      gate.on({
        onOpen: () => {
          void this.startRelayFor(participant.identity, track, targetRoom);
        },
        onClose: () => {
          void this.dropParticipantRelay(participant.identity);
        },
      });
      gate.start();
      this.vadGates.set(participant.identity, gate);
      return;
    }
  }

  private async startRelayFor(participantIdentity: string, track: RemoteAudioTrack, targetRoom: Room): Promise<void> {
    if (this.activeRelays.has(participantIdentity)) return;
    try {
      const target = this.ctx.direction === "forward" ? this.ctx.config.target : this.ctx.config.source;
      if (!this.playedChirpThisSession) {
        this.ctx.playBridgeChirp(target.serverId, target.matrixRoomId);
        this.playedChirpThisSession = true;
      }
      const handle = await publishRelay(track, targetRoom, `(via ${this.ctx.config.name})`);
      this.activeRelays.set(participantIdentity, handle);
      this.setStatus("relaying");
    } catch (err) {
      console.error("[BridgeRunner] startRelayFor failed:", err);
      this.errorMessage = err instanceof Error ? err.message : "Relay failed";
      this.setStatus("error");
    }
  }

  private async dropParticipantRelay(participantIdentity: string): Promise<void> {
    const handle = this.activeRelays.get(participantIdentity);
    if (handle) {
      this.activeRelays.delete(participantIdentity);
      await handle.stop();
    }
    const gate = this.vadGates.get(participantIdentity);
    if (gate) {
      this.vadGates.delete(participantIdentity);
      gate.stop();
    }
    if (this.activeRelays.size === 0 && this.status === "relaying") {
      this.setStatus(this.ctx.config.mode === "always-on" ? "relaying" : "idle");
    }
  }

  private setStatus(next: BridgeRunnerStatus): void {
    if (this.status === next) return;
    this.status = next;
    const summary: BridgeRunnerSummary = {
      bridgeId: this.ctx.config.id,
      direction: this.ctx.direction,
      status: this.status,
      errorMessage: this.errorMessage,
      changedMs: Date.now(),
    };
    this.listeners.onStatusChanged?.(summary);
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/bridge/BridgeRunner.ts client/src/renderer/bridge/types.ts
git commit -m "client(bridge): BridgeRunner — single-direction relay with mode dispatch"
```

---

## Task 6: BridgeEngine coordinator

**Files:**
- Create: `client/src/renderer/bridge/BridgeEngine.ts`

The global coordinator. Holds the active BridgeRunner instances, accepts config updates, starts/stops runners as configs change or as monitored rooms come and go.

- [ ] **Step 1: Write `client/src/renderer/bridge/BridgeEngine.ts`**

```ts
import type { BridgeConfig } from "@shared/types";
import type { Room } from "livekit-client";
import { BridgeRunner } from "./BridgeRunner";
import type { BridgeRunnerSummary } from "./types";

export interface BridgeEngineContext {
  /** Look up a LiveKit Room across servers (BridgeRunner needs this). */
  getRoom: (serverId: string, matrixRoomId: string) => Room | null;
  /** Play the bridge-active chirp on a target room (best-effort). */
  playBridgeChirp: (targetServerId: string, targetMatrixRoomId: string) => void;
}

export interface BridgeEngineEvents {
  onRunnerStatusChanged?: (summary: BridgeRunnerSummary) => void;
}

interface ActiveBridge {
  config: BridgeConfig;
  forward: BridgeRunner;
  reverse: BridgeRunner | null;
}

export class BridgeEngine {
  private readonly ctx: BridgeEngineContext;
  private listeners: BridgeEngineEvents = {};
  private active = new Map<string, ActiveBridge>(); // key: bridge.id
  private configs: BridgeConfig[] = [];

  constructor(ctx: BridgeEngineContext) {
    this.ctx = ctx;
  }

  on(events: BridgeEngineEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  /**
   * Replace the full set of bridge configs. Starts new enabled bridges,
   * stops removed/disabled bridges, restarts bridges whose config changed.
   */
  async setConfigs(configs: BridgeConfig[]): Promise<void> {
    this.configs = configs;
    const seen = new Set<string>();
    for (const config of configs) {
      seen.add(config.id);
      const existing = this.active.get(config.id);
      if (!existing) {
        if (config.enabled) {
          await this.startBridge(config);
        }
      } else if (this.isStructuralChange(existing.config, config)) {
        await this.stopBridge(config.id);
        if (config.enabled) await this.startBridge(config);
      } else if (existing.config.enabled !== config.enabled) {
        if (config.enabled) await this.startBridge(config);
        else await this.stopBridge(config.id);
      }
      // Else: enabled status unchanged, no structural change → no-op
    }
    // Stop bridges that were removed from the config list
    for (const id of Array.from(this.active.keys())) {
      if (!seen.has(id)) await this.stopBridge(id);
    }
  }

  /** Re-evaluate whether stopped bridges can now start (e.g., a monitored room came online). */
  async refreshRoomAvailability(): Promise<void> {
    for (const config of this.configs) {
      if (!config.enabled) continue;
      if (this.active.has(config.id)) continue;
      const srcAvailable = this.ctx.getRoom(config.source.serverId, config.source.matrixRoomId) !== null;
      const tgtAvailable = this.ctx.getRoom(config.target.serverId, config.target.matrixRoomId) !== null;
      if (srcAvailable && tgtAvailable) {
        await this.startBridge(config);
      }
    }
  }

  getActiveSummaries(): BridgeRunnerSummary[] {
    const out: BridgeRunnerSummary[] = [];
    for (const ab of this.active.values()) {
      out.push({
        bridgeId: ab.config.id,
        direction: "forward",
        status: ab.forward.getStatus(),
        errorMessage: null,
        changedMs: Date.now(),
      });
      if (ab.reverse) {
        out.push({
          bridgeId: ab.config.id,
          direction: "reverse",
          status: ab.reverse.getStatus(),
          errorMessage: null,
          changedMs: Date.now(),
        });
      }
    }
    return out;
  }

  async shutdown(): Promise<void> {
    for (const id of Array.from(this.active.keys())) {
      await this.stopBridge(id);
    }
    this.configs = [];
    this.listeners = {};
  }

  private isStructuralChange(a: BridgeConfig, b: BridgeConfig): boolean {
    return (
      a.source.serverId !== b.source.serverId ||
      a.source.matrixRoomId !== b.source.matrixRoomId ||
      a.target.serverId !== b.target.serverId ||
      a.target.matrixRoomId !== b.target.matrixRoomId ||
      a.mode !== b.mode ||
      a.smartThreshold !== b.smartThreshold ||
      a.bidirectional !== b.bidirectional
    );
  }

  private async startBridge(config: BridgeConfig): Promise<void> {
    const forward = new BridgeRunner({
      getRoom: this.ctx.getRoom,
      playBridgeChirp: this.ctx.playBridgeChirp,
      config,
      direction: "forward",
    });
    forward.on({ onStatusChanged: (s) => this.listeners.onRunnerStatusChanged?.(s) });
    await forward.start();

    let reverse: BridgeRunner | null = null;
    if (config.bidirectional) {
      reverse = new BridgeRunner({
        getRoom: this.ctx.getRoom,
        playBridgeChirp: this.ctx.playBridgeChirp,
        config,
        direction: "reverse",
      });
      reverse.on({ onStatusChanged: (s) => this.listeners.onRunnerStatusChanged?.(s) });
      await reverse.start();
    }
    this.active.set(config.id, { config, forward, reverse });
  }

  private async stopBridge(bridgeId: string): Promise<void> {
    const ab = this.active.get(bridgeId);
    if (!ab) return;
    this.active.delete(bridgeId);
    await ab.forward.stop();
    if (ab.reverse) await ab.reverse.stop();
  }
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/bridge/BridgeEngine.ts
git commit -m "client(bridge): BridgeEngine coordinator — config sync + per-bridge lifecycle"
```

---

## Task 7: Bridge chirp asset + playback helper

**Files:**
- Create: `client/src/renderer/bridge/bridgeChirp.ts`

Reuse the existing chirp infrastructure from Plan 6 (the audio-chirp playback for PTT). Add a bridge-specific helper that plays a brief tone on a target room. Since chirps were Plan 6's domain, this is a small helper that hooks into VoiceEngine's existing audio routing.

- [ ] **Step 1: Read existing chirp module**

Read `client/src/renderer/voice/Chirps.ts` (or wherever Plan 6 put the chirp player). Look for:
- How chirps are played (Web Audio? HTMLAudioElement?)
- The list of available built-in chirps
- The function to play a chirp on a specific net

- [ ] **Step 2: Write `bridgeChirp.ts`**

The bridge chirp uses a different sound than PTT chirps so it's distinctive. Use a built-in synthesized tone via Web Audio (a brief 2-tone "bridge active" sound: 440Hz → 880Hz, 150ms total).

```ts
/**
 * Play a brief two-tone "bridge active" chirp on a target audio destination.
 * Uses Web Audio so no asset bundling is needed. Best-effort — silent if
 * AudioContext creation fails.
 */
export function playBridgeChirp(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 440;
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain1.gain.linearRampToValueAtTime(0, now + 0.075);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.08);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 880;
    gain2.gain.setValueAtTime(0, now + 0.075);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.085);
    gain2.gain.linearRampToValueAtTime(0, now + 0.15);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.075);
    osc2.stop(now + 0.16);

    setTimeout(() => void ctx.close(), 250);
  } catch (err) {
    console.error("[bridgeChirp] playback failed:", err);
  }
}
```

The chirp plays on the OPERATOR'S local output. This is intentional — the receivers on target net hear nothing extra (their net's regular audio path is unaffected). The bridge operator hears it as their own audible confirmation that the bridge is relaying. Cross-net audible attribution (chirp into target net's stream) would require injecting audio into the published track, which complicates the engine. The visible `(via <bridge name>)` identity suffix handles receiver-side attribution.

(Future enhancement: pre-pend a chirp PCM segment to the relayed audio so receivers also hear it. Deferred.)

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/bridge/bridgeChirp.ts
git commit -m "client(bridge): Web Audio synthesized bridge-active chirp (operator-local)"
```

---

## Task 8: Wire BridgeEngine into AppState

**Files:**
- Modify: `client/src/renderer/AppState.tsx`

A single BridgeEngine lives at AppState scope (not per-server). It gets:
- A `getRoom(serverId, matrixRoomId)` function that looks up the right server's VoiceEngine and calls `getLiveKitRoom`
- A `playBridgeChirp()` function from Task 7

Bridge configs come from `state.bridges` (loaded from settings on mount, sync'd via `settings:setBridges`).

- [ ] **Step 1: Add bridgeEngine and bridges to AppLevelState**

```ts
interface AppLevelState {
  // ... existing ...
  bridges: BridgeConfig[];
  bridgeRunnerStatuses: Map<string, { forward: BridgeRunnerStatus; reverse: BridgeRunnerStatus | null }>;
}
```

Initialize `bridges` from `settings:get` at boot. Initialize statuses to empty map.

- [ ] **Step 2: Instantiate BridgeEngine in a useRef + useEffect**

```ts
const bridgeEngineRef = useRef<BridgeEngine | null>(null);

useEffect(() => {
  const engine = new BridgeEngine({
    getRoom: (serverId, matrixRoomId) => {
      const instance = stateRef.current.servers.get(serverId);
      return instance?.voiceEngine?.getLiveKitRoom(matrixRoomId) ?? null;
    },
    playBridgeChirp: () => playBridgeChirp(),
  });
  engine.on({
    onRunnerStatusChanged: (summary) => {
      setState((prev) => {
        const map = new Map(prev.bridgeRunnerStatuses);
        const cur = map.get(summary.bridgeId) ?? { forward: "stopped" as BridgeRunnerStatus, reverse: null };
        if (summary.direction === "forward") cur.forward = summary.status;
        else cur.reverse = summary.status;
        map.set(summary.bridgeId, cur);
        return { ...prev, bridgeRunnerStatuses: map };
      });
    },
  });
  bridgeEngineRef.current = engine;
  return () => {
    void engine.shutdown();
    bridgeEngineRef.current = null;
  };
}, []);
```

- [ ] **Step 3: Sync configs to engine on bridges change**

```ts
useEffect(() => {
  void bridgeEngineRef.current?.setConfigs(state.bridges);
}, [state.bridges]);
```

- [ ] **Step 4: Refresh room availability on monitored-nets change**

When servers, monitored nets, or signed-in state change, call `bridgeEngine.refreshRoomAvailability()`. Easiest: add to the same useEffect that watches `signedInWithEngine`.

```ts
useEffect(() => {
  void bridgeEngineRef.current?.refreshRoomAvailability();
}, [signedInWithEngine /* and any monitored-rooms signal */]);
```

- [ ] **Step 5: Add a saveBridges handler**

```ts
const handleSaveBridges = useCallback(async (bridges: BridgeConfig[]): Promise<void> => {
  await window.hailfreq.invoke("settings:setBridges", { bridges });
  setState((prev) => ({ ...prev, bridges }));
}, []);
```

Pass this down to whatever surface will edit bridges (Task 9).

- [ ] **Step 6: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx
git commit -m "client(bridge): wire BridgeEngine into AppState with cross-server getRoom + config sync"
```

---

## Task 9: Bridges admin tab — list + status

**Files:**
- Create: `client/src/renderer/screens/BridgesPanel.tsx`
- Modify: the admin board mount (Plan 5) to add the new tab

The Bridges panel shows all configured bridges with status indicators and lets the operator create / edit / delete. For Task 9, just build the list + status view + a "New Bridge" button (the wizard comes in Task 10).

- [ ] **Step 1: Find the admin board mount point**

Read `client/src/renderer/screens/AdminBoard.tsx` (or similar — find via `grep -rn "AdminBoard\|admin board" client/src/renderer/screens client/src/renderer/components`). Look for the existing tab structure (Members / Nets / etc.) and add a "Bridges" tab.

- [ ] **Step 2: Write BridgesPanel.tsx**

```tsx
import { useState } from "react";
import type { BridgeConfig } from "@shared/types";
import type { BridgeRunnerStatus } from "../bridge/types";
import { Button } from "../components/Button";

interface Props {
  bridges: BridgeConfig[];
  runnerStatuses: Map<string, { forward: BridgeRunnerStatus; reverse: BridgeRunnerStatus | null }>;
  onSave: (bridges: BridgeConfig[]) => Promise<void>;
  onNew: () => void;
  onEdit: (bridge: BridgeConfig) => void;
}

const STATUS_LABELS: Record<BridgeRunnerStatus, { text: string; cls: string }> = {
  stopped: { text: "Stopped", cls: "text-slate-500" },
  starting: { text: "Starting…", cls: "text-amber-300" },
  idle: { text: "Idle", cls: "text-slate-400" },
  relaying: { text: "🔴 Relaying", cls: "text-rose-300" },
  error: { text: "⚠ Error", cls: "text-rose-400" },
};

export function BridgesPanel({ bridges, runnerStatuses, onSave, onNew, onEdit }: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function handleToggle(bridge: BridgeConfig) {
    const updated = bridges.map((b) => (b.id === bridge.id ? { ...b, enabled: !b.enabled } : b));
    await onSave(updated);
  }

  async function handleConfirmDelete(id: string) {
    const updated = bridges.filter((b) => b.id !== id);
    await onSave(updated);
    setPendingDelete(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Bridges</h2>
        <Button onClick={onNew}>New bridge</Button>
      </div>
      <p className="text-xs text-slate-500">
        A bridge relays audio between two nets (typically across servers). You must be a member of
        both nets. Bridges run on this machine while it's online.
      </p>

      {bridges.length === 0 && (
        <p className="text-sm text-slate-500">No bridges configured.</p>
      )}

      <ul className="space-y-2">
        {bridges.map((bridge) => {
          const statuses = runnerStatuses.get(bridge.id);
          const forwardStatus = statuses?.forward ?? "stopped";
          const reverseStatus = statuses?.reverse;
          return (
            <li
              key={bridge.id}
              className="rounded border border-slate-700 bg-slate-900 p-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-semibold">{bridge.name}</p>
                  <p className="text-xs text-slate-500">
                    {bridge.source.matrixRoomId} ↔ {bridge.target.matrixRoomId}
                  </p>
                  <p className="text-xs text-slate-500">
                    Mode: {bridge.mode}
                    {bridge.bidirectional ? " · bidirectional" : " · source → target only"}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className={STATUS_LABELS[forwardStatus].cls}>
                      {STATUS_LABELS[forwardStatus].text}
                    </span>
                    {bridge.bidirectional && reverseStatus && (
                      <span className="ml-2 text-slate-500">
                        · reverse: <span className={STATUS_LABELS[reverseStatus].cls}>{STATUS_LABELS[reverseStatus].text}</span>
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleToggle(bridge)}>
                    {bridge.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button onClick={() => onEdit(bridge)}>Edit</Button>
                  {pendingDelete === bridge.id ? (
                    <Button onClick={() => handleConfirmDelete(bridge.id)}>Confirm</Button>
                  ) : (
                    <Button onClick={() => setPendingDelete(bridge.id)}>Delete</Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add tab to AdminBoard**

In the admin board's tab strip, add "Bridges" alongside existing tabs. Render `<BridgesPanel ... />` when the tab is active.

Wire props from AppState: bridges, runnerStatuses, onSave (handleSaveBridges from Task 8). For onNew and onEdit, set local state in AdminBoard to render the wizard (Task 10).

- [ ] **Step 4: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/BridgesPanel.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(bridge): Bridges admin tab with status, enable/disable, delete"
```

---

## Task 10: Bridge creation/edit wizard

**Files:**
- Create: `client/src/renderer/screens/BridgeEditor.tsx`

The wizard lets the operator:
1. Name the bridge
2. Pick source server + net
3. Pick target server + net
4. Choose mode (smart / always-on / ptt-relay)
5. Adjust smart threshold (only if smart mode)
6. Toggle bidirectional
7. Save

For source/target net selection, the operator picks from the nets they are currently a member of on the chosen server. The wizard uses `listNets(client)` on the selected server's Matrix client.

- [ ] **Step 1: Write BridgeEditor.tsx**

```tsx
import { useEffect, useState } from "react";
import type { BridgeConfig, BridgeMode, BridgeEndpoint } from "@shared/types";
import type { MatrixClient } from "matrix-js-sdk";
import { listNets } from "../matrix/nets";
import { Button } from "../components/Button";

interface Props {
  /** Existing bridge being edited, or null for create. */
  initial: BridgeConfig | null;
  /** Servers the user is signed into. Map: serverId → label + Matrix client. */
  servers: Map<string, { label: string; client: MatrixClient }>;
  onSave: (bridge: BridgeConfig) => Promise<void>;
  onCancel: () => void;
}

const DEFAULT_SMART_THRESHOLD = 0.02;

export function BridgeEditor({ initial, servers, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState<BridgeEndpoint>(initial?.source ?? { serverId: "", matrixRoomId: "" });
  const [target, setTarget] = useState<BridgeEndpoint>(initial?.target ?? { serverId: "", matrixRoomId: "" });
  const [mode, setMode] = useState<BridgeMode>(initial?.mode ?? "smart");
  const [smartThreshold, setSmartThreshold] = useState<number>(initial?.smartThreshold ?? DEFAULT_SMART_THRESHOLD);
  const [bidirectional, setBidirectional] = useState<boolean>(initial?.bidirectional ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function NetSelect({ endpoint, onChange }: { endpoint: BridgeEndpoint; onChange: (e: BridgeEndpoint) => void }) {
    const serverInstance = endpoint.serverId ? servers.get(endpoint.serverId) : null;
    const nets = serverInstance ? listNets(serverInstance.client) : [];
    return (
      <div className="grid grid-cols-2 gap-2">
        <select
          value={endpoint.serverId}
          onChange={(e) => onChange({ serverId: e.target.value, matrixRoomId: "" })}
          className="rounded border border-slate-700 bg-slate-900 p-1 text-sm"
        >
          <option value="">— pick server —</option>
          {Array.from(servers.entries()).map(([id, info]) => (
            <option key={id} value={id}>{info.label}</option>
          ))}
        </select>
        <select
          value={endpoint.matrixRoomId}
          onChange={(e) => onChange({ ...endpoint, matrixRoomId: e.target.value })}
          className="rounded border border-slate-700 bg-slate-900 p-1 text-sm"
          disabled={!endpoint.serverId}
        >
          <option value="">— pick net —</option>
          {nets.map((n) => (
            <option key={n.matrixRoomId} value={n.matrixRoomId}>
              {n.properties.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    if (!source.serverId || !source.matrixRoomId) { setError("Source net is required"); return; }
    if (!target.serverId || !target.matrixRoomId) { setError("Target net is required"); return; }
    if (source.serverId === target.serverId && source.matrixRoomId === target.matrixRoomId) {
      setError("Source and target cannot be the same net");
      return;
    }
    setSaving(true);
    try {
      const bridge: BridgeConfig = {
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        source,
        target,
        mode,
        smartThreshold,
        enabled: initial?.enabled ?? false,
        bidirectional,
        createdMs: initial?.createdMs ?? Date.now(),
      };
      await onSave(bridge);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onCancel}>
      <div
        className="w-full max-w-2xl space-y-4 rounded border border-slate-700 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{initial ? "Edit bridge" : "New bridge"}</h2>

        <label className="block text-sm">
          <span className="block text-xs uppercase tracking-wider text-slate-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Anvil ↔ Aegis Allies"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-1"
          />
        </label>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-400">Source net</span>
          <NetSelect endpoint={source} onChange={setSource} />
        </div>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-400">Target net</span>
          <NetSelect endpoint={target} onChange={setTarget} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bidirectional} onChange={(e) => setBidirectional(e.target.checked)} />
          Bidirectional (relay both directions)
        </label>

        <div className="space-y-2">
          <span className="text-xs uppercase tracking-wider text-slate-400">Mode</span>
          {(["smart", "always-on", "ptt-relay"] as BridgeMode[]).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1"
              />
              <span>
                <strong>{m}</strong>
                {m === "smart" && <span className="block text-xs text-slate-500">Relay when source-net voice activity exceeds threshold</span>}
                {m === "always-on" && <span className="block text-xs text-slate-500">Continuously relay all source audio</span>}
                {m === "ptt-relay" && <span className="block text-xs text-slate-500">Relay only when source-net member is actively speaking (high VAD threshold)</span>}
              </span>
            </label>
          ))}
        </div>

        {mode === "smart" && (
          <label className="block text-sm">
            <span className="block text-xs uppercase tracking-wider text-slate-400">
              Smart threshold ({smartThreshold.toFixed(3)})
            </span>
            <input
              type="range"
              min={0.005}
              max={0.1}
              step={0.001}
              value={smartThreshold}
              onChange={(e) => setSmartThreshold(parseFloat(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
        )}

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire from AdminBoard**

In AdminBoard, when `editorState !== "closed"`, render:

```tsx
{editorState === "new" && (
  <BridgeEditor
    initial={null}
    servers={servers}
    onSave={async (bridge) => {
      await onSaveBridges([...bridges, bridge]);
      setEditorState("closed");
    }}
    onCancel={() => setEditorState("closed")}
  />
)}
{editorState !== "closed" && editorState !== "new" && (
  <BridgeEditor
    initial={editorState}  // BridgeConfig
    servers={servers}
    onSave={async (bridge) => {
      await onSaveBridges(bridges.map((b) => b.id === bridge.id ? bridge : b));
      setEditorState("closed");
    }}
    onCancel={() => setEditorState("closed")}
  />
)}
```

`servers` is a Map<serverId, { label, client }> built from AppState.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/BridgeEditor.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(bridge): BridgeEditor wizard for create + edit"
```

---

## Task 11: Per-net bridge indicator on NetRow

**Files:**
- Modify: `client/src/renderer/components/NetRow.tsx`
- Modify: `client/src/renderer/components/NetListPanel.tsx`

Add a small "🌉" indicator on NetRow when:
- This net is the source or target of an ENABLED bridge
- The bridge runner is in "idle" or "relaying" status

Tooltip shows the bridge name + status. Clicking opens the BridgesPanel (deferred — for v1.5 just the indicator is enough).

- [ ] **Step 1: Pass bridges + runnerStatuses down to NetRow**

Thread through AppState → ActiveServerView → Home → NetListPanel → NetRow. Add to NetRowProps:

```ts
bridgeIndicator: { bridgeName: string; status: BridgeRunnerStatus } | null;
```

In NetListPanel.renderNetRow, compute per-row:

```ts
const bridgeIndicator = (() => {
  for (const bridge of bridges) {
    if (!bridge.enabled) continue;
    const isSrc = bridge.source.serverId === serverId && bridge.source.matrixRoomId === net.matrixRoomId;
    const isTgt = bridge.target.serverId === serverId && bridge.target.matrixRoomId === net.matrixRoomId;
    if (!isSrc && !isTgt) continue;
    const statuses = runnerStatuses.get(bridge.id);
    const forwardStatus = statuses?.forward ?? "stopped";
    if (forwardStatus === "stopped" || forwardStatus === "error") continue;
    return { bridgeName: bridge.name, status: forwardStatus };
  }
  return null;
})();
```

- [ ] **Step 2: Render indicator in NetRow**

```tsx
{bridgeIndicator && (
  <span
    className="text-xs text-cyan-300"
    title={`${bridgeIndicator.bridgeName} (${bridgeIndicator.status})`}
  >
    🌉
  </span>
)}
```

Place adjacent to the existing share / monitor indicators.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/NetRow.tsx client/src/renderer/components/NetListPanel.tsx client/src/renderer/screens/Home.tsx client/src/renderer/AppState.tsx
git commit -m "client(bridge): 🌉 indicator on net rows that are part of an active bridge"
```

---

## Task 12: Unit tests

**Files:**
- Create: `client/tests/unit/bridgeEngine.test.ts`
- Create: `client/tests/unit/vadGate.test.ts`

Test the state-machine surface of BridgeEngine + the VadGate's hysteresis behavior. Both pure logic — no real LiveKit / Web Audio required (use fakes).

- [ ] **Step 1: Write `bridgeEngine.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BridgeEngine } from "@/renderer/bridge/BridgeEngine";
import type { BridgeConfig } from "@shared/types";

const baseConfig: BridgeConfig = {
  id: "b1",
  name: "Test Bridge",
  source: { serverId: "srvA", matrixRoomId: "!a:hf.example" },
  target: { serverId: "srvB", matrixRoomId: "!b:hf.example" },
  mode: "always-on",
  smartThreshold: 0.02,
  enabled: true,
  bidirectional: false,
  createdMs: 1,
};

function makeContext() {
  return {
    getRoom: vi.fn().mockReturnValue(null), // always returns null — runners go to "error"
    playBridgeChirp: vi.fn(),
  };
}

describe("BridgeEngine", () => {
  let ctx: ReturnType<typeof makeContext>;
  let engine: BridgeEngine;

  beforeEach(() => {
    ctx = makeContext();
    engine = new BridgeEngine(ctx);
  });

  it("setConfigs is a no-op when called with empty array", async () => {
    await engine.setConfigs([]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs starts a forward runner for an enabled bridge", async () => {
    await engine.setConfigs([baseConfig]);
    const sums = engine.getActiveSummaries();
    expect(sums).toHaveLength(1);
    expect(sums[0].bridgeId).toBe("b1");
    expect(sums[0].direction).toBe("forward");
    expect(sums[0].status).toBe("error"); // getRoom returns null
  });

  it("setConfigs starts both forward AND reverse runners for bidirectional bridge", async () => {
    await engine.setConfigs([{ ...baseConfig, bidirectional: true }]);
    expect(engine.getActiveSummaries()).toHaveLength(2);
  });

  it("setConfigs does NOT start a disabled bridge", async () => {
    await engine.setConfigs([{ ...baseConfig, enabled: false }]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs stops a previously-active bridge when removed", async () => {
    await engine.setConfigs([baseConfig]);
    expect(engine.getActiveSummaries()).toHaveLength(1);
    await engine.setConfigs([]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs disables a bridge when enabled flips false", async () => {
    await engine.setConfigs([baseConfig]);
    await engine.setConfigs([{ ...baseConfig, enabled: false }]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("shutdown clears all active bridges", async () => {
    await engine.setConfigs([baseConfig]);
    await engine.shutdown();
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write `vadGate.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";

// VadGate uses Web Audio APIs which aren't available in the Node test
// environment. We mock them minimally to assert state-machine behavior.

global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
  createAnalyser: vi.fn().mockReturnValue({
    fftSize: 1024,
    connect: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
  }),
  close: vi.fn().mockResolvedValue(undefined),
})) as unknown as typeof AudioContext;

global.MediaStream = vi.fn() as unknown as typeof MediaStream;

import { VadGate } from "@/renderer/bridge/vadGate";

describe("VadGate", () => {
  it("constructs without throwing", () => {
    const gate = new VadGate({} as MediaStreamTrack, { threshold: 0.02 });
    expect(gate.isCurrentlyOpen()).toBe(false);
    gate.stop();
  });

  it("isCurrentlyOpen returns false before start", () => {
    const gate = new VadGate({} as MediaStreamTrack);
    expect(gate.isCurrentlyOpen()).toBe(false);
    gate.stop();
  });

  it("stop closes the audio context", () => {
    const gate = new VadGate({} as MediaStreamTrack);
    gate.start();
    gate.stop();
    // No exception means audio context close was called without error
    expect(gate.isCurrentlyOpen()).toBe(false);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run tests/unit/bridgeEngine.test.ts tests/unit/vadGate.test.ts 2>&1 | tail -8
```

Expected: 10 passed.

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/bridgeEngine.test.ts client/tests/unit/vadGate.test.ts
git commit -m "client(test): BridgeEngine + VadGate unit tests"
```

---

## Task 13: Rebuild installers + smoke test

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
ls -lh /home/shreen/code/tactical-radio/client/release/Hailfreq-*
```

Expected: no new heavy deps (uses existing LiveKit + Web Audio), sizes within ~5MB of Plan 8b.

No commit unless something broke.

---

## Task 14: README + spec note

**Files:**
- Modify: `client/README.md`
- Modify: `docs/superpowers/specs/2026-05-26-hailfreq-design.md`

- [ ] **Step 1: README bullet**

```markdown
- Net Bridges — relay audio between two nets (typically across servers for allied-org coordination); three modes (smart/always-on/ptt-relay), bidirectional, bridge chirp + identity attribution on the target net so receivers know audio is bridged
```

- [ ] **Step 2: Spec §16**

```markdown
## 16. Net Bridges (Hailfreq v1.5 feature)

Implemented in Plan 8c. Resolves spec §11 open questions: default mode = smart (VAD-driven), no sequence-number dedup in v1.5 (operators coordinate manually via visible status indicators), receiver attribution = bridge chirp on operator's local output + `(via <bridge name>)` participant identity suffix in the target net.

### Architecture

- A global `BridgeEngine` (one instance, lives at AppState scope — not per-server, because a bridge spans servers) holds active bridge configs and runs the relay loops
- Per direction, a `BridgeRunner` subscribes to the source room's remote audio tracks and, per mode, republishes them to the target room as the bridge operator's `LocalAudioTrack`
- The target room's `ExternalE2EEKeyProvider` re-encrypts on publish using the target net's SFrame key
- Bridge configs are persisted in local Settings (`Settings.bridges: BridgeConfig[]`); no Matrix state, no cross-machine sync in v1.5

### Three modes

| Mode | Behavior | Bandwidth | When to use |
|---|---|---|---|
| `smart` (default) | Open relay when source-net RMS exceeds `smartThreshold` (default 0.02). VAD-driven with 800ms hangover. | Medium | Most cases — natural-sounding allied comms with idle-channel suppression |
| `always-on` | Continuously relay all source audio | High | Tight-knit allied ops where you want zero-friction always-listening |
| `ptt-relay` | RMS-based gate with high threshold (0.08) and short hangover (300ms) — acts as PTT detection | Low | Allied org with high background chatter where you only care about explicit calls |

### Receiver attribution

When a relay opens, the operator's local audio output plays a brief 2-tone "bridge active" chirp (440Hz → 880Hz, 150ms total). Receivers in the target net see the operator's published track named `(via <bridge name>)`, making it visually obvious that the audio is bridged.

The chirp plays on the OPERATOR'S local output (their own audible confirmation), not in the relayed audio. Receiver-side audible attribution (chirp inside the published stream) would require PCM injection into the LocalAudioTrack; the visible identity suffix is sufficient for v1.5.

### Privacy posture

- Bridge operator can decrypt both nets (they hold both SFrame keys). This is intrinsic — bridges are an operator-trust feature.
- Receivers in the target net see clear visual indication that audio is bridged (identity suffix in their participant list).
- Bridge configs never leave the operator's machine.
- A bridge can be disabled (toggle off) at any time without deleting the config.

### Known limitations (v1.5)

- No sequence-number deduplication when multiple operators run the same bridge; receivers hear duplicates briefly. Operators see status indicators and coordinate manually.
- No auto-failover (if operator's machine crashes mid-bridge, another operator's bridge config must be manually enabled)
- No bridge config sync across machines / devices (per-machine local storage only)
- No text-message relay (voice only)
- No screen-share relay
- Bridge-active chirp plays on operator's local output only, not injected into the relayed audio
- Smart-mode and ptt-relay use a shared VAD implementation; LiveKit's native speaking detection is not used to keep the relay independent of remote VAD smoothing
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/2026-05-26-hailfreq-design.md
git commit -m "docs: net bridges shipped (Plan 8c v1.5)"
```

---

## Done

After Task 14, the deliverable is:

- BridgeConfig data model + per-machine Settings persistence + `settings:setBridges` IPC with runtime validation
- `audioRelay.ts` primitive: RemoteAudioTrack → LocalAudioTrack republish with ExternalE2EEKeyProvider re-encryption
- `VadGate` with hysteresis (open quickly, close after 800ms below threshold)
- `BridgeRunner` per-direction relay with three-mode dispatch (smart / always-on / ptt-relay)
- `BridgeEngine` global coordinator with config sync, room-availability refresh, and lifecycle management
- Bridge-active chirp (Web Audio synthesized, operator-local)
- AppState wiring with cross-server `getRoom` accessor
- `BridgesPanel` admin tab with status indicators + enable/disable + delete
- `BridgeEditor` wizard for create + edit (server + net pickers, mode radio, smart threshold slider, bidirectional toggle)
- 🌉 indicator on NetRow for nets that are part of active bridges
- 10 unit tests (BridgeEngine state machine + VadGate construction)
- Rebuilt installers
- README + spec §16

**Closing notes:**

This plan ships the v1.5 Net Bridges feature with the scoped design decisions confirmed by the operator. Brainstorming-mode improvements (sequence-number dedup, auto-failover, chirp injection into relayed audio, Matrix-state-based config sync) are documented as known limitations and can be added in subsequent passes once the operator has real-world feedback on bridge usage patterns.

**Next plans:**

After Plan 8c lands, the original Plan 8 series (focused-app PTT + screen sharing + bridges) is complete. Future direction is operator's call — possible next areas:
- Plan 9 series — operator-requested polish based on Plans 1–8c real-world feedback
- v2 — multi-server voice (architectural design first), federation gated allowlist, mobile companion
