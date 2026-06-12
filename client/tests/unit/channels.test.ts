import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getChannelsInNet,
  createTextChannel,
  createVoiceChannel,
  getChannelType,
  CHANNEL_TYPE_EVENT,
} from "@/renderer/matrix/channels";
import { ChannelType } from "@/renderer/matrix/channelTypes";

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

function makeStateEvent(type: string, content: Record<string, unknown>) {
  return {
    getContent: () => content,
    getType: () => type,
  };
}

function makeRoom(
  roomId: string,
  name: string,
  opts: {
    channelType?: "text" | "voice";
    topic?: string;
    encrypted?: boolean;
  } = {},
) {
  const stateMap: Map<string, ReturnType<typeof makeStateEvent>> = new Map();

  if (opts.channelType !== undefined) {
    stateMap.set(CHANNEL_TYPE_EVENT, makeStateEvent(CHANNEL_TYPE_EVENT, { value: opts.channelType }));
  }
  if (opts.topic !== undefined) {
    stateMap.set("m.room.topic", makeStateEvent("m.room.topic", { topic: opts.topic }));
  }
  if (opts.encrypted) {
    stateMap.set("m.room.encryption", makeStateEvent("m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2" }));
  }

  return {
    roomId,
    name,
    currentState: {
      getStateEvents: (evType: string, stateKey: string) => {
        if (stateKey !== "") return null;
        return stateMap.get(evType) ?? null;
      },
    },
  };
}

function makeHierarchyRoom(
  roomId: string,
  name: string,
  opts: { channelType?: "text" | "voice"; topic?: string; encrypted?: boolean } = {},
) {
  // Represents an IHierarchyRoom as returned by getRoomHierarchy
  return {
    room_id: roomId,
    name,
    topic: opts.topic,
    // children_state is not used by our implementation, include for completeness
    children_state: [],
  };
}

function makeClient(
  rooms: ReturnType<typeof makeRoom>[],
  hierarchyRooms: ReturnType<typeof makeHierarchyRoom>[] = [],
) {
  return {
    getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
    getRoomHierarchy: vi.fn().mockResolvedValue({ rooms: hierarchyRooms }),
    createRoom: vi.fn().mockResolvedValue({ room_id: "!new-room:server.com" }),
    sendStateEvent: vi.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CHANNEL_TYPE_EVENT", () => {
  it("is the correct org.hailfreq event type string", () => {
    expect(CHANNEL_TYPE_EVENT).toBe("org.hailfreq.channel.type");
  });
});

describe("getChannelType", () => {
  it("returns ChannelType.TEXT for a room with channel type text", () => {
    const room = makeRoom("!text:server.com", "general", { channelType: "text" });
    const result = getChannelType(room as any);
    expect(result).toBe(ChannelType.TEXT);
  });

  it("returns ChannelType.VOICE for a room with channel type voice", () => {
    const room = makeRoom("!voice:server.com", "ops", { channelType: "voice" });
    const result = getChannelType(room as any);
    expect(result).toBe(ChannelType.VOICE);
  });

  it("returns null for a room without the channel type state event", () => {
    const room = makeRoom("!plain:server.com", "just a room");
    const result = getChannelType(room as any);
    expect(result).toBeNull();
  });

  it("returns null for a room with channel type state event but unknown value", () => {
    const room = makeRoom("!weird:server.com", "weird room");
    // Manually override to return an unknown type value
    (room.currentState.getStateEvents as any) = (_type: string, _key: string) => {
      if (_type === CHANNEL_TYPE_EVENT && _key === "") {
        return makeStateEvent(CHANNEL_TYPE_EVENT, { value: "unknown" });
      }
      return null;
    };
    const result = getChannelType(room as any);
    expect(result).toBeNull();
  });
});

