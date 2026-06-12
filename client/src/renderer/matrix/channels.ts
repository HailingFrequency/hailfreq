import type { MatrixClient, Room } from "matrix-js-sdk";
import { ChannelType, type Channel, type TextChannel, type VoiceChannel } from "./channelTypes";

export const CHANNEL_TYPE_EVENT = "org.hailfreq.channel.type";

/**
 * Read the `org.hailfreq.channel.type` state event from a room's currentState.
 * Returns the ChannelType if present and recognised, or null otherwise.
 */
export function getChannelType(room: Room): ChannelType | null {
  const ev = room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "");
  if (!ev) return null;
  const value = ev.getContent().value;
  if (value === ChannelType.TEXT) return ChannelType.TEXT;
  if (value === ChannelType.VOICE) return ChannelType.VOICE;
  return null;
}

/**
 * Return all channels (text and voice) that are children of the given net Space.
 *
 * Queries the Matrix Space hierarchy API, resolves each child room from the
 * local room cache, reads `org.hailfreq.channel.type`, and skips:
 *   - the parent Space itself
 *   - rooms that cannot be resolved locally (not joined)
 *   - rooms with no channel-type marker
 *
 * On any error: logs and returns [].
 */
export async function getChannelsInNet(
  client: MatrixClient,
  netId: string,
): Promise<Channel[]> {
  try {
    const hierarchy = await client.getRoomHierarchy(netId);
    const channels: Channel[] = [];

    for (const hierarchyRoom of hierarchy.rooms) {
      // Skip the parent Space itself
      if (hierarchyRoom.room_id === netId) continue;

      // Resolve the room from the local cache
      const room = client.getRoom(hierarchyRoom.room_id);
      if (!room) continue;

      const channelType = getChannelType(room);
      if (!channelType) continue;

      // Detect encryption from room state
      const encEvent = room.currentState.getStateEvents("m.room.encryption", "");
      const encrypted = !!encEvent;

      // Derive topic from room state (m.room.topic)
      const topicEv = room.currentState.getStateEvents("m.room.topic", "");
      const topic = topicEv ? (topicEv.getContent().topic as string | undefined) : undefined;

      channels.push({
        id: room.roomId,
        name: room.name,
        type: channelType,
        netId,
        topic,
        encrypted,
      });
    }

    return channels;
  } catch (err) {
    console.error(`[channels] getChannelsInNet failed for net ${netId}:`, err);
    return [];
  }
}

/**
 * Derive the via server from a Matrix room ID.
 * `!localpart:server.com` → `["server.com"]`
 */
function viaFromRoomId(roomId: string): string[] {
  const colonIdx = roomId.indexOf(":");
  if (colonIdx <= 0) return [];
  return [roomId.substring(colonIdx + 1)];
}

/** Shared initial state events used for all channel rooms. */
function baseInitialState(
  channelType: ChannelType,
  topic?: string,
): Array<{ type: string; state_key: string; content: Record<string, unknown> }> {
  const events: Array<{ type: string; state_key: string; content: Record<string, unknown> }> = [
    {
      type: "m.room.encryption",
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    },
    {
      type: CHANNEL_TYPE_EVENT,
      state_key: "",
      content: { value: channelType },
    },
  ];

  if (topic !== undefined) {
    events.push({
      type: "m.room.topic",
      state_key: "",
      content: { topic },
    });
  }

  return events;
}

/**
 * Create a new text channel as a child of the given net Space.
 * Returns the TextChannel descriptor.
 */
export async function createTextChannel(
  client: MatrixClient,
  netId: string,
  name: string,
  topic?: string,
): Promise<TextChannel> {
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name,
    initial_state: baseInitialState(ChannelType.TEXT, topic),
  });

  const newRoomId: string = create.room_id;

  // Link as a Space child on the parent net
  await client.sendStateEvent(
    netId,
    "m.space.child" as any,
    { via: viaFromRoomId(netId) },
    newRoomId,
  );

  return {
    id: newRoomId,
    name,
    type: ChannelType.TEXT,
    netId,
    topic,
    encrypted: true,
  };
}

/**
 * Create a new voice channel as a child of the given net Space.
 * Returns the VoiceChannel descriptor with an empty connectedMembers list.
 */
export async function createVoiceChannel(
  client: MatrixClient,
  netId: string,
  name: string,
): Promise<VoiceChannel> {
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name,
    initial_state: baseInitialState(ChannelType.VOICE),
  });

  const newRoomId: string = create.room_id;

  // Link as a Space child on the parent net
  await client.sendStateEvent(
    netId,
    "m.space.child" as any,
    { via: viaFromRoomId(netId) },
    newRoomId,
  );

  return {
    id: newRoomId,
    name,
    type: ChannelType.VOICE,
    netId,
    encrypted: true,
    connectedMembers: [],
  };
}
