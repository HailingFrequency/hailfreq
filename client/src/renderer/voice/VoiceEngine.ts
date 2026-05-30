import { NetConnection, type E2EEConfig } from "./NetConnection";
import { fetchLiveKitToken, authBaseUrlFromHomeserver } from "./auth";
import { startKeyRotationCoordinator, type RotationHandle } from "./keyRotationCoordinator";
import { fetchSframeKey } from "./sframeKeys";
import { createLiveKitE2EEWorker } from "./e2eeWorker";
import { loadChirp, playChirp } from "./chirpPlayer";
import type { MatrixClient } from "matrix-js-sdk";
import { ExternalE2EEKeyProvider } from "livekit-client";
import type { Room, RemoteAudioTrack, RemoteParticipant } from "livekit-client";
import { micConstraints } from "../audio/deviceConstraints";

/** True if this AudioContext implementation supports setSinkId (Chromium 110+). */
export function audioContextSupportsSinkId(ctor?: typeof AudioContext): boolean {
  return !!ctor && typeof ctor.prototype === "object" && "setSinkId" in ctor.prototype;
}

/** Inbound silence debounce: only play inbound chirp if participant has been silent ≥ this long. */
const INBOUND_CHIRP_DEBOUNCE_MS = 2000;

interface NetState {
  matrixRoomId: string;
  liveKitRoomName: string;
  priority: number;
  connection: NetConnection;
  /** Per-net master gain (0.0–2.0+). User-controlled. */
  volumeGain: GainNode;
  /** Per-net duck gain (0.0–1.0). Auto-modulated by priority ducking. */
  duckGain: GainNode;
  /** Map track.sid → its source AudioNode (for cleanup on unsubscribe). Keyed by sid so multiple tracks per participant are handled correctly. */
  trackNodes: Map<string, MediaStreamAudioSourceNode>;
  /** Set of identities currently active-speaking. */
  activeSpeakers: Set<string>;
  /**
   * Per-participant last-went-silent timestamp (ms). Used by inbound chirp debounce:
   * we only play the inbound chirp if the participant has been silent for ≥ INBOUND_CHIRP_DEBOUNCE_MS.
   * When a participant first appears they are absent from this map (treated as "long-silent").
   */
  participantLastSilentMs: Map<string, number>;
}

export interface VoiceEngineEvents {
  netStateChanged: (matrixRoomId: string, state: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
  activeSpeakersChanged: (matrixRoomId: string, identities: string[]) => void;
  pttStateChanged: (matrixRoomId: string | null) => void;
}

const DUCK_ATTENUATION_DB = -35; // matches Star Comms default
const DUCK_HANGOVER_MS = 250;

/** Per-net chirp configuration (IDs may be "builtin:none" to disable). */
export interface NetChirps {
  inbound: string;
  outbound: string;
}

export class VoiceEngine {
  private readonly client: MatrixClient;
  private readonly authBaseUrl: string;
  private readonly nets = new Map<string, NetState>();
  private audioCtx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  /**
   * Dedicated gain node for chirp playback. Connected directly to outputGain
   * (parallel to the volumeGain→duckGain chain) so chirps are never ducked by
   * priority logic — they always play at full presence.
   */
  private chirpGain: GainNode | null = null;
  private listeners: Partial<VoiceEngineEvents> = {};
  /** The Matrix room ID currently being PTT'd into, or null when not transmitting. */
  private activePttNet: string | null = null;
  /** The captured MediaStream (mic). Allocated lazily on first PTT or getMicSource(). */
  private micStream: MediaStream | null = null;
  private inputDeviceId?: string;
  private outputDeviceId?: string;
  /** AudioContext source node wrapping the mic stream. Used by voice-activation analysis. */
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  /** AnalyserNode connected to the mic source. Created alongside micSourceNode. Used for RMS level metering. */
  private localMicAnalyser: AnalyserNode | null = null;
  /** Hangover timer for priority ducking. */
  private duckHangoverTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Handle to unsubscribe the SFrame key-rotation coordinator on shutdown. */
  private rotationHandle: RotationHandle | null = null;
  /** Per-net chirp ID configuration. Keys are Matrix room IDs. */
  private netChirps = new Map<string, NetChirps>();
  /** Master chirp volume (applied in addition to per-play local gain in chirpPlayer). */
  private chirpVolume = 0.7;
  /** Per-net local mic monitor gain nodes. Active while PTT is live and selfMonitor is enabled. */
  private localMonitorNodes = new Map<string, AudioNode>();
  /** Set of Matrix room IDs for which selfMonitor is currently enabled. */
  private selfMonitorNets = new Set<string>();

