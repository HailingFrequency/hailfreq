import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildNetNode,
  buildLoungeTree,
  buildOperationTree,
  OPNODE_EVENT,
} from "@/renderer/matrix/hierarchyBuilder";
import {
  CHANNEL_TYPE_EVENT,
} from "@/renderer/matrix/channels";

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

const NET_PRIORITY_EVENT = "org.hailfreq.net.priority";
const NET_NAME_EVENT = "org.hailfreq.net.name";
const NET_BROADCAST_EVENT = "org.hailfreq.net.broadcast";
const SHIP_TYPE_EVENT = "org.hailfreq.ship.type";

function makeStateEvent(type: string, content: Record<string, unknown>) {
  return {
    getContent: () => content,
    getType: () => type,
  };
}

type StateMap = Map<string, ReturnType<typeof makeStateEvent>>;

function makeRoom(
  roomId: string,
  name: string,
  opts: {
    priority?: number;
    netName?: string;
    broadcast?: boolean;
    isShip?: boolean;
    channelType?: "text" | "voice";
    stateEvents?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const stateMap: StateMap = new Map();

  if (opts.priority !== undefined) {
    stateMap.set(NET_PRIORITY_EVENT, makeStateEvent(NET_PRIORITY_EVENT, { value: opts.priority }));
  }
  if (opts.netName !== undefined) {
    stateMap.set(NET_NAME_EVENT, makeStateEvent(NET_NAME_EVENT, { value: opts.netName }));
  }
  if (opts.broadcast === true) {
    stateMap.set(NET_BROADCAST_EVENT, makeStateEvent(NET_BROADCAST_EVENT, { value: true }));
  }
  if (opts.isShip) {
    stateMap.set(SHIP_TYPE_EVENT, makeStateEvent(SHIP_TYPE_EVENT, { value: "Constellation" }));
  }
  if (opts.channelType !== undefined) {
    stateMap.set(CHANNEL_TYPE_EVENT, makeStateEvent(CHANNEL_TYPE_EVENT, { value: opts.channelType }));
  }
  if (opts.stateEvents) {
    for (const [evType, content] of Object.entries(opts.stateEvents)) {
      stateMap.set(evType, makeStateEvent(evType, content));
    }
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

type MockRoom = ReturnType<typeof makeRoom>;

function makeHierarchyRoom(roomId: string) {
  return { room_id: roomId };
}

function makeClient(
  rooms: MockRoom[],
  hierarchyByRoomId: Record<string, { room_id: string }[]> = {},
) {
  return {
    getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
    getRoomHierarchy: vi.fn().mockImplementation((roomId: string) => {
      const hier = hierarchyByRoomId[roomId] ?? [];
      return Promise.resolve({ rooms: hier });
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests — OPNODE_EVENT constant
// ---------------------------------------------------------------------------

describe("OPNODE_EVENT", () => {
  it("is the correct org.hailfreq event type string", () => {
    expect(OPNODE_EVENT).toBe("org.hailfreq.opnode");
  });
});

// ---------------------------------------------------------------------------
// Tests — buildNetNode
// ---------------------------------------------------------------------------

describe("buildNetNode", () => {
  it("returns type 'net' for a room without ship marker", async () => {
    const netRoom = makeRoom("!net1:s.com", "Alpha Net", { priority: 50, netName: "Alpha Net" });
    const client = makeClient([netRoom], { "!net1:s.com": [makeHierarchyRoom("!net1:s.com")] });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.type).toBe("net");
  });

  it("returns type 'ship' for a room carrying the org.hailfreq.ship.type state event", async () => {
    const shipRoom = makeRoom("!ship1:s.com", "Constellation Ship", {
      priority: 60,
      netName: "Constellation Ship",
      isShip: true,
    });
    const client = makeClient([shipRoom], { "!ship1:s.com": [makeHierarchyRoom("!ship1:s.com")] });

    const node = await buildNetNode(client as any, shipRoom as any);

    expect(node.type).toBe("ship");
  });

  it("maps id, name, priority from the net state events", async () => {
    const netRoom = makeRoom("!net2:s.com", "Room Display Name", {
      priority: 75,
      netName: "Tactical Net",
    });
    const client = makeClient([netRoom], { "!net2:s.com": [makeHierarchyRoom("!net2:s.com")] });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.id).toBe("!net2:s.com");
    expect(node.name).toBe("Tactical Net");
    expect(node.priority).toBe(75);
  });

  it("falls back to room.name when org.hailfreq.net.name is absent", async () => {
    const netRoom = makeRoom("!net3:s.com", "Fallback Name", { priority: 10 });
    const client = makeClient([netRoom], { "!net3:s.com": [makeHierarchyRoom("!net3:s.com")] });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.name).toBe("Fallback Name");
  });

  it("sets isBroadcast=true when org.hailfreq.net.broadcast is set", async () => {
    const netRoom = makeRoom("!bcast:s.com", "1MC", {
      priority: 100,
      netName: "1MC",
      broadcast: true,
    });
    const client = makeClient([netRoom], { "!bcast:s.com": [makeHierarchyRoom("!bcast:s.com")] });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.isBroadcast).toBe(true);
  });

  it("leaves isBroadcast undefined when broadcast event is absent", async () => {
    const netRoom = makeRoom("!net4:s.com", "Normal Net", { priority: 30 });
    const client = makeClient([netRoom], { "!net4:s.com": [makeHierarchyRoom("!net4:s.com")] });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.isBroadcast).toBeUndefined();
  });

  it("maps text channel children as HierarchyNode type 'text'", async () => {
    const netId = "!net5:s.com";
    const textId = "!text:s.com";
    const netRoom = makeRoom(netId, "Net", { priority: 20 });
    const textRoom = makeRoom(textId, "general", { channelType: "text" });

    const client = makeClient([netRoom, textRoom], {
      [netId]: [makeHierarchyRoom(netId), makeHierarchyRoom(textId)],
    });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].type).toBe("text");
    expect(node.children[0].id).toBe(textId);
    expect(node.children[0].children).toEqual([]);
  });

  it("maps voice channel children as HierarchyNode type 'voice'", async () => {
    const netId = "!net6:s.com";
    const voiceId = "!voice:s.com";
    const netRoom = makeRoom(netId, "Net", { priority: 20 });
    const voiceRoom = makeRoom(voiceId, "ops-voice", { channelType: "voice" });

    const client = makeClient([netRoom, voiceRoom], {
      [netId]: [makeHierarchyRoom(netId), makeHierarchyRoom(voiceId)],
    });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].type).toBe("voice");
    expect(node.children[0].id).toBe(voiceId);
  });

  it("returns a net with both text and voice children when both exist", async () => {
    const netId = "!net7:s.com";
    const textId = "!text7:s.com";
    const voiceId = "!voice7:s.com";
    const netRoom = makeRoom(netId, "Net", { priority: 40 });
    const textRoom = makeRoom(textId, "chat", { channelType: "text" });
    const voiceRoom = makeRoom(voiceId, "comms", { channelType: "voice" });

    const client = makeClient([netRoom, textRoom, voiceRoom], {
      [netId]: [
        makeHierarchyRoom(netId),
        makeHierarchyRoom(textId),
        makeHierarchyRoom(voiceId),
      ],
    });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.children).toHaveLength(2);
    const types = node.children.map((c) => c.type);
    expect(types).toContain("text");
    expect(types).toContain("voice");
  });

  it("skips channels in children that have no channel type marker", async () => {
    const netId = "!net8:s.com";
    const textId = "!text8:s.com";
    const unmarkedId = "!unmarked8:s.com";
    const netRoom = makeRoom(netId, "Net", { priority: 10 });
    const textRoom = makeRoom(textId, "chat", { channelType: "text" });
    const unmarkedRoom = makeRoom(unmarkedId, "random-room");

    const client = makeClient([netRoom, textRoom, unmarkedRoom], {
      [netId]: [
        makeHierarchyRoom(netId),
        makeHierarchyRoom(textId),
        makeHierarchyRoom(unmarkedId),
      ],
    });

    const node = await buildNetNode(client as any, netRoom as any);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].id).toBe(textId);
  });
});

