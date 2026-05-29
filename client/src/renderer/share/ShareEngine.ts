import type { VoiceEngine } from "../voice/VoiceEngine";
import {
  type RemoteTrack,
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
  private wiredRooms = new Set<string>();

  constructor(voiceEngine: VoiceEngine) {
    this.voiceEngine = voiceEngine;
  }

  on(events: ShareEngineEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  attachRoom(matrixRoomId: string): void {
    if (this.wiredRooms.has(matrixRoomId)) return;
    const room = this.voiceEngine.getLiveKitRoom(matrixRoomId);
    if (!room) return;

    // RoomEventCallbacks.trackSubscribed: (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant)
    const onTrackSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (
        publication.source !== Track.Source.ScreenShare &&
        publication.source !== Track.Source.ScreenShareAudio
      ) {
        return;
      }
      this.handleRemoteScreenTrack(matrixRoomId, participant, publication, track);
    };

    const onTrackUnsubscribed = (
      _track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.source !== Track.Source.ScreenShare) return;
      this.handleRemoteShareEnded(matrixRoomId, participant.identity);
    };

    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      this.handleRemoteShareEnded(matrixRoomId, participant.identity);
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    this.wiredRooms.add(matrixRoomId);
  }

  detachRoom(matrixRoomId: string): void {
    this.wiredRooms.delete(matrixRoomId);
    // Snapshot keys first to avoid mutation-during-iteration hazard
    const keysToRemove = Array.from(this.remoteShares.keys()).filter((key) =>
      key.startsWith(`${matrixRoomId}::`),
    );
    for (const key of keysToRemove) {
      const share = this.remoteShares.get(key);
      if (share) {
        this.remoteShares.delete(key);
        this.listeners.onShareEnded?.(share.matrixRoomId, share.sharerIdentity);
      }
    }
  }

  getActiveShares(): ActiveShareSummary[] {
    return Array.from(this.remoteShares.values());
  }

  getLocalShare(): LocalShareState | null {
    return this.localShare;
  }

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

    // Dynamic import to avoid pulling LocalVideoTrack/LocalAudioTrack constructors
    // into the bundle until they are actually needed. In livekit-client v2.x these
    // are named exports from the main package entry point.
    const { LocalVideoTrack: LVT, LocalAudioTrack: LAT } = await import("livekit-client");
    // userProvidedTrack=true tells the SDK not to release/reacquire the track
    // internally — we own the MediaStreamTrack lifecycle via the browser
    // desktopCapturer flow.
    const videoTrack: LocalVideoTrack = new LVT(videoMediaTrack, undefined, true);
    const audioTrack: LocalAudioTrack | null = audioMediaTrack
      ? new LAT(audioMediaTrack, undefined, true)
      : null;

    await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare });
    if (audioTrack) {
      await room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
      });
    }

    // When the OS/browser ends the capture (e.g., user clicks "Stop Sharing"),
    // the underlying MediaStreamTrack fires "ended". Treat this as a stop.
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
    // Clear first so re-entrant calls from the "ended" event listener no-op
    this.localShare = null;

    const room = this.voiceEngine.getLiveKitRoom(state.matrixRoomId);
    if (room) {
      try {
        await room.localParticipant.unpublishTrack(state.videoTrack);
      } catch (err) {
        console.error("[ShareEngine] failed to unpublish video track:", err);
      }
      if (state.audioTrack) {
        try {
          await room.localParticipant.unpublishTrack(state.audioTrack);
        } catch (err) {
          console.error("[ShareEngine] failed to unpublish audio track:", err);
        }
      }
    }

    state.videoTrack.stop();
    state.audioTrack?.stop();
    this.listeners.onLocalShareEnded?.(state.matrixRoomId);
  }

  private handleRemoteScreenTrack(
    matrixRoomId: string,
    participant: RemoteParticipant,
    publication: RemoteTrackPublication,
    track: RemoteTrack,
  ): void {
    const key = `${matrixRoomId}::${participant.identity}`;
    const existing = this.remoteShares.get(key);

    if (publication.source === Track.Source.ScreenShare) {
      const videoTrack = track as RemoteVideoTrack;
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
      const audioTrack = track as RemoteAudioTrack;
      // Create updated summary with audio track — immutable-style replacement
      const updated: ActiveShareSummary = { ...existing, audioTrack };
      this.remoteShares.set(key, updated);
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

function deriveMatrixIdFromParticipant(identity: string): string | null {
  if (identity.startsWith("@") && identity.includes(":")) return identity;
  return null;
}
