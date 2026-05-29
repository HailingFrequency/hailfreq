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
 * `trackName` should be the operator's "(via <bridge name>)" suffix
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
