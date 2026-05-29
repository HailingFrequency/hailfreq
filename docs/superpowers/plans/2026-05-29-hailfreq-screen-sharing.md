# Hailfreq Screen Sharing Implementation Plan (Plan 8b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-style screen sharing to Hailfreq, end-to-end-encrypted via the same SFrame key infrastructure that protects voice. A user can pick a screen or window via Electron's native source picker and publish it as a screen track to one monitored net at a time. Members of that net see a "📺 sharing" indicator on the net row and can open a viewer pane to watch the stream. Optional system-audio capture flows through the same SFrame pipeline. Server operators cannot see any frame content — frames are SFrame-wrapped in the sharer's renderer and never decrypted in the SFU.

**Architecture:** A new `ShareEngine` module sits parallel to `VoiceEngine` and reuses the same LiveKit `Room` objects via a small `getRoom(matrixRoomId)` accessor added to `VoiceEngine`. The publisher path is `desktopCapturer.getSources` → user picks a source → `getUserMedia({chromeMediaSource: 'desktop'})` → `room.localParticipant.publishTrack(...)` with the room's existing `ExternalE2EEKeyProvider`. Subscribers receive screen tracks via the existing `trackSubscribed` event (now extended to handle `Track.Kind.Video`), attach them to a `<video>` element in a viewer pane, and rely on LiveKit + ExternalE2EEKeyProvider to decrypt frames before delivery. Sharing state (who is sharing what) lives in Hailfreq state (`ServerInstance.activeShares`), updated via LiveKit participant + track events.

**Tech Stack:** Electron's `desktopCapturer` (Chromium-native screen capture, no extra deps), LiveKit screen-track publishing API (already in `livekit-client`), the existing SFrame infrastructure from Plan 4. React for the viewer pane and source picker UI.

**Spec reference:** Beyond original spec — the operator picked Matrix base partly because they wanted to keep Discord/Fluxer-style screen sharing for ops planning (showing a star map, ship loadout, mission briefing during a sortie).

**Out of scope:**
- Recording / saving shares to disk
- Annotation / drawing on top of a share
- Multi-source composite shares (one source per session)
- Remote control of the sharer's screen
- macOS support (no macOS installer)
- Adaptive resolution / quality tier negotiation — accept LiveKit's default simulcast layers
- Per-net "no sharing" admin policy — deferred to a later admin board iteration

**Privacy / opt-in:**
- The sharer always sees the OS-level source picker first; they can cancel anytime
- Frames are SFrame-encrypted in the sharer's renderer before leaving the machine; the SFU cannot decrypt
- Subscribers only see frames after SFrame decrypt with the room key they already hold from voice
- No frame data, source name, or window title is logged or transmitted off the participants' machines beyond the SFrame-encrypted track payload

**Repo location:** `/home/shreen/code/tactical-radio`. Commits go to `master` per the established workflow across Plans 1–8a.

---

## Task 1: Expose Room accessor on VoiceEngine

**Files:**
- Modify: `client/src/renderer/voice/VoiceEngine.ts`

ShareEngine (Task 2) needs the same `Room` instances that VoiceEngine connects, otherwise we'd have two parallel LiveKit connections per monitored net (double the LiveKit token cost + double the participant entries). Add a minimal getter.

Read first: `client/src/renderer/voice/VoiceEngine.ts` end-to-end. Find the internal map of room-id → Room (likely `private nets: Map<string, NetInstance>` or similar). Find where `Room` is held.

- [ ] **Step 1: Add the accessor**

```ts
import type { Room } from "livekit-client";

// Public method on VoiceEngine class:

/**
 * Get the live LiveKit Room for a monitored net, or null if not currently
 * connected. ShareEngine and any future media layer uses this to publish/
 * subscribe additional tracks without duplicating the connection.
 */
getLiveKitRoom(matrixRoomId: string): Room | null {
  const net = this.nets.get(matrixRoomId);
  return net?.room ?? null;
}
```

Match the actual internal shape — if the map is keyed by livekit room id rather than matrix room id, adapt. The public API should accept `matrixRoomId` because that's the stable identifier callers know.

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/VoiceEngine.ts
git commit -m "client(voice): expose getLiveKitRoom accessor for ShareEngine"
```

---

## Task 2: ShareEngine module skeleton

**Files:**
- Create: `client/src/renderer/share/ShareEngine.ts`
- Create: `client/src/renderer/share/types.ts`

A new subdomain `share/` parallel to `voice/` and `sc/`. The engine tracks who is sharing what across all monitored nets, exposes start/stop on the local participant's share, and emits events when remote shares appear/disappear.

- [ ] **Step 1: Write `client/src/renderer/share/types.ts`**

```ts
import type { RemoteVideoTrack, LocalVideoTrack } from "livekit-client";

