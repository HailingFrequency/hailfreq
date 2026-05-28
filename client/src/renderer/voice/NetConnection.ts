import {
  Room,
  RoomEvent,
  RemoteParticipant,
  Track,
  ExternalE2EEKeyProvider,
  type LocalTrack,
  type RemoteAudioTrack,
} from "livekit-client";

export interface NetConnectionEvents {
  trackSubscribed: (track: RemoteAudioTrack, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: RemoteAudioTrack, participant: RemoteParticipant) => void;
  activeSpeakersChanged: (participantIdentities: string[]) => void;
  connectionStateChanged: (state: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
}

export interface E2EEConfig {
  /** The shared SFrame key bytes (32 bytes). */
  keyBytes: Uint8Array;
  /** The Web Worker instance (must be a LiveKit-compatible E2EE worker). */
  worker: Worker;
}

/**
 * Single-room LiveKit connection. Caller wires `on()` callbacks before `connect()`.
 */
export class NetConnection {
  private readonly room: Room;
  private listeners: Partial<NetConnectionEvents> = {};

  constructor(opts?: { e2ee?: E2EEConfig }) {
    const keyProvider = opts?.e2ee ? new ExternalE2EEKeyProvider() : undefined;

    this.room = new Room({
      adaptiveStream: true,
      dynacast: false,
      e2ee: opts?.e2ee && keyProvider
        ? {
            keyProvider,
            worker: opts.e2ee.worker,
          }
        : undefined,
    });

    // Set the key immediately after Room construction if E2EE is configured.
    if (opts?.e2ee && keyProvider) {
      void keyProvider.setKey(opts.e2ee.keyBytes.buffer as ArrayBuffer);
    }

    this.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        this.listeners.trackSubscribed?.(track as RemoteAudioTrack, participant);
      }
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        this.listeners.trackUnsubscribed?.(track as RemoteAudioTrack, participant);
      }
    });
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      this.listeners.activeSpeakersChanged?.(speakers.map((s) => s.identity));
    });
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      this.listeners.connectionStateChanged?.(state as any);
    });
  }

  on<E extends keyof NetConnectionEvents>(event: E, handler: NetConnectionEvents[E]): this {
    this.listeners[event] = handler;
    return this;
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token);
  }

  /**
   * Begin publishing the local microphone track to this room.
   * Toggle this when the user PTTs into a net.
   */
  async startMicPublishing(track: MediaStreamTrack): Promise<void> {
    await this.room.localParticipant.publishTrack(track, {
      name: "microphone",
      source: Track.Source.Microphone,
      dtx: false,
      red: true,
    });
  }

  /** Stop publishing the local microphone. */
  async stopMicPublishing(): Promise<void> {
    const pubs = this.room.localParticipant.getTrackPublications();
    for (const pub of pubs) {
      if (pub.source === Track.Source.Microphone && pub.track) {
        await this.room.localParticipant.unpublishTrack(pub.track as LocalTrack);
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  get connectionState() {
    return this.room.state;
  }

  /** The LiveKit Room instance (for advanced use, e.g., applying E2EE key). */
  get rawRoom(): Room {
    return this.room;
  }
}
