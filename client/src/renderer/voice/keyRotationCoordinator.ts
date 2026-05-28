import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { rotateSframeKey, listSframeKeys } from "./sframeKeys";

const SFRAME_KEY_EVENT = "org.hailfreq.net.sframe-key";

export interface RotationHandle {
  unsubscribe(): void;
}

export interface CoordinatorEvents {
  /**
   * Called whenever a new SFrame key is observed — either because this member
   * just rotated it, or because a remote rotation event arrived on the timeline.
   */
  onNewKey: (matrixRoomId: string, keyBytes: Uint8Array, keyIndex: number) => void;
}

/**
 * Listen for kicks/bans on every monitored voice-net Matrix room and trigger
 * forward-secrecy key rotation. Also propagates remote rotation events so all
 * members apply the same new key.
 *
 * Rotation design:
 *   - Trigger: RoomMember.membership where prev=join, new=leave|ban, sender≠target
 *   - Every member with PL≥50 independently generates + uploads a new key.
 *     Multiple concurrent uploads are benign: each occupies a distinct timeline
 *     position; all members pick up the latest key they observe.
 *   - Remote rotations: Room.timeline events of type org.hailfreq.net.sframe-key
 *     from other senders cause onNewKey to fire with the newest key in the room.
 *
 * Null-safety: the keyProvider may not be configured yet (Task 12 wires E2EE);
 * the caller (VoiceEngine) guards with instanceof ExternalE2EEKeyProvider before
 * calling setKey.
 */
export function startKeyRotationCoordinator(
  client: MatrixClient,
  netMatrixRoomIds: () => Set<string>,
  events: CoordinatorEvents,
): RotationHandle {
  /**
   * Membership-change handler: detect forced removal (kick or ban) and rotate.
   * `event` is a MatrixEvent of type m.room.member; `_member` is unused but
   * required by the SDK's RoomMember.membership signature.
   */
  const membershipHandler = async (event: MatrixEvent): Promise<void> => {
    if (event.getType() !== "m.room.member") return;

    const roomId = event.getRoomId();
    if (!roomId || !netMatrixRoomIds().has(roomId)) return;

    const prevMembership = event.getPrevContent()?.membership as string | undefined;
    const nextMembership = (event.getContent()?.membership) as string | undefined;
    const sender = event.getSender();
    const target = event.getStateKey();

    // Only act on kicks (forced leave) or bans initiated by someone else.
    const isForcedRemoval =
      prevMembership === "join" &&
      (nextMembership === "leave" || nextMembership === "ban") &&
      sender != null &&
      target != null &&
      sender !== target;

    if (!isForcedRemoval) return;

    const room = client.getRoom(roomId);
    if (!room) return;

    // Only PL≥50 members participate in rotation (i.e., speakers / moderators).
    const myPl = room.getMember(client.getSafeUserId())?.powerLevel ?? 0;
    if (myPl < 50) return;

    try {
      const { keyBytes, keyIndex } = await rotateSframeKey(client, roomId);
      events.onNewKey(roomId, keyBytes, keyIndex);
    } catch (err) {
      console.error(`[keyRotationCoordinator] Key rotation failed for ${roomId}:`, err);
    }
  };

  /**
   * Timeline handler: pick up key-rotation events published by other members.
   * Skip own events — we already applied the key in membershipHandler above.
   * Wait briefly if the event is still being Megolm-decrypted.
   */
  const timelineHandler = async (event: MatrixEvent): Promise<void> => {
    if (event.getType() !== SFRAME_KEY_EVENT) return;

    const roomId = event.getRoomId();
    if (!roomId || !netMatrixRoomIds().has(roomId)) return;

    // Own uploads are handled by the membershipHandler path; skip here to avoid
    // double-application on the rotating member's device.
    if (event.getSender() === client.getSafeUserId()) return;

    // Give the SDK a short window to finish Megolm decryption before reading.
    if (event.isBeingDecrypted()) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    // Re-scan the full timeline so the index assignment is authoritative
    // regardless of whether this device missed earlier key events.
    const all = await listSframeKeys(client, roomId);
    const latest = all[all.length - 1];
    if (!latest) return;

    events.onNewKey(roomId, latest.keyBytes, latest.keyIndex);
  };

  client.on("RoomMember.membership" as any, membershipHandler);
  client.on("Room.timeline" as any, timelineHandler);

  return {
    unsubscribe() {
      client.off("RoomMember.membership" as any, membershipHandler);
      client.off("Room.timeline" as any, timelineHandler);
    },
  };
}