export interface ActiveShareSummary {
  /** Matrix room id of the net the share is happening in. */
  matrixRoomId: string;
  /** LiveKit participant identity of the sharer. */
  sharerIdentity: string;
  /** Optional Matrix user id derived from participant identity, if resolvable. */
  sharerMatrixUserId: string | null;
  /** Live video track to attach to a <video> element. */
  videoTrack: RemoteVideoTrack;
  /** Live audio track if the sharer also published system audio, null otherwise. */
  audioTrack: import("livekit-client").RemoteAudioTrack | null;
  /** Wall-clock timestamp (ms) when this share was first observed. */
  startedAt: number;
}

export interface LocalShareState {
  matrixRoomId: string;
  videoTrack: LocalVideoTrack;
  audioTrack: import("livekit-client").LocalAudioTrack | null;
  startedAt: number;
}

export interface ShareEngineEvents {
  onShareStarted?: (share: ActiveShareSummary) => void;
  onShareEnded?: (matrixRoomId: string, sharerIdentity: string) => void;
  onLocalShareStarted?: (state: LocalShareState) => void;
  onLocalShareEnded?: (matrixRoomId: string) => void;
}
```

- [ ] **Step 2: Write `client/src/renderer/share/ShareEngine.ts`**

```ts
import type { VoiceEngine } from "../voice/VoiceEngine";
import {
  type RemoteVideoTrack,
  type RemoteAudioTrack,
  type LocalVideoTrack,
  type LocalAudioTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
  Track,
  RoomEvent,
} from "livekit-client";
import type { ActiveShareSummary, LocalShareState, ShareEngineEvents } from "./types";

/**
 * Manages screen-share publish + subscribe across all monitored nets.
 *
 * The local user can have AT MOST ONE active share at a time (across all
 * nets) to keep the bandwidth and UX bounded. Remote participants can
 * each share independently in any room the local user monitors.
 */
export class ShareEngine {
  private readonly voiceEngine: VoiceEngine;
  private listeners: ShareEngineEvents = {};
  private remoteShares = new Map<string, ActiveShareSummary>(); // key = `${matrixRoomId}::${sharerIdentity}`
  private localShare: LocalShareState | null = null;
  private wiredRooms = new Set<string>(); // matrixRoomIds we've attached track listeners to

  constructor(voiceEngine: VoiceEngine) {
    this.voiceEngine = voiceEngine;
  }

