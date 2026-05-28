import type { MatrixClient } from "matrix-js-sdk";
import type { NetSummary } from "./nets";

export interface RosterMember {
  userId: string;
  displayName: string;
  /** Map: matrixRoomId → that member's power level in that net. */
  perNetPowerLevel: Map<string, number>;
  /** Set of matrixRoomIds the member is joined to. */
  joinedNets: Set<string>;
  /** Presence: "online" | "offline" | "unavailable" (per Matrix presence). */
  presence: string;
  /** Cached RSI-verified flag (populated when CitizenID claim is available — see Task 9). */
  rsiVerified: boolean;
  /** Cached RSI handle (for the verified badge). */
  rsiHandle: string | null;
}

export function buildRoster(client: MatrixClient, nets: NetSummary[]): RosterMember[] {
  const byUser = new Map<string, RosterMember>();
  for (const net of nets) {
    const room = client.getRoom(net.matrixRoomId);
    if (!room) continue;
    for (const member of room.getJoinedMembers()) {
      let entry = byUser.get(member.userId);
      if (!entry) {
        entry = {
          userId: member.userId,
          displayName: member.name || member.userId,
          perNetPowerLevel: new Map(),
          joinedNets: new Set(),
          presence: client.getUser(member.userId)?.presence ?? "offline",
          rsiVerified: false,
          rsiHandle: null,
        };
        byUser.set(member.userId, entry);
      }
      entry.perNetPowerLevel.set(net.matrixRoomId, member.powerLevel);
      entry.joinedNets.add(net.matrixRoomId);
    }
  }
  const out = Array.from(byUser.values());
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Subscribe to roster changes (membership, presence, power levels) — debounced refresh. */
export function subscribeToRosterChanges(client: MatrixClient, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 100);
  };
  client.on("RoomMember.membership" as any, debounced);
  client.on("RoomMember.powerLevel" as any, debounced);
  client.on("User.presence" as any, debounced);
  return () => {
    if (timer) clearTimeout(timer);
    client.off("RoomMember.membership" as any, debounced);
    client.off("RoomMember.powerLevel" as any, debounced);
    client.off("User.presence" as any, debounced);
  };
}