describe("getChannelsInNet", () => {
  it("returns text and voice channels, skipping the parent Space itself", async () => {
    const netId = "!net:server.com";
    const textRoomId = "!text:server.com";
    const voiceRoomId = "!voice:server.com";

    const textRoom = makeRoom(textRoomId, "general", { channelType: "text", encrypted: true });
    const voiceRoom = makeRoom(voiceRoomId, "ops-voice", { channelType: "voice", encrypted: true });
    const netSpaceRoom = makeRoom(netId, "Net Space");

    const hierarchyRooms = [
      makeHierarchyRoom(netId, "Net Space"),           // the parent — should be skipped
      makeHierarchyRoom(textRoomId, "general"),
      makeHierarchyRoom(voiceRoomId, "ops-voice"),
    ];

    const client = makeClient([netSpaceRoom, textRoom, voiceRoom], hierarchyRooms);

    const channels = await getChannelsInNet(client as any, netId);

    expect(channels).toHaveLength(2);
    const ids = channels.map((c) => c.id);
    expect(ids).toContain(textRoomId);
    expect(ids).toContain(voiceRoomId);
  });

  it("skips rooms without the channel type marker", async () => {
    const netId = "!net:server.com";
    const markedId = "!marked:server.com";
    const unmarkedId = "!unmarked:server.com";

    const markedRoom = makeRoom(markedId, "marked", { channelType: "text", encrypted: true });
    const unmarkedRoom = makeRoom(unmarkedId, "unmarked"); // no channel type
    const netSpaceRoom = makeRoom(netId, "Net Space");

    const hierarchyRooms = [
      makeHierarchyRoom(netId, "Net Space"),
      makeHierarchyRoom(markedId, "marked"),
      makeHierarchyRoom(unmarkedId, "unmarked"),
    ];

    const client = makeClient([netSpaceRoom, markedRoom, unmarkedRoom], hierarchyRooms);

    const channels = await getChannelsInNet(client as any, netId);

    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe(markedId);
    expect(channels[0].type).toBe(ChannelType.TEXT);
  });

  it("maps channel fields correctly (id, name, type, netId, topic, encrypted)", async () => {
    const netId = "!net:server.com";
    const textRoomId = "!text:server.com";

    const textRoom = makeRoom(textRoomId, "general", {
      channelType: "text",
      topic: "Daily ops",
      encrypted: true,
    });

    const hierarchyRooms = [
      makeHierarchyRoom(netId, "Net Space"),
      makeHierarchyRoom(textRoomId, "general", { topic: "Daily ops" }),
    ];

    const client = makeClient([makeRoom(netId, "Net Space"), textRoom], hierarchyRooms);

    const channels = await getChannelsInNet(client as any, netId);

    expect(channels).toHaveLength(1);
    const ch = channels[0];
    expect(ch.id).toBe(textRoomId);
    expect(ch.name).toBe("general");
    expect(ch.type).toBe(ChannelType.TEXT);
    expect(ch.netId).toBe(netId);
    expect(ch.encrypted).toBe(true);
  });

  it("returns [] on error (does not throw)", async () => {
    const netId = "!net:server.com";
    const client = {
      getRoom: vi.fn().mockReturnValue(null),
      getRoomHierarchy: vi.fn().mockRejectedValue(new Error("Network failure")),
    };

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const channels = await getChannelsInNet(client as any, netId);

    expect(channels).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("skips child rooms that cannot be resolved via getRoom", async () => {
    const netId = "!net:server.com";
    const knownId = "!known:server.com";
    const missingId = "!missing:server.com";

    const knownRoom = makeRoom(knownId, "known-chan", { channelType: "text", encrypted: false });

    const hierarchyRooms = [
      makeHierarchyRoom(netId, "Net Space"),
      makeHierarchyRoom(knownId, "known-chan"),
      makeHierarchyRoom(missingId, "missing-chan"),
    ];

    const client = makeClient([makeRoom(netId, "Net Space"), knownRoom], hierarchyRooms);

    const channels = await getChannelsInNet(client as any, netId);

    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe(knownId);
  });
});

describe("createTextChannel", () => {
  it("creates a room with encryption and org.hailfreq.channel.type = text", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    const channel = await createTextChannel(client as any, netId, "general");

    expect(client.createRoom).toHaveBeenCalledOnce();
    const callArgs = client.createRoom.mock.calls[0][0];
    const initialState: any[] = callArgs.initial_state;

    const encEvent = initialState.find((e: any) => e.type === "m.room.encryption");
    expect(encEvent).toBeDefined();
    expect(encEvent.content.algorithm).toBe("m.megolm.v1.aes-sha2");

    const chanTypeEvent = initialState.find((e: any) => e.type === CHANNEL_TYPE_EVENT);
    expect(chanTypeEvent).toBeDefined();
    expect(chanTypeEvent.content.value).toBe("text");
  });

  it("links the new channel as m.space.child on the parent net", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    await createTextChannel(client as any, netId, "general");

    expect(client.sendStateEvent).toHaveBeenCalledWith(
      netId,
      "m.space.child",
      expect.objectContaining({ via: expect.any(Array) }),
      "!new-room:server.com",
    );
  });

  it("includes optional topic in initial state when provided", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    await createTextChannel(client as any, netId, "general", "Daily briefings");

    const callArgs = client.createRoom.mock.calls[0][0];
    const initialState: any[] = callArgs.initial_state;
    const topicEvent = initialState.find((e: any) => e.type === "m.room.topic");
    expect(topicEvent).toBeDefined();
    expect(topicEvent.content.topic).toBe("Daily briefings");
  });

  it("returns a TextChannel object with correct fields", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    const channel = await createTextChannel(client as any, netId, "general");

    expect(channel.id).toBe("!new-room:server.com");
    expect(channel.name).toBe("general");
    expect(channel.type).toBe(ChannelType.TEXT);
    expect(channel.netId).toBe(netId);
    expect(channel.encrypted).toBe(true);
  });
});

describe("createVoiceChannel", () => {
  it("creates a room with org.hailfreq.channel.type = voice", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    await createVoiceChannel(client as any, netId, "ops-voice");

    const callArgs = client.createRoom.mock.calls[0][0];
    const initialState: any[] = callArgs.initial_state;

    const chanTypeEvent = initialState.find((e: any) => e.type === CHANNEL_TYPE_EVENT);
    expect(chanTypeEvent).toBeDefined();
    expect(chanTypeEvent.content.value).toBe("voice");
  });

  it("returns a VoiceChannel with empty connectedMembers", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    const channel = await createVoiceChannel(client as any, netId, "ops-voice");

    expect(channel.type).toBe(ChannelType.VOICE);
    expect(channel.connectedMembers).toEqual([]);
    expect(channel.netId).toBe(netId);
    expect(channel.encrypted).toBe(true);
  });

  it("links the new voice channel as m.space.child on the parent net", async () => {
    const netId = "!net:server.com";
    const client = makeClient([]);

    await createVoiceChannel(client as any, netId, "ops-voice");

    expect(client.sendStateEvent).toHaveBeenCalledWith(
      netId,
      "m.space.child",
      expect.objectContaining({ via: expect.any(Array) }),
      "!new-room:server.com",
    );
  });
});