  on(events: ShareEngineEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  /**
   * Idempotently attach screen-track listeners to a monitored room. Called
   * from AppState whenever a room comes online so that remote shares are
   * surfaced to the UI.
   */
  attachRoom(matrixRoomId: string): void {
    if (this.wiredRooms.has(matrixRoomId)) return;
    const room = this.voiceEngine.getLiveKitRoom(matrixRoomId);
    if (!room) return;

    const onTrackSubscribed = (
      track: RemoteVideoTrack | RemoteAudioTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.source !== Track.Source.ScreenShare && publication.source !== Track.Source.ScreenShareAudio) return;
      this.handleRemoteScreenTrack(matrixRoomId, participant, publication);
    };

    const onTrackUnsubscribed = (
      _track: RemoteVideoTrack | RemoteAudioTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.source !== Track.Source.ScreenShare) return;
      this.handleRemoteShareEnded(matrixRoomId, participant.identity);
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      this.handleRemoteShareEnded(matrixRoomId, participant.identity);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed as never);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed as never);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    this.wiredRooms.add(matrixRoomId);
  }

  /**
   * Detach listeners from a room when it leaves the monitored set.
   * Note: LiveKit's Room.removeAllListeners is broad; we only added three
   * specific ones, so a manual `off` per event would be cleaner if Room
   * supports it. For v1 we accept the cleanup happens when the Room is
   * disconnected by VoiceEngine — the listeners die with the Room.
   */
  detachRoom(matrixRoomId: string): void {
    this.wiredRooms.delete(matrixRoomId);
    for (const key of this.remoteShares.keys()) {
      if (key.startsWith(`${matrixRoomId}::`)) {
        const share = this.remoteShares.get(key);
        if (share) {
          this.remoteShares.delete(key);
          this.listeners.onShareEnded?.(share.matrixRoomId, share.sharerIdentity);
        }
      }
    }
  }

  getActiveShares(): ActiveShareSummary[] {
    return Array.from(this.remoteShares.values());
  }

  getLocalShare(): LocalShareState | null {
    return this.localShare;
  }

  /**
   * Start a local share. Caller is responsible for using ShareSourcePicker
   * (Task 3) to obtain a MediaStream beforehand. The local participant must
   * be connected to the target room (i.e., monitoring that net).
   *
   * Throws if a local share is already active or if the room is not monitored.
   */
  async startLocalShare(
    matrixRoomId: string,
    stream: MediaStream,
  ): Promise<LocalShareState> {
    if (this.localShare) {
      throw new Error("A local share is already active; stop it first");
    }
    const room = this.voiceEngine.getLiveKitRoom(matrixRoomId);
    if (!room) {
      throw new Error(`Room ${matrixRoomId} is not currently monitored`);
    }

    const videoMediaTrack = stream.getVideoTracks()[0];
    if (!videoMediaTrack) {
      throw new Error("Provided MediaStream has no video track");
    }
    const audioMediaTrack = stream.getAudioTracks()[0] ?? null;

    const { LocalVideoTrack: LVT, LocalAudioTrack: LAT } = await import("livekit-client");
    const videoTrack: LocalVideoTrack = new LVT(videoMediaTrack);
    const audioTrack: LocalAudioTrack | null = audioMediaTrack ? new LAT(audioMediaTrack) : null;

    await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare });
    if (audioTrack) {
      await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.ScreenShareAudio });
    }

    // Listen for the underlying media track ending (user clicks the
    // browser/OS "stop sharing" toolbar) and clean up.
    videoMediaTrack.addEventListener("ended", () => {
      void this.stopLocalShare();
    });

    const state: LocalShareState = {
      matrixRoomId,
      videoTrack,
      audioTrack,
      startedAt: Date.now(),
    };
    this.localShare = state;
    this.listeners.onLocalShareStarted?.(state);
    return state;
  }

  async stopLocalShare(): Promise<void> {
    if (!this.localShare) return;
    const state = this.localShare;
    const room = this.voiceEngine.getLiveKitRoom(state.matrixRoomId);
    if (room) {
      try { await room.localParticipant.unpublishTrack(state.videoTrack); } catch (err) {
        console.error("[ShareEngine] failed to unpublish video track:", err);
      }
      if (state.audioTrack) {
        try { await room.localParticipant.unpublishTrack(state.audioTrack); } catch (err) {
          console.error("[ShareEngine] failed to unpublish audio track:", err);
        }
      }
    }
    state.videoTrack.stop();
    state.audioTrack?.stop();
    this.localShare = null;
    this.listeners.onLocalShareEnded?.(state.matrixRoomId);
  }

  private handleRemoteScreenTrack(
    matrixRoomId: string,
    participant: RemoteParticipant,
    publication: RemoteTrackPublication,
  ): void {
    const key = `${matrixRoomId}::${participant.identity}`;
    const existing = this.remoteShares.get(key);

    if (publication.source === Track.Source.ScreenShare) {
      const videoTrack = publication.track as RemoteVideoTrack | undefined;
      if (!videoTrack) return;
      const summary: ActiveShareSummary = {
        matrixRoomId,
        sharerIdentity: participant.identity,
        sharerMatrixUserId: deriveMatrixIdFromParticipant(participant.identity),
        videoTrack,
        audioTrack: existing?.audioTrack ?? null,
        startedAt: existing?.startedAt ?? Date.now(),
      };
      this.remoteShares.set(key, summary);
      this.listeners.onShareStarted?.(summary);
    } else if (publication.source === Track.Source.ScreenShareAudio && existing) {
      const audioTrack = publication.track as RemoteAudioTrack | undefined;
      if (audioTrack) {
        existing.audioTrack = audioTrack;
        this.remoteShares.set(key, existing);
      }
    }
  }

  private handleRemoteShareEnded(matrixRoomId: string, sharerIdentity: string): void {
    const key = `${matrixRoomId}::${sharerIdentity}`;
    const existing = this.remoteShares.get(key);
    if (!existing) return;
    this.remoteShares.delete(key);
    this.listeners.onShareEnded?.(matrixRoomId, sharerIdentity);
  }

  shutdown(): void {
    void this.stopLocalShare();
    this.remoteShares.clear();
    this.wiredRooms.clear();
    this.listeners = {};
  }
}

/**
 * LiveKit participant identity is set by the livekit-auth service when
 * minting tokens. In Hailfreq, it's currently the Matrix user id verbatim
 * (see server/livekit-auth/src/index.ts). If the format ever diverges,
 * adapt here.
 */
function deriveMatrixIdFromParticipant(identity: string): string | null {
  if (identity.startsWith("@") && identity.includes(":")) return identity;
  return null;
}
```

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/share/ShareEngine.ts client/src/renderer/share/types.ts
git commit -m "client(share): ShareEngine skeleton with publish + subscribe + room lifecycle"
```

---

## Task 3: Screen source picker IPC + UI

**Files:**
- Create: `client/src/main/desktopCapture.ts`
- Modify: `client/src/shared/ipc.ts`
- Modify: `client/src/main/ipc.ts`
- Create: `client/src/renderer/share/SourcePickerModal.tsx`

Two pieces:
1. Main-process helper that lists capturable sources (screens + windows) with thumbnails via `desktopCapturer.getSources(...)`
2. Renderer modal that displays the list, lets the user pick one, and returns the selection

