/**
 * hierarchyBuilder.ts
 *
 * Adapters that produce HierarchyNode trees from live Matrix data.
 *
 * # Markers found in nets.ts (reused here)
 *   - Ship marker:    org.hailfreq.ship.type     → isShipNet / node type 'ship'
 *   - Priority:       org.hailfreq.net.priority  → content.value (number)
 *   - Net name:       org.hailfreq.net.name      → content.value (string; falls back to room.name)
 *
 * # New marker introduced here (no prior state event existed)
 *   - Broadcast flag: org.hailfreq.net.broadcast → content.value (boolean)
 *     isBroadcast only lived on HierarchyNode; this is the first Matrix state
 *     event definition for it. Future write paths should use this constant.
 *
 * # OPNODE_EVENT
 *   org.hailfreq.opnode — NEW state event type for operation Space children.
 *   Written by the future roster-builder UI; reading it here establishes the contract.
 *   Content: { kind: "strike-group" | "ship" }
 *
 * # Recursion / cycle guard
 *   buildOperationTree recurses into Space children up to MAX_OP_DEPTH = 4 levels.
 *   A visited-ID set prevents infinite loops on self-referencing Spaces.
 */

import type { MatrixClient, Room } from "matrix-js-sdk";
import type { HierarchyNode, HierarchyNodeType } from "./hierarchyTypes";
import { getChannelType } from "./channels";

// ---------------------------------------------------------------------------
// Constants — reused from nets.ts (kept private; re-declared to avoid coupling
// to unexported symbols in nets.ts)
// ---------------------------------------------------------------------------

const NET_PRIORITY_EVENT = "org.hailfreq.net.priority";
const NET_NAME_EVENT = "org.hailfreq.net.name";
const SHIP_TYPE_EVENT = "org.hailfreq.ship.type";

/**
 * Broadcast-net flag.
 * No equivalent state event existed in nets.ts — this is the first definition.
 * Content: { value: true }
 */
const NET_BROADCAST_EVENT = "org.hailfreq.net.broadcast";

/**
 * Operation-space child-node marker.
 * NEW — exported so roster-builder UI can write it.
 * Content: { kind: "strike-group" | "ship" }
 */
export const OPNODE_EVENT = "org.hailfreq.opnode";

/**
 * Maximum recursion depth when walking an operation's Space hierarchy.
 * Depth 1 = direct children of the op Space.
 * Capped at 4 to guard against pathological hierarchies and cycles.
 */
const MAX_OP_DEPTH = 4;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read priority from a net room's state events (0 if absent). */
function readPriority(room: Room): number {
  const ev = room.currentState.getStateEvents(NET_PRIORITY_EVENT, "");
  return ev ? Number(ev.getContent().value ?? 0) : 0;
}

/** Read display name from org.hailfreq.net.name; falls back to room.name. */
function readNetName(room: Room): string {
  const ev = room.currentState.getStateEvents(NET_NAME_EVENT, "");
  return ev ? String(ev.getContent().value ?? room.name) : room.name;
}

/** Returns true when the room carries the ship-type state event. */
function isShipRoom(room: Room): boolean {
  return !!room.currentState.getStateEvents(SHIP_TYPE_EVENT, "");
}

/** Returns true when the room has the broadcast net flag set to truthy. */
function isBroadcastNet(room: Room): boolean {
  const ev = room.currentState.getStateEvents(NET_BROADCAST_EVENT, "");
  return ev ? Boolean(ev.getContent().value) : false;
}

/** Returns true when the room has the net-priority state event (i.e. is a net). */
function isNetRoom(room: Room): boolean {
  return !!room.currentState.getStateEvents(NET_PRIORITY_EVENT, "");
}

/**
 * Resolve a room ID to a local Room object.
 * Returns null when the room is not in the client cache.
 */
