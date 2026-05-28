import { NetConnection } from "./NetConnection";
import { fetchLiveKitToken, authBaseUrlFromHomeserver } from "./auth";
import type { MatrixClient } from "matrix-js-sdk";
import type { RemoteAudioTrack, RemoteParticipant } from "livekit-client";

interface NetState {
  matrixRoomId: string;
  liveKitRoomName: string;
  priority: number;
  connection: NetConnection;
  /** Per-net master gain (0.0–2.0+). User-controlled. */
  volumeGain: GainNode;
  /** Per-net duck gain (0.0–1.0). Auto-modulated by priority ducking. */
  duckGain: GainNode;
  /** Map participant identity → its source AudioNode (for cleanup on unsubscribe). */
  trackNodes: Map<string, MediaStreamAudioSourceNode>;
  /** Set of identities currently active-speaking. */
  activeSpeakers: Set<string>;
}

export interface VoiceEngineEvents {
  netStateChanged: (matrixRoomId: string, state: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
  activeSpeakersChanged: (matrixRoomId: string, identities: string[]) => void;
}

const DUCK_ATTENUATION_DB = -35; // matches Star Comms default
const DUCK_HANGOVER_MS = 250;

export class VoiceEngine {
  private readonly client: MatrixClient;
  private readonly authBaseUrl: string;
  private readonly nets = new Map<string, NetState>();
  private audioCtx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private listeners: Partial<VoiceEngineEvents> = {};
  /** The Matrix room ID currently being PTT'd into, or null when not transmitting. */
  private activePttNet: string | null = null;
  /** The captured MediaStream (mic). Allocated lazily on first PTT or getMicSource(). */
  private micStream: MediaStream | null = null;
  /** AudioContext source node wrapping the mic stream. Used by voice-activation analysis. */
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  /** Hangover timer for priority ducking. */
  private duckHangoverTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(client: MatrixClient) {
    this.client = client;
    this.authBaseUrl = authBaseUrlFromHomeserver(client.getHomeserverUrl());
  }

  on<E extends keyof VoiceEngineEvents>(event: E, handler: VoiceEngineEvents[E]): this {
    this.listeners[event] = handler;
    return this;
  }

  /** Lazily initialize the AudioContext. Must be called from a user gesture (e.g., first net monitor) in some browsers. */
  ensureAudio(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    this.outputGain = this.audioCtx.createGain();
    this.outputGain.gain.value = 1.0;
    this.outputGain.connect(this.audioCtx.destination);
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

    const connection = new NetConnection();
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
      .on("connectionStateChanged", (s) =>
        this.listeners.netStateChanged?.(args.matrixRoomId, s),
      );

    await connection.connect(url, token);
    this.nets.set(args.matrixRoomId, state);
  }

  /** Stop subscribing to a net. Tears down LiveKit + audio routing. */
  async unmonitorNet(matrixRoomId: string): Promise<void> {
    const state = this.nets.get(matrixRoomId);
    if (!state) return;
    await state.connection.disconnect();
    state.duckGain.disconnect();
    state.volumeGain.disconnect();
    for (const node of state.trackNodes.values()) {
      node.disconnect();
    }
    this.nets.delete(matrixRoomId);
    const timer = this.duckHangoverTimers.get(matrixRoomId);
    if (timer) clearTimeout(timer);
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

    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    }
    const [micTrack] = this.micStream.getAudioTracks();
    await state.connection.startMicPublishing(micTrack.clone());
    this.activePttNet = matrixRoomId;
  }

  /** Release PTT — stop transmitting. */
  async stopPtt(): Promise<void> {
    if (!this.activePttNet) return;
    const state = this.nets.get(this.activePttNet);
    if (state) await state.connection.stopMicPublishing();
    this.activePttNet = null;
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
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    }
    if (!this.micSourceNode) {
      this.micSourceNode = this.audioCtx!.createMediaStreamSource(this.micStream);
    }
    return this.micSourceNode;
  }

  async shutdown(): Promise<void> {
    await this.stopPtt();
    for (const id of Array.from(this.nets.keys())) {
      await this.unmonitorNet(id);
    }
    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
      this.micSourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
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
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = this.audioCtx.createMediaStreamSource(stream);
    source.connect(state.volumeGain);
    state.trackNodes.set(participant.identity, source);
  }

  private handleTrackUnsubscribed(state: NetState, _track: RemoteAudioTrack, participant: RemoteParticipant): void {
    const node = state.trackNodes.get(participant.identity);
    if (node) {
      node.disconnect();
      state.trackNodes.delete(participant.identity);
    }
  }

  private handleActiveSpeakersChanged(state: NetState, identities: string[]): void {
    state.activeSpeakers = new Set(identities);
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