`desktopCapturer` MUST live in main process (renderer-side API is deprecated). The actual `getUserMedia` call to acquire the stream happens in the renderer using the selected source id.

- [ ] **Step 1: Write `client/src/main/desktopCapture.ts`**

```ts
import { desktopCapturer } from "electron";

export interface DesktopCaptureSource {
  id: string;
  name: string;
  /** data URL of the source thumbnail (nativeImage → data URL) */
  thumbnailDataUrl: string;
  /** "screen" or "window" */
  kind: "screen" | "window";
}

export async function listSources(): Promise<DesktopCaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    kind: s.id.startsWith("screen:") ? "screen" : "window",
  }));
}
```

- [ ] **Step 2: Add IPC channel `share:listSources`**

In `client/src/shared/ipc.ts` add the interface:

```ts
export interface DesktopCaptureSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  kind: "screen" | "window";
}
```

(Or re-export from `desktopCapture.ts` via the same layering trick used in Plan 7 Task 1 and Plan 8a Task 2.)

Add the channel:

```ts
"share:listSources": { args: []; result: DesktopCaptureSource[] };
```

In `client/src/main/ipc.ts`:

```ts
import { listSources } from "./desktopCapture";

ipcMain.handle("share:listSources", async (): Promise<DesktopCaptureSource[]> => {
  return listSources();
});
```

No runtime arg validation needed (zero args).

- [ ] **Step 3: Write the picker modal**

`client/src/renderer/share/SourcePickerModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { DesktopCaptureSource } from "@shared/ipc";

interface Props {
  /** Called with the chosen source + whether to capture system audio. Null arg means user cancelled. */
  onPick: (selection: { source: DesktopCaptureSource; captureAudio: boolean } | null) => void;
}

export function SourcePickerModal({ onPick }: Props) {
  const [sources, setSources] = useState<DesktopCaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureAudio, setCaptureAudio] = useState(false);
  const [selected, setSelected] = useState<DesktopCaptureSource | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.hailfreq.invoke("share:listSources");
        setSources(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to enumerate screens");
      }
    })();
  }, []);

  const screens = sources?.filter((s) => s.kind === "screen") ?? [];
  const windows = sources?.filter((s) => s.kind === "window") ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={() => onPick(null)}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">Choose what to share</h2>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!sources && !error && <p className="text-sm text-slate-400">Loading sources…</p>}

        {sources && (
          <>
            {screens.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs uppercase tracking-wider text-slate-400">Entire screen</h3>
                <div className="grid grid-cols-2 gap-2">
                  {screens.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={`rounded border p-2 text-left ${selected?.id === s.id ? "border-brand-500" : "border-slate-700"}`}
                    >
                      <img src={s.thumbnailDataUrl} alt={s.name} className="mb-1 w-full rounded" />
                      <p className="text-xs">{s.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {windows.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-slate-400">Window</h3>
                <div className="grid grid-cols-3 gap-2">
                  {windows.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={`rounded border p-2 text-left ${selected?.id === s.id ? "border-brand-500" : "border-slate-700"}`}
                    >
                      <img src={s.thumbnailDataUrl} alt={s.name} className="mb-1 w-full rounded" />
                      <p className="text-xs truncate">{s.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={captureAudio}
                  onChange={(e) => setCaptureAudio(e.target.checked)}
                />
                Also share system audio (Linux/Windows only; quality varies)
              </label>
              <div className="flex gap-2">
                <button onClick={() => onPick(null)} className="text-sm text-slate-300 hover:text-slate-100">
                  Cancel
                </button>
                <button
                  disabled={!selected}
                  onClick={() => selected && onPick({ source: selected, captureAudio })}
                  className="rounded bg-brand-600 px-3 py-1 text-sm disabled:opacity-50"
                >
                  Share
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/desktopCapture.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/renderer/share/SourcePickerModal.tsx
git commit -m "client(share): desktopCapturer source listing + source picker modal"
```

---

## Task 4: Acquire stream + wire ShareEngine.startLocalShare

**Files:**
- Create: `client/src/renderer/share/acquireDisplayStream.ts`

A renderer-side helper that converts a `DesktopCaptureSource` selection into a `MediaStream` via `getUserMedia` with the Chromium-specific `chromeMediaSource: "desktop"` constraint.

- [ ] **Step 1: Write the helper**

```ts
import type { DesktopCaptureSource } from "@shared/ipc";

/**
 * Acquire a MediaStream from a chosen desktopCapturer source. Uses the
 * legacy `chromeMediaSource: "desktop"` constraints because Electron's
 * Chromium does not implement the standard getDisplayMedia source picker
 * (we provide our own picker via desktopCapturer.getSources).
 *
 * captureAudio: also requests the audio track. On Linux/Windows this works
 * for "entire screen" sources; on individual windows it's typically silent.
 * macOS does not support system-audio capture via this API.
 */
export async function acquireDisplayStream(
  source: DesktopCaptureSource,
  captureAudio: boolean,
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints & {
    video: { mandatory: Record<string, unknown> };
    audio?: { mandatory: Record<string, unknown> };
  } = {
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  };
  if (captureAudio) {
    constraints.audio = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
      },
    };
  }
  // getUserMedia accepts the legacy mandatory form on Electron's Chromium
  return navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/share/acquireDisplayStream.ts
git commit -m "client(share): acquireDisplayStream helper via legacy chromeMediaSource constraints"
```

