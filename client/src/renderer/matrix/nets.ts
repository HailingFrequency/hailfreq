import type { MatrixClient } from "matrix-js-sdk";

export interface NetProperties {
  priority: number; // 0-100
  name: string;
  color: string; // CSS color or short identifier
}

export interface NetSummary {
  matrixRoomId: string;
  liveKitRoomName: string; // derived: the UUID localpart
  properties: NetProperties;
  memberCount: number;
  myPowerLevel: number;
  /** True when the room carries ship-net metadata (org.hailfreq.ship.type). */
  isShipNet: boolean;
}

const NET_PRIORITY_EVENT = "org.hailfreq.net.priority";
const NET_NAME_EVENT = "org.hailfreq.net.name";
const NET_COLOR_EVENT = "org.hailfreq.net.color";

// Ship-net state event types (also used in ship-net section below)
const SHIP_TYPE_EVENT = "org.hailfreq.ship.type";
const SHIP_OWNER_RSI_EVENT = "org.hailfreq.ship.owner-rsi";
const SHIP_OWNER_MATRIX_EVENT = "org.hailfreq.ship.owner-matrix-id";

/**
 * Derive the LiveKit room name from a Matrix room ID.
 * `!a1b2c3:server.com` → `a1b2c3`.
 */
export function liveKitRoomFromMatrixId(matrixRoomId: string): string {
  const colonIdx = matrixRoomId.indexOf(":");
  if (colonIdx <= 0) return matrixRoomId.substring(1);
  return matrixRoomId.substring(1, colonIdx);
}

/**
 * List all "voice net" rooms the client is a member of.
 * A room is considered a voice net if it has the `org.hailfreq.net.priority` state event.
 */
export function listNets(client: MatrixClient): NetSummary[] {
  const rooms = client.getRooms();
  const nets: NetSummary[] = [];
  for (const room of rooms) {
    const priorityEv = room.currentState.getStateEvents(NET_PRIORITY_EVENT, "");
    if (!priorityEv) continue;
    const nameEv = room.currentState.getStateEvents(NET_NAME_EVENT, "");
    const colorEv = room.currentState.getStateEvents(NET_COLOR_EVENT, "");
    const props: NetProperties = {
      priority: Number(priorityEv.getContent().value ?? 0),
      name: String(nameEv?.getContent().value ?? room.name ?? "Net"),
      color: String(colorEv?.getContent().value ?? "#22d3ee"),
    };
    nets.push({
      matrixRoomId: room.roomId,
      liveKitRoomName: liveKitRoomFromMatrixId(room.roomId),
      properties: props,
      memberCount: room.getJoinedMemberCount(),
      myPowerLevel: room.getMember(client.getSafeUserId())?.powerLevel ?? 0,
      isShipNet: !!room.currentState.getStateEvents(SHIP_TYPE_EVENT, ""),
    });
  }
  // Sort by priority descending (highest priority first)
  nets.sort((a, b) => b.properties.priority - a.properties.priority);
  return nets;
}

/**
 * Create a new voice net (Matrix room with the required state events).
 * Caller must have permission on the parent space/server to create rooms.
 * Returns the new room ID.
 */
export async function createNet(
  client: MatrixClient,
  props: NetProperties,
): Promise<string> {
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name: props.name,
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
      {
        type: NET_PRIORITY_EVENT,
        state_key: "",
        content: { value: props.priority },
      },
      {
        type: NET_NAME_EVENT,
        state_key: "",
        content: { value: props.name },
      },
      {
        type: NET_COLOR_EVENT,
        state_key: "",
        content: { value: props.color },
      },
    ],
  });
  return create.room_id;
}

/** Update one or more net properties. Caller must have PL 100 in the room. */
export async function updateNetProperties(
  client: MatrixClient,
  matrixRoomId: string,
  patch: Partial<NetProperties>,
): Promise<void> {
  if (patch.priority !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_PRIORITY_EVENT as any, { value: patch.priority }, "");
  }
  if (patch.name !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_NAME_EVENT as any, { value: patch.name }, "");
  }
  if (patch.color !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_COLOR_EVENT as any, { value: patch.color }, "");
  }
}