function resolveRoom(client: MatrixClient, roomId: string): Room | null {
  return client.getRoom(roomId) as Room | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a HierarchyNode for one net room.
 *
 * Node type resolution:
 *   - 'ship'  — room carries `org.hailfreq.ship.type`
 *   - 'net'   — otherwise
 *
 * Children are the channels returned by walking the room hierarchy (via
 * `getRoomHierarchy`). Each child is mapped to a leaf HierarchyNode of type
 * 'text' or 'voice' (rooms without a channel-type marker are skipped).
 */
export async function buildNetNode(
  client: MatrixClient,
  netRoom: Room,
): Promise<HierarchyNode> {
  const netId = netRoom.roomId;
  const type: HierarchyNodeType = isShipRoom(netRoom) ? "ship" : "net";
  const name = readNetName(netRoom);
  const priority = readPriority(netRoom);
  const broadcast = isBroadcastNet(netRoom);

  // Fetch channel children (rooms below this net Space)
  let children: HierarchyNode[] = [];
  try {
    const hierarchy = await client.getRoomHierarchy(netId);
    for (const hr of hierarchy.rooms) {
      if (hr.room_id === netId) continue; // skip the parent itself

      const room = resolveRoom(client, hr.room_id);
      if (!room) continue;

      const channelType = getChannelType(room);
      if (!channelType) continue;

      children = [
        ...children,
        {
          id: room.roomId,
          name: room.name,
          type: channelType as HierarchyNodeType,
          children: [],
        },
      ];
    }
  } catch (err) {
    console.error(`[hierarchyBuilder] Failed to get channels for net ${netId}:`, err);
  }

  const node: HierarchyNode = {
    id: netId,
    name,
    type,
    children,
    priority,
  };

  if (broadcast) {
    return { ...node, isBroadcast: true };
  }

  return node;
}

/**
 * Build a lounge tree from a list of net rooms.
 * Each room is mapped to a HierarchyNode via buildNetNode; all mappings run in
 * parallel via Promise.all.
 */
export async function buildLoungeTree(
  client: MatrixClient,
  netRooms: Room[],
): Promise<HierarchyNode[]> {
  return Promise.all(netRooms.map((room) => buildNetNode(client, room)));
}

/**
 * Build an operation tree by walking the Space hierarchy of the given
 * operation room ID.
 *
 * Classification rules for children:
 *   - Child Spaces with `org.hailfreq.opnode` content.kind = "strike-group"
 *     → type 'strike-group'; recurse into their children (up to MAX_OP_DEPTH=4)
 *   - Child Spaces with `org.hailfreq.opnode` content.kind = "ship"
 *     → type 'ship'; recurse into their children for channel leaves
 *   - Child rooms with `org.hailfreq.channel.type`
 *     → 'text' or 'voice' leaf node (no recursion)
 *   - Child rooms with `org.hailfreq.net.priority` (net rooms)
 *     → type 'net' with isBroadcast/priority (no recursion into children here)
 *   - Unmarked children are skipped
 *
 * Cycle / depth guard:
 *   - A per-call `visited` set of room IDs prevents re-entering any room.
 *   - Recursion stops at depth = MAX_OP_DEPTH (4).
 */
export async function buildOperationTree(
  client: MatrixClient,
  operationId: string,
): Promise<HierarchyNode[]> {
  const visited = new Set<string>();
  visited.add(operationId);

  return walkSpaceChildren(client, operationId, 1, visited);
}

/**
 * Recursively walk the children of `spaceId`, returning HierarchyNodes for
 * recognised children.
 *
 * @param depth - current recursion depth (1 = direct children of op root)
 * @param visited - set of already-visited room IDs (mutated in-place, but the
 *   set reference itself is shared, so cycles across branches are also caught)
 */
async function walkSpaceChildren(
  client: MatrixClient,
  spaceId: string,
  depth: number,
  visited: Set<string>,
): Promise<HierarchyNode[]> {
  let hierarchyRooms: Array<{ room_id: string }> = [];
  try {
    const result = await client.getRoomHierarchy(spaceId);
    hierarchyRooms = result.rooms ?? [];
  } catch (err) {
    console.error(`[hierarchyBuilder] getRoomHierarchy failed for ${spaceId}:`, err);
    return [];
  }

  const nodes: HierarchyNode[] = [];

  for (const hr of hierarchyRooms) {
    const childId = hr.room_id;

    // Skip the space itself
    if (childId === spaceId) continue;

    // Cycle guard
    if (visited.has(childId)) continue;

    const room = resolveRoom(client, childId);
    if (!room) continue;

    // --- Try opnode classification first ---
    const opnodeEv = room.currentState.getStateEvents(OPNODE_EVENT, "");
    if (opnodeEv) {
      const kind = opnodeEv.getContent().kind as string | undefined;
      if (kind === "strike-group" || kind === "ship") {
        const nodeType: HierarchyNodeType = kind === "strike-group" ? "strike-group" : "ship";

        // Mark as visited before recursing to catch self-references
        visited.add(childId);

        let children: HierarchyNode[] = [];
        if (depth < MAX_OP_DEPTH) {
          children = await walkSpaceChildren(client, childId, depth + 1, visited);
        }

        nodes.push({
          id: childId,
          name: room.name,
          type: nodeType,
          children,
        });
        continue;
      }
    }

    // --- Try channel classification ---
    const channelType = getChannelType(room);
    if (channelType) {
      visited.add(childId);
      nodes.push({
        id: childId,
        name: room.name,
        type: channelType as HierarchyNodeType,
        children: [],
      });
      continue;
    }

    // --- Try net classification ---
    if (isNetRoom(room)) {
      visited.add(childId);
      const priority = readPriority(room);
      const name = readNetName(room);
      const broadcast = isBroadcastNet(room);

      const netNode: HierarchyNode = {
        id: childId,
        name,
        type: "net",
        children: [],
        priority,
      };

      nodes.push(broadcast ? { ...netNode, isBroadcast: true } : netNode);
      continue;
    }

    // Unmarked child — skip
  }

  return nodes;
}