---

## Task 5: Wire ShareEngine into AppState

**Files:**
- Modify: `client/src/renderer/AppState.tsx`

Instantiate one `ShareEngine` per `ServerInstance` (alongside the existing VoiceEngine). On each net monitored, call `attachRoom`. On unmonitor / server removal, call `detachRoom` and `shutdown`. Track active shares in AppState so the UI can render indicators + viewer panes.

Read first: `client/src/renderer/AppState.tsx` — find how VoiceEngine is created on ServerInstance (Plan 7 Task 11 hoisted it), and how net-monitor lifecycle hooks fire.

- [ ] **Step 1: Add shareEngine to ServerInstance**

In the ServerInstance shape (likely defined in `client/src/shared/types.ts` or inline in AppState):

```ts
export interface ServerInstance {
  // ... existing fields ...
  shareEngine?: ShareEngine;
  activeShares: ActiveShareSummary[];
}
```

In `initServer` / `makeLoginHandler` (wherever VoiceEngine is currently created):

```ts
import { ShareEngine } from "./share/ShareEngine";
import type { ActiveShareSummary } from "./share/types";

// After voiceEngine creation:
const shareEngine = new ShareEngine(voiceEngine);
shareEngine.on({
  onShareStarted: (share) => {
    setState((prev) => patchServer(prev, serverId, (instance) => ({
      activeShares: [...instance.activeShares.filter((s) =>
        !(s.matrixRoomId === share.matrixRoomId && s.sharerIdentity === share.sharerIdentity)
      ), share],
    })));
  },
  onShareEnded: (matrixRoomId, sharerIdentity) => {
    setState((prev) => patchServer(prev, serverId, (instance) => ({
      activeShares: instance.activeShares.filter((s) =>
        !(s.matrixRoomId === matrixRoomId && s.sharerIdentity === sharerIdentity)
      ),
    })));
  },
});

// ... insert into ServerInstance literal:
return {
  ...,
  shareEngine,
  activeShares: [],
};
```

- [ ] **Step 2: Attach/detach on net monitor lifecycle**

Find the existing voice net monitor lifecycle (where `voiceEngine.monitorNet(...)` is called and torn down). After each `monitorNet` resolves, call `shareEngine.attachRoom(matrixRoomId)`. Before each `unmonitorNet`, call `shareEngine.detachRoom(matrixRoomId)`.

If the existing lifecycle uses a useEffect keyed on monitored-nets, the same effect can do both. Otherwise add a parallel effect.

- [ ] **Step 3: Shutdown on server removal**

In `handleRemoveServer` (the same place Plan 7 Task 11 final cleanup stopped ScIntegration), add:

```ts
instance.shareEngine?.shutdown();
```