/** Rename a net's display name (updates BOTH m.room.name and org.hailfreq.net.name). */
export async function renameNet(
  client: MatrixClient,
  matrixRoomId: string,
  newName: string,
): Promise<void> {
  await client.sendStateEvent(matrixRoomId, "m.room.name" as any, { name: newName }, "");
  await client.sendStateEvent(matrixRoomId, NET_NAME_EVENT as any, { value: newName }, "");
}

/**
 * Delete a net. Matrix has no native delete — the convention is for the admin to
 * leave the room and forget it. Other members can still see it until they leave.
 * For a full "tombstone" approach we send an m.room.tombstone event.
 */
export async function deleteNet(client: MatrixClient, matrixRoomId: string): Promise<void> {
  // Send a tombstone event so other clients can hide the room
  await client.sendStateEvent(
    matrixRoomId,
    "m.room.tombstone" as any,
    { body: "Net deleted by admin", replacement_room: "" },
    "",
  );
  // The admin leaves; remaining members will see the tombstone and can leave too
  await client.leave(matrixRoomId);
}

// ---------------------------------------------------------------------------
// Ship-net extensions
// ---------------------------------------------------------------------------

export interface ShipNetMetadata {
  shipType: string;
  ownerRsi: string;
  ownerMatrixId: string;
}

/**
 * Create a ship-net — a voice net tied to a specific ship and its owner.
 * The room name follows the convention: `🚢 {shipType} — {ownerRsi}`.
 * Returns the new room ID.
 */
export async function createShipNet(
  client: MatrixClient,
  ship: ShipNetMetadata,
): Promise<string> {
  const props: NetProperties = {
    priority: 60,
    name: `🚢 ${ship.shipType} — ${ship.ownerRsi}`,
    color: "#22d3ee",
  };
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name: props.name,
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
      {
        type: NET_PRIORITY_EVENT,
        state_key: "",
        content: { value: props.priority },
      },
      {
        type: NET_NAME_EVENT,
        state_key: "",
        content: { value: props.name },
      },
      {
        type: NET_COLOR_EVENT,
        state_key: "",
        content: { value: props.color },
      },
      {
        type: SHIP_TYPE_EVENT,
        state_key: "",
        content: { value: ship.shipType },
      },
      {
        type: SHIP_OWNER_RSI_EVENT,
        state_key: "",
        content: { value: ship.ownerRsi },
      },
      {
        type: SHIP_OWNER_MATRIX_EVENT,
        state_key: "",
        content: { value: ship.ownerMatrixId },
      },
    ],
  });
  return create.room_id;
}

/** Returns true if the given room has the ship-type state event (i.e. is a ship-net). */
export function isShipNet(client: MatrixClient, matrixRoomId: string): boolean {
  const room = client.getRoom(matrixRoomId);
  if (!room) return false;
  return !!room.currentState.getStateEvents(SHIP_TYPE_EVENT, "");
}

/**
 * Find the room ID of a ship-net matching the given ship type and RSI owner handle.
 * Returns null if no matching room is found.
 */
export function findShipNetByShip(
  client: MatrixClient,
  shipType: string,
  ownerRsi: string,
): string | null {
  for (const room of client.getRooms()) {
    const typeEv = room.currentState.getStateEvents(SHIP_TYPE_EVENT, "");
    const ownerEv = room.currentState.getStateEvents(SHIP_OWNER_RSI_EVENT, "");
    if (!typeEv || !ownerEv) continue;
    if (
      typeEv.getContent().value === shipType &&
      ownerEv.getContent().value === ownerRsi
    ) {
      return room.roomId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

/** Subscribe to net membership/property changes; returns unsubscribe function. */
export function subscribeToNetsChanges(
  client: MatrixClient,
  onChange: () => void,
): () => void {
  const handler = () => onChange();
  client.on("Room" as any, handler);
  client.on("Room.name" as any, handler);
  client.on("RoomState.events" as any, handler);
  client.on("RoomMember.membership" as any, handler);
  return () => {
    client.off("Room" as any, handler);
    client.off("Room.name" as any, handler);
    client.off("RoomState.events" as any, handler);
    client.off("RoomMember.membership" as any, handler);
  };
}
