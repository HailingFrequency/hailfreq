import type { MatrixClient } from "matrix-js-sdk";
import { ChannelType, type Channel } from "../matrix/channelTypes";
import { getChannelType } from "../matrix/channels";
import type { HierarchyNode } from "../matrix/hierarchyTypes";

/**
 * Find the parent net/ship node that contains the channel `channelId` anywhere
 * in its subtree. Returns the containing node, or null when not found.
 *
 * Used to derive the netId + display name for a selected channel so the main
 * panel header and the channels-in-net toggle have the right context.
 *
 * Resolution prefers the nearest net/ship ancestor. If a channel sits directly
 * under a strike-group (no intervening net/ship) the strike-group node is
 * returned as the container; getChannelsInNet works on any Space id, so the
 * text/voice toggle still resolves siblings correctly in that case.
 */
export function findChannelParent(
  nodes: HierarchyNode[],
  channelId: string,
): HierarchyNode | null {
  for (const node of nodes) {
    // A net/ship node directly owning the channel as a child
    const directChild = node.children.some((c) => c.id === channelId);
    if (directChild && (node.type === "net" || node.type === "ship")) {
      return node;
    }
    // Recurse for hierarchical (operations) trees
    const deeper = findChannelParent(node.children, channelId);
    if (deeper) {
      // Prefer the nearest net/ship ancestor; if the recursive hit is itself a
      // net/ship keep it, otherwise fall back to the current container node.
      if (deeper.type === "net" || deeper.type === "ship") return deeper;
      if (node.type === "net" || node.type === "ship") return node;
      return deeper;
    }
  }
  return null;
}

/**
 * Resolve a selected channel room ID into a Channel descriptor plus the display
 * name of its parent net, using the live Matrix room state and the currently
 * loaded hierarchy nodes (lounge or operations).
 *
 * Returns null when the room cannot be resolved or is not a channel.
 */
export function resolveSelectedChannel(
  client: MatrixClient,
  channelId: string,
  nodes: HierarchyNode[],
): { channel: Channel; netName: string } | null {
  const room = client.getRoom(channelId);
  if (!room) return null;

  const channelType = getChannelType(room);
  if (!channelType) return null;

  const parent = findChannelParent(nodes, channelId);
  const netId = parent?.id ?? channelId;
  const netName = parent?.name ?? room.name;

  const topicEv = room.currentState.getStateEvents("m.room.topic", "");
  const topic = topicEv
    ? (topicEv.getContent().topic as string | undefined)
    : undefined;
  const encEv = room.currentState.getStateEvents("m.room.encryption", "");

  const channel: Channel = {
    id: room.roomId,
    name: room.name,
    type: channelType === ChannelType.TEXT ? ChannelType.TEXT : ChannelType.VOICE,
    netId,
    topic,
    encrypted: !!encEv,
  };

  return { channel, netName };
}