Order: shareEngine.shutdown → ScIntegration.stop → voiceEngine.shutdown → handle.shutdown (consistent with the established teardown ordering).

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx client/src/shared/types.ts
git commit -m "client(share): per-server ShareEngine lifecycle + activeShares state"
```

---

## Task 6: Share button + active-share indicator on NetRow

**Files:**
- Modify: `client/src/renderer/components/NetRow.tsx`
- Modify: `client/src/renderer/components/NetListPanel.tsx`

Add to each NetRow:
- A small "Share" button visible when the net is monitored (only one share active globally — disabled or hidden on other rows when local share is active)
- A "📺" indicator when a remote share is active in this net (click → open viewer pane)
- A "🔴 Sharing" indicator when the LOCAL user is sharing to this net (click → confirm Stop)

NetRow already receives state from NetListPanel (Plan 4); add new props.

- [ ] **Step 1: Extend NetRow props**

```ts
export interface NetRowProps {
  // ... existing ...
  /** Set when someone (anyone, including self) is sharing in this net. */
  activeShare: ActiveShareSummary | null;
  /** Set when the LOCAL user is sharing — overrides activeShare display when both true. */
  localShare: LocalShareState | null;
  /** True if any local share is active anywhere — used to disable "Share" buttons on other rows. */
  anyLocalShareActive: boolean;
  onStartShare: (matrixRoomId: string) => void;
  onStopShare: () => void;
  onOpenViewer: (share: ActiveShareSummary) => void;
}
```

- [ ] **Step 2: Render the indicators + buttons**

In NetRow render output (adapt classes to existing style):

```tsx
{net.monitored && !localShare && !anyLocalShareActive && (
  <button
    onClick={() => onStartShare(net.matrixRoomId)}
    className="text-xs text-slate-400 hover:text-slate-200"
    title="Share a screen or window to this net"
  >
    Share
  </button>
)}
{localShare?.matrixRoomId === net.matrixRoomId && (
  <button
    onClick={onStopShare}
    className="flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200"
    title="Stop sharing"
  >
    🔴 Sharing
  </button>
)}
{activeShare && !localShare && (
  <button
    onClick={() => onOpenViewer(activeShare)}
    className="text-xs text-cyan-300 hover:text-cyan-200"
    title="Open shared screen"
  >
    📺
  </button>
)}
```

The exact placement (left of name, right of name, in a row of icons) should match the existing icon pattern in NetRow — read the file first.

- [ ] **Step 3: Wire from NetListPanel**

NetListPanel maps `nets` to NetRows. For each row, pass:
- `activeShare`: `serverInstance.activeShares.find((s) => s.matrixRoomId === net.matrixRoomId) ?? null`
- `localShare`: `shareEngine.getLocalShare()?.matrixRoomId === net.matrixRoomId ? shareEngine.getLocalShare() : null`
- `anyLocalShareActive`: `shareEngine.getLocalShare() !== null`
- `onStartShare`: opens the source picker modal (state in NetListPanel: `pickerForRoomId: string | null`)
- `onStopShare`: `shareEngine.stopLocalShare()`
- `onOpenViewer`: opens the viewer pane (state: `viewingShare: ActiveShareSummary | null`)

For `onStartShare`, the flow is:
1. Set `pickerForRoomId` to the room id
2. Render SourcePickerModal
3. On `onPick` callback: if null → close. If selection → call `acquireDisplayStream(source, captureAudio)` → call `shareEngine.startLocalShare(roomId, stream)`
4. Display errors inline

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/NetRow.tsx client/src/renderer/components/NetListPanel.tsx
git commit -m "client(share): share button + share indicators on NetRow"
```

---

## Task 7: Viewer pane

**Files:**
- Create: `client/src/renderer/share/ShareViewerPane.tsx`

A modal/overlay that displays a single active share. Plays both video and audio if the share included audio. Shows sharer identity. Click outside or Esc to close.

- [ ] **Step 1: Write the viewer pane**

```tsx
import { useEffect, useRef } from "react";
import type { ActiveShareSummary } from "./types";

interface Props {
  share: ActiveShareSummary;
  onClose: () => void;
}

export function ShareViewerPane({ share, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    const audioEl = audioRef.current;
    if (videoEl) {
      share.videoTrack.attach(videoEl);
    }
    if (audioEl && share.audioTrack) {
      share.audioTrack.attach(audioEl);
    }
    return () => {
      if (videoEl) share.videoTrack.detach(videoEl);
      if (audioEl && share.audioTrack) share.audioTrack.detach(audioEl);
    };
  }, [share]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = share.sharerMatrixUserId ?? share.sharerIdentity;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-6xl flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-300">
            📺 Watching <strong>{displayName}</strong>
            {share.audioTrack && <span className="ml-2 text-slate-500">(with audio)</span>}
          </p>
          <button
            onClick={onClose}
            className="text-sm text-slate-300 hover:text-slate-100"
          >
            Close (Esc)
          </button>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full rounded border border-slate-700 bg-black object-contain"
        />
        {/* hidden audio element — playback flows through Web Audio in mainline voice path */}
        <audio ref={audioRef} autoPlay style={{ display: "none" }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/share/ShareViewerPane.tsx
git commit -m "client(share): ShareViewerPane modal with track attach/detach + Esc-to-close"
```

---

## Task 8: Sharing-now status bar

**Files:**
- Create: `client/src/renderer/components/SharingStatusBar.tsx`
- Modify: `client/src/renderer/screens/Home.tsx` (mount the bar)

When the local user is sharing, render a persistent bar at the top of Home with "🔴 Sharing to <net name>" and a Stop button. This serves as both a privacy reminder and a quick stop affordance.

- [ ] **Step 1: Write the bar**

```tsx
import type { LocalShareState } from "../share/types";

interface Props {
  localShare: LocalShareState | null;
  netName: string | null; // resolved net name from the matrixRoomId
  onStop: () => void;
}

export function SharingStatusBar({ localShare, netName, onStop }: Props) {
  if (!localShare) return null;
  return (
    <div className="flex items-center justify-between border-b border-rose-800/40 bg-rose-950/40 px-3 py-1 text-xs">
      <span className="flex items-center gap-2 text-rose-200">
        🔴 Sharing your screen to <strong>{netName ?? "(net)"}</strong>
      </span>
      <button
        onClick={onStop}
        className="rounded bg-rose-700 px-2 py-0.5 text-xs text-white hover:bg-rose-600"
      >
        Stop sharing
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount in Home.tsx**

Add the bar at the top of Home, above the existing content. Pass:
- `localShare`: from props (sourced from ShareEngine via NetListPanel/AppState — wire through)
- `netName`: resolved from `serverInstance.entry.nets` or `voiceEngine.listNets()` by `matrixRoomId`
- `onStop`: `shareEngine.stopLocalShare()`

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/SharingStatusBar.tsx client/src/renderer/screens/Home.tsx
git commit -m "client(share): persistent sharing-now status bar with Stop button"
```

