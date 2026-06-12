import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { getRoster } from "./operations";
import { OPERATION_EVENT } from "./operations";
import type { Roster } from "./operationTypes";

// ---------------------------------------------------------------------------
// channelsForUser
// ---------------------------------------------------------------------------

/**
 * Return the deduplicated circuitIds from a Roster for entries belonging to
 * `userId` whose status is 'assigned' or 'joined' and circuitId is non-empty.
 * Pending entries are excluded.
 */
export function channelsForUser(roster: Roster, userId: string): string[] {
  const seen = new Set<string>();
  for (const entry of roster.entries) {
    if (entry.userId !== userId) continue;
    if (entry.status !== "assigned" && entry.status !== "joined") continue;
    if (!entry.circuitId) continue;
    seen.add(entry.circuitId);
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// placeUserInOperation
// ---------------------------------------------------------------------------

/**
 * Read the roster for `operationId`, compute the channels assigned/joined for
 * `userId`, and attempt to join each one the user is not already in.
 *
 * Per-channel failures are logged and collected — they are never thrown.
 * Returns a summary of joined and failed channel IDs.
 */
export async function placeUserInOperation(
  client: MatrixClient,
  operationId: string,
  userId: string,
): Promise<{ joined: string[]; failed: string[] }> {
  const roster = getRoster(client, operationId);
  const channels = channelsForUser(roster, userId);

  const joined: string[] = [];
  const failed: string[] = [];

  for (const channelId of channels) {
    const room = (client as any).getRoom(channelId);
    const alreadyJoined =
      room != null &&
      typeof room.getMyMembership === "function" &&
      room.getMyMembership() === "join";

    if (alreadyJoined) continue;

    try {
      await (client as any).joinRoom(channelId);
      joined.push(channelId);
    } catch (err) {
      console.error(
        `[autoPlacement] Failed to join channel ${channelId} for user ${userId} in operation ${operationId}:`,
        err,
      );
      failed.push(channelId);
    }
  }

  return { joined, failed };
}

// ---------------------------------------------------------------------------
// watchOperationActivation
// ---------------------------------------------------------------------------

/**
 * Subscribe to Matrix RoomState.events updates.
 *
 * When an `org.hailfreq.operation` state event arrives whose content.state
 * is "active" AND the previous state was not "active", fires
 * `onActivated(roomId)` once per operation per subscription lifetime (guarded
 * by an internal Set to prevent duplicate firing).
 *
 * Returns an unsubscribe function that removes the listener.
 *
 * Intended usage:
 * ```ts
 * // const unsub = watchOperationActivation(client, (opId) => {
 * //   void placeUserInOperation(client, opId, client.getUserId()!);
 * // });
 * ```
 */
export function watchOperationActivation(
  client: MatrixClient,
  onActivated: (operationId: string) => void,
): () => void {
  const activatedOps = new Set<string>();

  const handler = (
    event: MatrixEvent,
    _state: unknown,
    _prevEvent: MatrixEvent | null,
  ): void => {
    if ((event as any).getType() !== OPERATION_EVENT) return;

    const content = (event as any).getContent() as Record<string, unknown>;
    if (content.state !== "active") return;

    // If prevContent is available and was already active, skip (not a transition)
    const prevContent = (event as any).getPrevContent() as
      | Record<string, unknown>
      | null
      | undefined;
    if (prevContent && prevContent.state === "active") return;

    const roomId = (event as any).getRoomId() as string;
    if (!roomId) return;

    // Guard against duplicate firing within this subscription's lifetime
    if (activatedOps.has(roomId)) return;
    activatedOps.add(roomId);

    onActivated(roomId);
  };

  (client as any).on("RoomState.events" as any, handler);

  return () => {
    (client as any).off("RoomState.events" as any, handler);
  };
}
