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
  private vadGates = new Map<string, VadGate>(); // key: participant identity (smart/ptt-relay modes)
  private activeRelays = new Map<string, RelayHandle>(); // key: participant identity
  private playedChirpThisSession = false;
  private sourceRoomListenerAttached = false;
  // Stored listener references so stop() can reliably call room.off() — same
  // idiom as ShareEngine (Plan 8b Task 2 fix).
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
      if (!sourceRoom) {
        throw new Error(`Source room not monitored (server=${source.serverId} room=${source.matrixRoomId})`);
      }
      if (!targetRoom) {
        throw new Error(`Target room not monitored (server=${target.serverId} room=${target.matrixRoomId})`);
      }

      // Process existing remote audio tracks that arrived before this runner started.
      for (const participant of sourceRoom.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track && publication.source === Track.Source.Microphone) {
            this.handleSourceTrack(publication.track as RemoteAudioTrack, participant, targetRoom);
          }
        }
      }

      // Subscribe to future audio tracks — store references for reliable removal.
      const onTrackSubscribed = (
        track: unknown,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (publication.source !== Track.Source.Microphone) return;
        if (publication.kind !== Track.Kind.Audio) return;
        this.handleSourceTrack(track as RemoteAudioTrack, participant, targetRoom);
      };
      const onTrackUnsubscribed = (
        _track: unknown,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (publication.source !== Track.Source.Microphone) return;
        if (publication.kind !== Track.Kind.Audio) return;
        void this.dropParticipantRelay(participant.identity);
      };

      sourceRoom.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      sourceRoom.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      // Store so stop() can remove them via room.off().
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

    // Detach source room listeners using stored references.
    const source = this.ctx.direction === "forward" ? this.ctx.config.source : this.ctx.config.target;
    const sourceRoom = this.ctx.getRoom(source.serverId, source.matrixRoomId);
    if (sourceRoom && this.sourceRoomListenerAttached) {
      if (this.onTrackSubscribed) {
        sourceRoom.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed as never);
      }
      if (this.onTrackUnsubscribed) {
        sourceRoom.off(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed as never);
      }
    }
    this.sourceRoomListenerAttached = false;
    this.onTrackSubscribed = null;
    this.onTrackUnsubscribed = null;

    // Stop all VAD gates first, then unpublish all relays.
    for (const gate of this.vadGates.values()) {
      gate.stop();
    }
    this.vadGates.clear();
    for (const relay of this.activeRelays.values()) {
      await relay.stop();
    }
    this.activeRelays.clear();

    // Reset chirp flag so re-starting this runner plays the chirp again.
    this.playedChirpThisSession = false;
  }

  private handleSourceTrack(
    track: RemoteAudioTrack,
    participant: RemoteParticipant,
    targetRoom: Room,
  ): void {
    const mode = this.ctx.config.mode;

    if (mode === "always-on") {
      // No VAD — relay immediately.
      void this.startRelayFor(participant.identity, track, targetRoom);
      return;
    }

    if (mode === "smart") {
      const mediaStreamTrack = track.mediaStreamTrack;
      if (!mediaStreamTrack) return;
      const gate = new VadGate(mediaStreamTrack, {
        threshold: this.ctx.config.smartThreshold,
        hangoverMs: 800,
      });
      gate.on({
        onOpen: () => {
          void this.startRelayFor(participant.identity, track, targetRoom);
        },
        onClose: () => {
          void this.dropParticipantRelay(participant.identity);
        },
      });
      this.replaceVadGate(participant.identity, gate);
      return;
    }

    if (mode === "ptt-relay") {
      // PTT-relay uses the same RMS-based gate as smart mode but with a higher
      // threshold (0.08) and shorter hangover (300 ms) so it only opens during
      // active speech bursts, matching PTT-style transmission detection.
      // This avoids relying on LiveKit's internal isSpeaking smoothing.
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
      this.replaceVadGate(participant.identity, gate);
      return;
    }
  }

  private replaceVadGate(participantIdentity: string, gate: VadGate): void {
    const existing = this.vadGates.get(participantIdentity);
    if (existing) {
      this.vadGates.delete(participantIdentity);
      existing.stop();
    }
    gate.start();
    this.vadGates.set(participantIdentity, gate);
  }

  private async startRelayFor(
    participantIdentity: string,
    track: RemoteAudioTrack,
    targetRoom: Room,
  ): Promise<void> {
    // Guard: if relay already active for this participant, do nothing.
    if (this.activeRelays.has(participantIdentity)) return;
    try {
      const target = this.ctx.direction === "forward" ? this.ctx.config.target : this.ctx.config.source;
      // Play chirp exactly once per session per runner.
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
    // Also stop the VAD gate for this participant if one exists.
    const gate = this.vadGates.get(participantIdentity);
    if (gate) {
      this.vadGates.delete(participantIdentity);
      gate.stop();
    }
    // Downgrade status to idle when no relays remain (always-on keeps "relaying"
    // because the relay will re-open as soon as the next track arrives).
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