  constructor(client: MatrixClient) {
    this.client = client;
    this.authBaseUrl = authBaseUrlFromHomeserver(client.getHomeserverUrl());
    this.rotationHandle = startKeyRotationCoordinator(
      this.client,
      () => new Set(this.nets.keys()),
      {
        onNewKey: (roomId, keyBytes, _keyIndex) => {
          const state = this.nets.get(roomId);
          if (!state) return;
          const e2ee = state.connection.rawRoom.options.e2ee;
          // Guard: e2ee config is wired in Task 12. Skip if not yet configured.
          // Narrow the E2EEOptions union to the variant that carries keyProvider.
          if (!e2ee || !("keyProvider" in e2ee)) return;
          const provider = e2ee.keyProvider;
          if (provider instanceof ExternalE2EEKeyProvider) {
            // ExternalE2EEKeyProvider.setKey accepts ArrayBuffer (HKDF path).
            // keyIndex is managed internally by LiveKit via ratchet slots.
            void provider.setKey(keyBytes.buffer as ArrayBuffer);
          }
        },
      },
    );
  }

  on<E extends keyof VoiceEngineEvents>(event: E, handler: VoiceEngineEvents[E]): this {
    this.listeners[event] = handler;
    return this;
  }

  /**
   * Get the live LiveKit Room for a monitored net, or null if not currently
   * connected. ShareEngine and any future media layer uses this to publish/
   * subscribe additional tracks without duplicating the connection.
   */
  getLiveKitRoom(matrixRoomId: string): Room | null {
    const net = this.nets.get(matrixRoomId);
    return net?.connection.rawRoom ?? null;
  }

  /** Lazily initialize the AudioContext. Must be called from a user gesture (e.g., first net monitor) in some browsers. */
  ensureAudio(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    this.outputGain = this.audioCtx.createGain();
    this.outputGain.gain.value = 1.0;
    this.outputGain.connect(this.audioCtx.destination);
    // chirpGain is wired directly to outputGain, bypassing the per-net
    // volumeGain → duckGain chain. This means chirps are audible regardless
    // of ducking state — a deliberate UX decision: PTT start/stop tones and
    // inbound-keyed tones should always be clearly perceptible.
    this.chirpGain = this.audioCtx.createGain();
    this.chirpGain.gain.value = 1.0;
    this.chirpGain.connect(this.outputGain);
    void this.applyOutputDevice();
  }

  /**
   * Set the chirp IDs for a net. Call this after fetching user prefs, before
   * monitoring or after updating the selection in the UI.
   */
  setChirps(matrixRoomId: string, chirps: NetChirps): void {
    this.netChirps.set(matrixRoomId, { ...chirps });
  }