// ---------------------------------------------------------------------------
// Tests — buildLoungeTree
// ---------------------------------------------------------------------------

describe("buildLoungeTree", () => {
  it("returns an empty array when given no net rooms", async () => {
    const client = makeClient([]);

    const result = await buildLoungeTree(client as any, []);

    expect(result).toEqual([]);
  });

  it("maps each net room to a HierarchyNode via buildNetNode (parallel)", async () => {
    const net1 = makeRoom("!n1:s.com", "Net One", { priority: 10, netName: "Net One" });
    const net2 = makeRoom("!n2:s.com", "Net Two", { priority: 20, netName: "Net Two" });

    const client = makeClient([net1, net2], {
      "!n1:s.com": [makeHierarchyRoom("!n1:s.com")],
      "!n2:s.com": [makeHierarchyRoom("!n2:s.com")],
    });

    const result = await buildLoungeTree(client as any, [net1 as any, net2 as any]);

    expect(result).toHaveLength(2);
    const ids = result.map((n) => n.id);
    expect(ids).toContain("!n1:s.com");
    expect(ids).toContain("!n2:s.com");
  });

  it("preserves ship type for ship rooms in the tree", async () => {
    const shipRoom = makeRoom("!ship:s.com", "Ship Net", { priority: 60, isShip: true });

    const client = makeClient([shipRoom], {
      "!ship:s.com": [makeHierarchyRoom("!ship:s.com")],
    });

    const result = await buildLoungeTree(client as any, [shipRoom as any]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("ship");
  });
});

// ---------------------------------------------------------------------------
// Tests — buildOperationTree
// ---------------------------------------------------------------------------

describe("buildOperationTree", () => {
  it("returns [] when the operation space has no children beyond itself", async () => {
    const opId = "!op:s.com";
    const opRoom = makeRoom(opId, "Op Alpha");

    const client = makeClient([opRoom], {
      [opId]: [makeHierarchyRoom(opId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toEqual([]);
  });

  it("returns [] when the operation space hierarchy is empty", async () => {
    const opId = "!op:s.com";
    const opRoom = makeRoom(opId, "Op Alpha");

    const client = makeClient([opRoom], {
      [opId]: [],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toEqual([]);
  });

  it("maps a child space with opnode kind=strike-group to type 'strike-group'", async () => {
    const opId = "!op:s.com";
    const sgId = "!sg:s.com";
    const opRoom = makeRoom(opId, "Op Alpha");
    const sgRoom = makeRoom(sgId, "Strike Group 1", {
      stateEvents: {
        [OPNODE_EVENT]: { kind: "strike-group" },
      },
    });

    const client = makeClient([opRoom, sgRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(sgId)],
      [sgId]: [makeHierarchyRoom(sgId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("strike-group");
    expect(result[0].id).toBe(sgId);
    expect(result[0].name).toBe("Strike Group 1");
  });

  it("maps a child space with opnode kind=ship to type 'ship'", async () => {
    const opId = "!op:s.com";
    const shipId = "!shipop:s.com";
    const opRoom = makeRoom(opId, "Op");
    const shipRoom = makeRoom(shipId, "UEE Idris", {
      stateEvents: {
        [OPNODE_EVENT]: { kind: "ship" },
      },
    });

    const client = makeClient([opRoom, shipRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(shipId)],
      [shipId]: [makeHierarchyRoom(shipId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("ship");
  });

  it("recurses into strike-group children to find ship nodes", async () => {
    const opId = "!op:s.com";
    const sgId = "!sg:s.com";
    const shipId = "!shipop:s.com";
    const opRoom = makeRoom(opId, "Op");
    const sgRoom = makeRoom(sgId, "Strike Group 1", {
      stateEvents: { [OPNODE_EVENT]: { kind: "strike-group" } },
    });
    const shipRoom = makeRoom(shipId, "UEE Idris", {
      stateEvents: { [OPNODE_EVENT]: { kind: "ship" } },
    });

    const client = makeClient([opRoom, sgRoom, shipRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(sgId)],
      [sgId]: [makeHierarchyRoom(sgId), makeHierarchyRoom(shipId)],
      [shipId]: [makeHierarchyRoom(shipId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    const sg = result[0];
    expect(sg.type).toBe("strike-group");
    expect(sg.children).toHaveLength(1);
    expect(sg.children[0].type).toBe("ship");
    expect(sg.children[0].id).toBe(shipId);
  });

  it("maps voice/text channels as leaf nodes under ships", async () => {
    const opId = "!op:s.com";
    const shipId = "!shipop:s.com";
    const voiceId = "!vc:s.com";
    const textId = "!tc:s.com";
    const opRoom = makeRoom(opId, "Op");
    const shipRoom = makeRoom(shipId, "UEE Idris", {
      stateEvents: { [OPNODE_EVENT]: { kind: "ship" } },
    });
    const voiceRoom = makeRoom(voiceId, "Bridge Comms", { channelType: "voice" });
    const textRoom = makeRoom(textId, "Orders", { channelType: "text" });

    const client = makeClient([opRoom, shipRoom, voiceRoom, textRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(shipId)],
      [shipId]: [makeHierarchyRoom(shipId), makeHierarchyRoom(voiceId), makeHierarchyRoom(textId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    const ship = result[0];
    expect(ship.type).toBe("ship");
    const childTypes = ship.children.map((c) => c.type);
    expect(childTypes).toContain("voice");
    expect(childTypes).toContain("text");
    expect(ship.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it("maps child rooms with net markers to type 'net' with isBroadcast and priority", async () => {
    const opId = "!op:s.com";
    const netId = "!netop:s.com";
    const opRoom = makeRoom(opId, "Op");
    const netRoom = makeRoom(netId, "1MC", {
      priority: 100,
      netName: "1MC",
      broadcast: true,
    });

    const client = makeClient([opRoom, netRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(netId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("net");
    expect(result[0].isBroadcast).toBe(true);
    expect(result[0].priority).toBe(100);
    expect(result[0].name).toBe("1MC");
  });

  it("skips children with no opnode, channel type, or net marker", async () => {
    const opId = "!op:s.com";
    const unmarkedId = "!unmark:s.com";
    const opRoom = makeRoom(opId, "Op");
    const unmarkedRoom = makeRoom(unmarkedId, "random room");

    const client = makeClient([opRoom, unmarkedRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(unmarkedId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toEqual([]);
  });

  it("does not infinite-loop on a self-referencing space (cycle guard)", async () => {
    const opId = "!op:s.com";
    const sgId = "!sg:s.com";
    const opRoom = makeRoom(opId, "Op");
    const sgRoom = makeRoom(sgId, "SG1", {
      stateEvents: { [OPNODE_EVENT]: { kind: "strike-group" } },
    });

    // sg references itself in the hierarchy
    const client = makeClient([opRoom, sgRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(sgId)],
      [sgId]: [makeHierarchyRoom(sgId), makeHierarchyRoom(sgId)], // self-reference
    });

    // Must resolve (not hang or throw stack overflow)
    const result = await buildOperationTree(client as any, opId);

    expect(Array.isArray(result)).toBe(true);
    // SG node should exist but not recurse into itself
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("strike-group");
  });

  it("does not recurse deeper than 4 levels (max depth guard)", async () => {
    // Build a chain: op → sg1(depth1) → sg2(depth2) → sg3(depth3) → sg4(depth4) → sg5(depth5, beyond guard)
    const opId = "!op:s.com";
    const makeOpNodeRoom = (id: string, name: string) =>
      makeRoom(id, name, { stateEvents: { [OPNODE_EVENT]: { kind: "strike-group" } } });

    const sg1 = makeOpNodeRoom("!sg1:s.com", "SG1");
    const sg2 = makeOpNodeRoom("!sg2:s.com", "SG2");
    const sg3 = makeOpNodeRoom("!sg3:s.com", "SG3");
    const sg4 = makeOpNodeRoom("!sg4:s.com", "SG4");
    const sg5 = makeOpNodeRoom("!sg5:s.com", "SG5");
    const opRoom = makeRoom(opId, "Op");

    const client = makeClient([opRoom, sg1, sg2, sg3, sg4, sg5], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom("!sg1:s.com")],
      "!sg1:s.com": [makeHierarchyRoom("!sg1:s.com"), makeHierarchyRoom("!sg2:s.com")],
      "!sg2:s.com": [makeHierarchyRoom("!sg2:s.com"), makeHierarchyRoom("!sg3:s.com")],
      "!sg3:s.com": [makeHierarchyRoom("!sg3:s.com"), makeHierarchyRoom("!sg4:s.com")],
      "!sg4:s.com": [makeHierarchyRoom("!sg4:s.com"), makeHierarchyRoom("!sg5:s.com")],
      "!sg5:s.com": [makeHierarchyRoom("!sg5:s.com")],
    });

    const result = await buildOperationTree(client as any, opId);

    // Depth 1: sg1 ✓, Depth 2: sg2 ✓, Depth 3: sg3 ✓, Depth 4: sg4 ✓
    // Depth 5: sg5 — beyond max depth of 4, should be absent
    expect(result).toHaveLength(1);
    const sg1Node = result[0];
    expect(sg1Node.id).toBe("!sg1:s.com");
    const sg2Node = sg1Node.children[0];
    expect(sg2Node.id).toBe("!sg2:s.com");
    const sg3Node = sg2Node.children[0];
    expect(sg3Node.id).toBe("!sg3:s.com");
    const sg4Node = sg3Node.children[0];
    expect(sg4Node.id).toBe("!sg4:s.com");
    // sg4 should have no recursive children (depth 5 would be beyond guard)
    expect(sg4Node.children).toHaveLength(0);
  });

  it("full nesting: op → strike-group → ship → voice+text channels", async () => {
    const opId = "!op:s.com";
    const sgId = "!sg:s.com";
    const shipId = "!ship:s.com";
    const voiceId = "!vc:s.com";
    const textId = "!tc:s.com";

    const opRoom = makeRoom(opId, "Op Alpha");
    const sgRoom = makeRoom(sgId, "SG Bravo", {
      stateEvents: { [OPNODE_EVENT]: { kind: "strike-group" } },
    });
    const shipRoom = makeRoom(shipId, "UEE Javelin", {
      stateEvents: { [OPNODE_EVENT]: { kind: "ship" } },
    });
    const voiceRoom = makeRoom(voiceId, "CIC Comms", { channelType: "voice" });
    const textRoom = makeRoom(textId, "Orders", { channelType: "text" });

    const client = makeClient([opRoom, sgRoom, shipRoom, voiceRoom, textRoom], {
      [opId]: [makeHierarchyRoom(opId), makeHierarchyRoom(sgId)],
      [sgId]: [makeHierarchyRoom(sgId), makeHierarchyRoom(shipId)],
      [shipId]: [makeHierarchyRoom(shipId), makeHierarchyRoom(voiceId), makeHierarchyRoom(textId)],
    });

    const result = await buildOperationTree(client as any, opId);

    expect(result).toHaveLength(1);
    const sg = result[0];
    expect(sg.type).toBe("strike-group");
    expect(sg.name).toBe("SG Bravo");

    expect(sg.children).toHaveLength(1);
    const ship = sg.children[0];
    expect(ship.type).toBe("ship");
    expect(ship.name).toBe("UEE Javelin");

    expect(ship.children).toHaveLength(2);
    const childTypes = ship.children.map((c) => c.type);
    expect(childTypes).toContain("voice");
    expect(childTypes).toContain("text");
  });
});