---

## Task 9: Unit tests for ShareEngine state transitions

**Files:**
- Create: `client/tests/unit/shareEngine.test.ts`

Test the parts of ShareEngine that don't require a real LiveKit Room — the state-machine logic for tracking remote shares and enforcing single-local-share. Use a fake VoiceEngine and fake Room objects with EventEmitter for trackSubscribed/trackUnsubscribed.

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShareEngine } from "@/renderer/share/ShareEngine";
import type { ActiveShareSummary } from "@/renderer/share/types";

class FakeEmitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  on(event: string, fn: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }
}

function makeFakeRoom() {
  const emitter = new FakeEmitter();
  return Object.assign(emitter, {
    localParticipant: {
      publishTrack: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function makeFakeVoiceEngine(rooms: Map<string, ReturnType<typeof makeFakeRoom>>) {
  return {
    getLiveKitRoom(matrixRoomId: string) {
      return rooms.get(matrixRoomId) ?? null;
    },
  } as never;
}

function fakeRemoteTrackEvent(source: "screen_share" | "screen_share_audio", participantIdentity: string) {
  const track = { kind: source === "screen_share" ? "video" : "audio" };
  const publication = {
    source: source === "screen_share" ? "screen_share" : "screen_share_audio",
    track,
  };
  const participant = { identity: participantIdentity };
  return { track, publication, participant };
}

describe("ShareEngine", () => {
  let rooms: Map<string, ReturnType<typeof makeFakeRoom>>;
  let engine: ShareEngine;
  let started: ActiveShareSummary[];
  let ended: Array<{ matrixRoomId: string; sharerIdentity: string }>;

  beforeEach(() => {
    rooms = new Map([["!room1:hf.example", makeFakeRoom()]]);
    engine = new ShareEngine(makeFakeVoiceEngine(rooms));
    started = [];
    ended = [];
    engine.on({
      onShareStarted: (s) => started.push(s),
      onShareEnded: (roomId, identity) => ended.push({ matrixRoomId: roomId, sharerIdentity: identity }),
    });
  });

  it("attachRoom is idempotent", () => {
    engine.attachRoom("!room1:hf.example");
    engine.attachRoom("!room1:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
  });

  it("attachRoom no-ops for an unmonitored room", () => {
    engine.attachRoom("!missing:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
  });

  it("startLocalShare throws when no local share, but room is missing", async () => {
    await expect(
      engine.startLocalShare("!missing:hf.example", new MediaStream()),
    ).rejects.toThrow(/not currently monitored/);
  });

  it("startLocalShare rejects when a local share is already active", async () => {
    // Manually populate localShare via test-only access
    (engine as unknown as { localShare: unknown }).localShare = {
      matrixRoomId: "!room1:hf.example",
      videoTrack: {} as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    await expect(
      engine.startLocalShare("!room1:hf.example", new MediaStream()),
    ).rejects.toThrow(/already active/);
  });

  it("stopLocalShare on null state is a no-op", async () => {
    await expect(engine.stopLocalShare()).resolves.toBeUndefined();
  });

  it("detachRoom clears any remote shares for that room and emits onShareEnded", () => {
    // Inject a fake remote share directly
    const fake: ActiveShareSummary = {
      matrixRoomId: "!room1:hf.example",
      sharerIdentity: "@bob:hf.example",
      sharerMatrixUserId: "@bob:hf.example",
      videoTrack: {} as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    (engine as unknown as { remoteShares: Map<string, ActiveShareSummary> }).remoteShares.set(
      "!room1:hf.example::@bob:hf.example",
      fake,
    );
    engine.detachRoom("!room1:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
    expect(ended).toEqual([{ matrixRoomId: "!room1:hf.example", sharerIdentity: "@bob:hf.example" }]);
  });

  it("shutdown clears all state", () => {
    engine.attachRoom("!room1:hf.example");
    (engine as unknown as { localShare: unknown }).localShare = {
      matrixRoomId: "!room1:hf.example",
      videoTrack: { stop: vi.fn() } as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    engine.shutdown();
    expect(engine.getActiveShares()).toHaveLength(0);
    expect(engine.getLocalShare()).toBeNull();
  });
});
```

Note: these tests cover the state-machine surface. They do NOT exercise the full LiveKit RoomEvent paths because RoomEvent constants and Track.Source enum values are part of `livekit-client`'s runtime — a full mock would be fragile. The real attach/detach round-trip is exercised at integration time.

- [ ] **Step 2: Run tests + commit**

```bash
cd /home/shreen/code/tactical-radio/client && npx vitest run tests/unit/shareEngine.test.ts 2>&1 | tail -8
```

Expected: 7 passed.

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/shareEngine.test.ts
git commit -m "client(test): ShareEngine state-machine unit tests"
```

---

## Task 10: Rebuild installers + smoke test

**Files:** none (build artifacts only)

- [ ] **Step 1: Build both targets**

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
```

- [ ] **Step 2: List output**

```bash
ls -lh /home/shreen/code/tactical-radio/client/release/Hailfreq-*
```

Expected: AppImage + .exe + .blockmap. Size should be within ~5MB of Plan 8a's output (LiveKit is already bundled; no new heavy deps).

No commit unless something broke.

---

## Task 11: README + spec note

**Files:**
- Modify: `client/README.md`
- Modify: `docs/superpowers/specs/2026-05-26-hailfreq-design.md`

- [ ] **Step 1: README bullet**

```markdown
- Screen sharing — share a screen or window to one net at a time, SFrame E2EE same as voice, optional system audio; subscribers see a 📺 indicator and open a viewer pane
```

Add it at the end of the existing feature bullet list, after the focused-app PTT bullet from Plan 8a.

- [ ] **Step 2: Spec section 15**

Append to `docs/superpowers/specs/2026-05-26-hailfreq-design.md`:

```markdown
## 15. Screen Sharing (Hailfreq extension, beyond original spec)

Implemented in Plan 8b. Adds Discord-style screen sharing to Hailfreq nets, end-to-end-encrypted via the same SFrame infrastructure that protects voice. Used during ops planning — showing a star map, ship loadout, mission briefing — without trusting the SFU or Matrix homeserver to see the content.

### Architecture

- A `ShareEngine` parallel to `VoiceEngine` reuses the same LiveKit Room objects via `VoiceEngine.getLiveKitRoom(matrixRoomId)`
- Publisher path: Electron `desktopCapturer.getSources` → user picks source → `getUserMedia` (legacy `chromeMediaSource: "desktop"` constraints, required by Electron's Chromium) → `room.localParticipant.publishTrack(...)` with the existing room SFrame key
- Subscriber path: `RoomEvent.TrackSubscribed` filtered to `Track.Source.ScreenShare` and `Track.Source.ScreenShareAudio` → React viewer pane attaches `RemoteVideoTrack` / `RemoteAudioTrack` to `<video>` / `<audio>` elements
- Single concurrent local share (across all nets) to bound bandwidth and UX
- Remote participants can each share independently; multiple viewer panes are not blocked by a local share

### UX surfaces

- "Share" button on each monitored net row (disabled when any local share is active)
- "🔴 Sharing" indicator + Stop button when the local user is sharing to that net
- "📺" indicator + click-to-view when a remote share is active in that net
- Persistent "Sharing to <net>" status bar across the top of Home while local share is active (privacy reminder + quick-stop)
- Source picker modal: thumbnails of screens + windows, "share system audio" opt-in checkbox

### Privacy posture

- Sharer always sees the OS-level source picker before any frame is captured (Electron's standard desktopCapturer flow)
- Frames are SFrame-encrypted in the sharer's renderer using the room's existing voice key; the LiveKit SFU receives ciphertext and cannot decrypt
- Subscribers decrypt using the same key they already hold for voice
- No source name, window title, or frame data is logged or transmitted off-machine beyond the SFrame-encrypted track payload

### Known limitations

- macOS not tested (no macOS installer per scope)
- System-audio capture works on Linux/Windows entire-screen sources; window-specific sources are typically silent
- No annotation, recording, or remote control
- No admin-board "disable sharing" policy yet — any monitoring member can share
- Bandwidth: screen video over SFrame is heavy. Default constraints cap at 1920x1080 / 30fps; finer control deferred
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/2026-05-26-hailfreq-design.md
git commit -m "docs: screen sharing shipped (Plan 8b)"
```

---

## Done

After Task 11, the deliverable is:

- ShareEngine parallel to VoiceEngine reusing the same LiveKit Rooms
- Native source picker via `desktopCapturer` (screens + windows + thumbnails)
- Local share lifecycle (start / stop / auto-stop on OS toolbar)
- Remote share tracking with multiple concurrent sharers supported
- Source picker modal + viewer pane + sharing-now status bar + per-net indicators
- 7 unit tests for ShareEngine state transitions
- Rebuilt installers
- README + spec §15

**Known v1 limitations:**

- macOS not tested
- System audio: entire-screen sources only on Linux/Windows
- No annotation, recording, remote control, or admin-policy gating
- One concurrent local share (intentional)

**Next plans:**

- **Plan 8c** — Net Bridges (cross-server allies coordination), needs design pass on default mode + dedup before writing tasks