  /** Adjust the master chirp output volume (0.0–1.0). */
  setChirpVolume(volume: number): void {
    this.chirpVolume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Enable or disable local mic monitoring for a net.
   * When enabled, the user hears their own mic while PTT is active (bypasses
   * the LiveKit round-trip — safe with headphones, may feedback with speakers).
   */
  setSelfMonitor(matrixRoomId: string, enabled: boolean): void {
    if (enabled) {
      this.selfMonitorNets.add(matrixRoomId);
    } else {
      this.selfMonitorNets.delete(matrixRoomId);
      // If currently transmitting on this net, stop the monitor immediately
      if (this.activePttNet === matrixRoomId) {
        this.stopLocalMicMonitor(matrixRoomId);
      }
    }
  }

  /** Subscribe to a net's voice. Connects to LiveKit + sets up audio routing. */
  async monitorNet(args: { matrixRoomId: string; priority: number }): Promise<void> {
    if (this.nets.has(args.matrixRoomId)) return;
    this.ensureAudio();

    const accessToken = this.client.getAccessToken();
    if (!accessToken) throw new Error("Matrix access token missing — cannot fetch LiveKit JWT");

    const { token, url } = await fetchLiveKitToken({
      hailfreqAuthBaseUrl: this.authBaseUrl,
      matrixAccessToken: accessToken,
      matrixRoomId: args.matrixRoomId,
    });

    const keyBytes = await fetchSframeKey(this.client, args.matrixRoomId);
    if (!keyBytes) {
      // SECURITY (H7): refuse to join rather than silently downgrade to
      // unencrypted voice. A missing authorized key means the net was
      // misconfigured or key delivery was suppressed — joining unencrypted
      // would break the privacy guarantee without the user knowing.
      throw new Error(
        `Refusing to monitor net ${args.matrixRoomId}: no authorized SFrame key available ` +
          `(joining would be unencrypted)`,
      );
    }
    const e2eeConfig: E2EEConfig = { keyBytes, worker: createLiveKitE2EEWorker() };

    const connection = new NetConnection({ e2ee: e2eeConfig });
    const liveKitRoomName = url.split("/").pop() || ""; // best-effort; not load-bearing
    const volumeGain = this.audioCtx!.createGain();
    volumeGain.gain.value = 1.0;
    const duckGain = this.audioCtx!.createGain();
    duckGain.gain.value = 1.0;
    volumeGain.connect(duckGain);
    duckGain.connect(this.outputGain!);

    const state: NetState = {
      matrixRoomId: args.matrixRoomId,
      liveKitRoomName,
      priority: args.priority,
      connection,
      volumeGain,
      duckGain,
      trackNodes: new Map(),
      activeSpeakers: new Set(),
      participantLastSilentMs: new Map(),
    };

    connection
      .on("trackSubscribed", (track, participant) =>
        this.handleTrackSubscribed(state, track, participant),
      )
      .on("trackUnsubscribed", (track, participant) =>
        this.handleTrackUnsubscribed(state, track, participant),
      )
      .on("activeSpeakersChanged", (identities) =>
        this.handleActiveSpeakersChanged(state, identities),
      )
      .on("connectionStateChanged", (s) => {
        this.listeners.netStateChanged?.(args.matrixRoomId, s);
        // Best-effort JWT-expiry recovery: if the connection drops unexpectedly,
        // attempt to re-monitor once. LiveKit JWTs expire after 6 h; a quiet
        // disconnect is the most common symptom. We only retry once to avoid
        // a loop when the net was intentionally unmonitored.
        if (s === "disconnected" && this.nets.has(args.matrixRoomId)) {
          console.warn(`[VoiceEngine] Net ${args.matrixRoomId} disconnected — attempting re-monitor (JWT expiry recovery)`);
          void this.unmonitorNet(args.matrixRoomId).then(() =>
            this.monitorNet({ matrixRoomId: args.matrixRoomId, priority: args.priority }).catch(
              (err: unknown) => {
                console.error("[VoiceEngine] Re-monitor failed for %s:", args.matrixRoomId, err);
              },
            ),
          );
        }
      });

    await connection.connect(url, token);
    this.nets.set(args.matrixRoomId, state);
  }

  /** Stop subscribing to a net. Tears down LiveKit + audio routing. */
  async unmonitorNet(matrixRoomId: string): Promise<void> {
    const state = this.nets.get(matrixRoomId);
    if (!state) return;
    // Delete BEFORE disconnect so the disconnected event handler doesn't try to reconnect
    this.nets.delete(matrixRoomId);
    await state.connection.disconnect();
    state.duckGain.disconnect();
    state.volumeGain.disconnect();
    for (const node of state.trackNodes.values()) {
      node.disconnect();
    }
    const timer = this.duckHangoverTimers.get(matrixRoomId);
    if (timer) clearTimeout(timer);
    this.duckHangoverTimers.delete(matrixRoomId);
  }

  /** Update a net's user-controlled volume (0.0–2.0). */
  setNetVolume(matrixRoomId: string, volume: number): void {
    const state = this.nets.get(matrixRoomId);
    if (!state) return;
    state.volumeGain.gain.setTargetAtTime(volume, this.audioCtx!.currentTime, 0.05);
  }

  /** Push-to-talk: begin transmitting on the named net. */
  async startPtt(matrixRoomId: string): Promise<void> {
    if (this.activePttNet === matrixRoomId) return;
    if (this.activePttNet) await this.stopPtt();
    const state = this.nets.get(matrixRoomId);
    if (!state) throw new Error(`Cannot PTT — not monitoring net ${matrixRoomId}`);

    // getMicSource() lazily allocates micStream and micSourceNode together.
    // This also pre-warms the mic so the first PTT is instant on subsequent calls.
    await this.getMicSource();
    const [micTrack] = this.micStream!.getAudioTracks();
    await state.connection.startMicPublishing(micTrack.clone());
    this.activePttNet = matrixRoomId;
    this.listeners.pttStateChanged?.(matrixRoomId);

    // Start local mic monitor if selfMonitor is enabled for this net
    const net = this.nets.get(matrixRoomId);
    if (net) {
      // selfMonitor flag is carried in the Matrix room properties — fetch from the
      // cached NetSummary that NetListPanel pushed via setNetSelfMonitor, or check
      // the engine's own record if available. Since VoiceEngine doesn't hold a
      // reference to NetSummary, the flag is injected via setSelfMonitor().
      if (this.selfMonitorNets.has(matrixRoomId)) {
        this.startLocalMicMonitor(matrixRoomId);
      }
    }

    // Play outbound chirp locally (not transmitted — we publish only the mic track)
    const outboundId = this.netChirps.get(matrixRoomId)?.outbound ?? "builtin:click";
    void this.playNetChirp(outboundId);
  }

  /** Release PTT — stop transmitting. */
  async stopPtt(): Promise<void> {
    if (!this.activePttNet) return;
    const net = this.activePttNet;
    const state = this.nets.get(net);
    if (state) await state.connection.stopMicPublishing();
    // Stop local mic monitor regardless of selfMonitor flag (safe no-op if not running)
    this.stopLocalMicMonitor(net);
    this.activePttNet = null;
    this.listeners.pttStateChanged?.(null);

    // Play end-of-transmission click (always the built-in click, regardless of outbound selection)
    void this.playNetChirp("builtin:click");
  }

  /**
   * Pipe the user's mic to the local audio output for the duration of a PTT.
   * This lets solo testers hear themselves and confirm the system is functional.
   * Safe to call even when micSourceNode already feeds other nodes — Web Audio
   * supports fan-out, so no existing connections are disturbed.
   */
  private startLocalMicMonitor(matrixRoomId: string): void {
    if (this.localMonitorNodes.has(matrixRoomId)) return;
    const micSource = this.micSourceNode;
    if (!micSource) return;
    const ctx = this.audioCtx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    micSource.connect(gain);
    gain.connect(ctx.destination);
    this.localMonitorNodes.set(matrixRoomId, gain);
  }

  private stopLocalMicMonitor(matrixRoomId: string): void {
    const node = this.localMonitorNodes.get(matrixRoomId);
    if (node) {
      try { node.disconnect(); } catch { /* ignore if already disconnected */ }
      this.localMonitorNodes.delete(matrixRoomId);
    }
  }

  /** Load and play a chirp ID through the dedicated chirp gain node. Errors are swallowed — chirp failures must not interrupt voice. */
  private async playNetChirp(id: string): Promise<void> {
    if (!this.audioCtx || !this.chirpGain) return;
    try {
      const buffer = await loadChirp(this.audioCtx, id);
      if (buffer) playChirp(this.audioCtx, buffer, this.chirpGain, this.chirpVolume);
    } catch (err) {
      console.error("[VoiceEngine] chirp playback error:", err);
    }
  }

  /**
   * Allocate the mic stream and return an AudioContext source node suitable for
   * analysis (e.g., voice-activation). Safe to call multiple times — returns the
   * cached node on subsequent calls. Calling this also pre-warms the mic so the
   * first PTT is instant.
   */
  async getMicSource(): Promise<MediaStreamAudioSourceNode> {
    this.ensureAudio();
    if (!this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints(this.inputDeviceId));
      } catch (err) {
        if (this.inputDeviceId && err instanceof Error && err.name === "OverconstrainedError") {
          console.warn("[VoiceEngine] persisted input device unavailable; falling back to default", err);
          this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints(undefined));
        } else {
          throw err;
        }
      }
    }
    if (!this.micSourceNode) {
      this.micSourceNode = this.audioCtx!.createMediaStreamSource(this.micStream);
      // Wire an analyser for RMS level metering (used by subscribeMicLevel).
      this.localMicAnalyser = this.audioCtx!.createAnalyser();
      this.localMicAnalyser.fftSize = 1024;
      this.micSourceNode.connect(this.localMicAnalyser);
    }
    return this.micSourceNode;
  }

  /** Set persisted audio devices and apply them live. Call after construction and on settings change. */
  async setAudioDevices(opts: { inputDeviceId?: string; outputDeviceId?: string }): Promise<void> {
    const inputChanged = opts.inputDeviceId !== this.inputDeviceId;
    this.inputDeviceId = opts.inputDeviceId;
    this.outputDeviceId = opts.outputDeviceId;
    await this.applyOutputDevice();
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

  /**
   * Subscribe to the local mic's RMS level (0..1).
   * Polls at ~30 Hz while a mic analyser is available (i.e., after the first
   * PTT or voice-activation mode starts the mic). Returns 0 when the mic has
   * not been captured yet — the meter is "live" once the user engages PTT or
   * enables voice-activation mode.
   */
  subscribeMicLevel(cb: (rms: number) => void): () => void {
    const buf = new Float32Array(1024);
    const timer = setInterval(() => {
      if (!this.localMicAnalyser) {
        cb(0);
        return;
      }
      this.localMicAnalyser.getFloatTimeDomainData(buf);
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) sumSquares += buf[i] * buf[i];
      cb(Math.sqrt(sumSquares / buf.length));
    }, 33);
    return () => clearInterval(timer);
  }

  async shutdown(): Promise<void> {
    this.rotationHandle?.unsubscribe();
    this.rotationHandle = null;
    await this.stopPtt();
    // Disconnect any remaining local monitor nodes (stopPtt covers active PTT net,
    // but clean up any lingering nodes defensively)
    for (const node of this.localMonitorNodes.values()) {
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.localMonitorNodes.clear();
    this.selfMonitorNets.clear();
    for (const id of Array.from(this.nets.keys())) {
      await this.unmonitorNet(id);
    }
    if (this.localMicAnalyser) {
      this.localMicAnalyser.disconnect();
      this.localMicAnalyser = null;
    }
    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
      this.micSourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.chirpGain) {
      this.chirpGain.disconnect();
      this.chirpGain = null;
    }
    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
      this.outputGain = null;
    }
    for (const t of this.duckHangoverTimers.values()) clearTimeout(t);
    this.duckHangoverTimers.clear();
  }

  // --- Internals ---

  private handleTrackSubscribed(state: NetState, track: RemoteAudioTrack, participant: RemoteParticipant): void {
    if (!this.audioCtx) return;
    if (!track.sid) return; // sid is undefined for unpublished tracks; skip
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = this.audioCtx.createMediaStreamSource(stream);
    source.connect(state.volumeGain);
    state.trackNodes.set(track.sid, source);

    // Inbound chirp debounce: only play the inbound tone if this participant has
    // been silent for at least INBOUND_CHIRP_DEBOUNCE_MS. New participants (not yet
    // in the map) are treated as "long-silent" so their first transmission triggers
    // the chirp. This prevents spamming the tone on brief reconnects.
    const identity = participant.identity;
    const lastSilentMs = state.participantLastSilentMs.get(identity);
    const silentDurationMs =
      lastSilentMs !== undefined ? Date.now() - lastSilentMs : Infinity;
    if (silentDurationMs >= INBOUND_CHIRP_DEBOUNCE_MS) {
      const inboundId = this.netChirps.get(state.matrixRoomId)?.inbound ?? "builtin:classic-two-tone";
      void this.playNetChirp(inboundId);
    }
  }

  private handleTrackUnsubscribed(state: NetState, track: RemoteAudioTrack, _participant: RemoteParticipant): void {
    if (!track.sid) return;
    const node = state.trackNodes.get(track.sid);
    if (node) {
      node.disconnect();
      state.trackNodes.delete(track.sid);
    }
  }

  private handleActiveSpeakersChanged(state: NetState, identities: string[]): void {
    const newActive = new Set(identities);
    // Record silence timestamp for any participant that just stopped speaking
    for (const identity of state.activeSpeakers) {
      if (!newActive.has(identity)) {
        state.participantLastSilentMs.set(identity, Date.now());
      }
    }
    state.activeSpeakers = newActive;
    this.listeners.activeSpeakersChanged?.(state.matrixRoomId, identities);
    this.recomputeDucking();
  }

  /**
   * Priority ducking: if any net with higher priority has an active speaker,
   * attenuate ALL lower-priority nets by DUCK_ATTENUATION_DB. Use exponential
   * ramps for smooth audio.
   */
  private recomputeDucking(): void {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    // Find the highest priority with active speakers
    let maxActivePriority = -Infinity;
    for (const state of this.nets.values()) {
      if (state.activeSpeakers.size > 0 && state.priority > maxActivePriority) {
        maxActivePriority = state.priority;
      }
    }

    for (const state of this.nets.values()) {
      // Cancel any pending hangover timer for this net
      const pending = this.duckHangoverTimers.get(state.matrixRoomId);
      if (pending) {
        clearTimeout(pending);
        this.duckHangoverTimers.delete(state.matrixRoomId);
      }

      const shouldDuck = state.priority < maxActivePriority;
      if (shouldDuck) {
        // dB to linear: 10^(dB/20)
        const target = Math.pow(10, DUCK_ATTENUATION_DB / 20);
        state.duckGain.gain.setTargetAtTime(target, now, 0.04);
      } else {
        // Schedule un-duck with hangover delay
        const timer = setTimeout(() => {
          state.duckGain.gain.setTargetAtTime(1.0, this.audioCtx!.currentTime, 0.08);
          this.duckHangoverTimers.delete(state.matrixRoomId);
        }, DUCK_HANGOVER_MS);
        this.duckHangoverTimers.set(state.matrixRoomId, timer);
      }
    }
  }
}
