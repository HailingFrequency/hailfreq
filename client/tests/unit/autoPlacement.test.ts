import { describe, it, expect, vi, afterEach } from "vitest";
import {
  channelsForUser,
  placeUserInOperation,
  watchOperationActivation,
} from "@/renderer/matrix/autoPlacement";
import { OPERATION_EVENT, ROSTER_EVENT } from "@/renderer/matrix/operations";
import type { Roster, RosterEntry } from "@/renderer/matrix/operationTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  userId: string,
  circuitId: string,
  status: RosterEntry["status"],
): RosterEntry {
  return {
    userId,
    userName: userId,
    strikeGroupId: "",
    shipId: "",
    circuitId,
    role: "",
    status,
  };
}

function makeRoster(entries: RosterEntry[]): Roster {
  return { operationId: "!op1:server.com", entries };
}

// Minimal fake MatrixEvent for RoomState.events tests
function makeStateEvent(opts: {
  type: string;
  roomId: string;
  content: Record<string, unknown>;
  prevContent?: Record<string, unknown>;
}) {
  return {
    getType: () => opts.type,
    getRoomId: () => opts.roomId,
    getContent: () => opts.content,
    getPrevContent: () => opts.prevContent ?? null,
  };
}

function makeRosterStateEvent(operationId: string, entries: RosterEntry[]) {
  return {
    getContent: () => ({ entries }),
    getType: () => ROSTER_EVENT,
  };
}

function makeOpStateEvent(
  operationId: string,
  content: Record<string, unknown>,
) {
  return {
    getContent: () => content,
    getType: () => OPERATION_EVENT,
  };
}

// Build a fake MatrixClient sufficient for placeUserInOperation tests.
// `roomMap` keys are room IDs; value is the fake room object (or null if absent).
function makeClient(opts: {
  rooms?: Map<
    string,
    {
      membership?: string;
      rosterEntries?: RosterEntry[];
    }
  >;
  joinRoom?: ReturnType<typeof vi.fn>;
}) {
  const rooms = opts.rooms ?? new Map();

  return {
    getRoom: vi.fn((id: string) => {
      const room = rooms.get(id);
      if (!room) return null;
      const entries = room.rosterEntries ?? [];
      return {
        roomId: id,
        getMyMembership: () => room.membership ?? "leave",
        currentState: {
          getStateEvents: (evType: string, stateKey: string) => {
            if (stateKey !== "") return null;
            if (evType === ROSTER_EVENT) {
              return makeRosterStateEvent(id, entries);
            }
            return null;
          },
        },
      };
    }),
    joinRoom: opts.joinRoom ?? vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// channelsForUser
// ---------------------------------------------------------------------------

describe("channelsForUser", () => {
  it("returns circuitIds for entries with status assigned and a non-empty circuitId", () => {
    const roster = makeRoster([
      makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
    ]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual(["!ch1:s.com"]);
  });

  it("returns circuitIds for entries with status joined and a non-empty circuitId", () => {
    const roster = makeRoster([
      makeEntry("@alice:s.com", "!ch2:s.com", "joined"),
    ]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual(["!ch2:s.com"]);
  });

  it("excludes entries with status pending", () => {
    const roster = makeRoster([
      makeEntry("@alice:s.com", "!ch1:s.com", "pending"),
    ]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual([]);
  });

  it("excludes entries with an empty circuitId", () => {
    const roster = makeRoster([makeEntry("@alice:s.com", "", "assigned")]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual([]);
  });

  it("excludes entries belonging to a different user", () => {
    const roster = makeRoster([
      makeEntry("@bob:s.com", "!ch1:s.com", "assigned"),
    ]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual([]);
  });

  it("deduplicates repeated circuitIds for the same user", () => {
    const roster = makeRoster([
      makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
      makeEntry("@alice:s.com", "!ch1:s.com", "joined"),
    ]);
    const result = channelsForUser(roster, "@alice:s.com");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("!ch1:s.com");
  });

  it("returns empty array when roster has no entries", () => {
    const roster = makeRoster([]);
    expect(channelsForUser(roster, "@alice:s.com")).toEqual([]);
  });

  it("collects multiple distinct circuitIds for the same user", () => {
    const roster = makeRoster([
      makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
      makeEntry("@alice:s.com", "!ch2:s.com", "joined"),
    ]);
    const result = channelsForUser(roster, "@alice:s.com");
    expect(result).toHaveLength(2);
    expect(result).toContain("!ch1:s.com");
    expect(result).toContain("!ch2:s.com");
  });
});

// ---------------------------------------------------------------------------
// placeUserInOperation
// ---------------------------------------------------------------------------

describe("placeUserInOperation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("joins channels where the user is not already a member", async () => {
    const joinRoom = vi.fn().mockResolvedValue({});
    const client = makeClient({
      rooms: new Map([
        [
          "!op1:server.com",
          {
            rosterEntries: [
              makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
            ],
          },
        ],
        ["!ch1:s.com", { membership: "leave" }],
      ]),
      joinRoom,
    });

    const result = await placeUserInOperation(
      client as any,
      "!op1:server.com",
      "@alice:s.com",
    );

    expect(joinRoom).toHaveBeenCalledWith("!ch1:s.com");
    expect(result.joined).toContain("!ch1:s.com");
    expect(result.failed).toEqual([]);
  });

  it("skips channels where the user is already joined", async () => {
    const joinRoom = vi.fn().mockResolvedValue({});
    const client = makeClient({
      rooms: new Map([
        [
          "!op1:server.com",
          {
            rosterEntries: [
              makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
            ],
          },
        ],
        ["!ch1:s.com", { membership: "join" }],
      ]),
      joinRoom,
    });

    const result = await placeUserInOperation(
      client as any,
      "!op1:server.com",
      "@alice:s.com",
    );

    expect(joinRoom).not.toHaveBeenCalled();
    expect(result.joined).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("collects per-channel failure without throwing and returns summary", async () => {
    const joinRoom = vi
      .fn()
      .mockRejectedValue(new Error("M_FORBIDDEN: Cannot join"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({
      rooms: new Map([
        [
          "!op1:server.com",
          {
            rosterEntries: [
              makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
            ],
          },
        ],
        ["!ch1:s.com", { membership: "leave" }],
      ]),
      joinRoom,
    });

    const result = await placeUserInOperation(
      client as any,
      "!op1:server.com",
      "@alice:s.com",
    );

    expect(result.failed).toContain("!ch1:s.com");
    expect(result.joined).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("does not throw when all channels fail", async () => {
    const joinRoom = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({
      rooms: new Map([
        [
          "!op1:server.com",
          {
            rosterEntries: [
              makeEntry("@alice:s.com", "!ch1:s.com", "assigned"),
              makeEntry("@alice:s.com", "!ch2:s.com", "joined"),
            ],
          },
        ],
        ["!ch1:s.com", { membership: "leave" }],
        ["!ch2:s.com", { membership: "leave" }],
      ]),
      joinRoom,
    });

    await expect(
      placeUserInOperation(client as any, "!op1:server.com", "@alice:s.com"),
    ).resolves.toMatchObject({
      joined: [],
      failed: expect.arrayContaining(["!ch1:s.com", "!ch2:s.com"]),
    });
  });

  it("returns empty joined and failed when user has no assigned channels", async () => {
    const joinRoom = vi.fn();
    const client = makeClient({
      rooms: new Map([
        ["!op1:server.com", { rosterEntries: [] }],
      ]),
      joinRoom,
    });

    const result = await placeUserInOperation(
      client as any,
      "!op1:server.com",
      "@alice:s.com",
    );

    expect(joinRoom).not.toHaveBeenCalled();
    expect(result).toEqual({ joined: [], failed: [] });
  });
});

// ---------------------------------------------------------------------------
// watchOperationActivation
// ---------------------------------------------------------------------------

describe("watchOperationActivation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Extract the RoomState.events handler registered via client.on */
  function captureHandler(client: ReturnType<typeof makeClient>) {
    const call = (client.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([ev]: [string]) => ev === "RoomState.events",
    );
    if (!call) throw new Error("No RoomState.events handler registered");
    return call[1] as (event: any, state: any, prevEvent: any) => void;
  }

  it("fires onActivated when state transitions from planning to active", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: OPERATION_EVENT,
      roomId: "!op1:server.com",
      content: { state: "active" },
      prevContent: { state: "planning" },
    });

    handler(event, {}, null);

    expect(onActivated).toHaveBeenCalledWith("!op1:server.com");
  });

  it("does NOT fire for non-operation state events", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: "m.room.name",
      roomId: "!op1:server.com",
      content: { name: "New Name" },
    });

    handler(event, {}, null);

    expect(onActivated).not.toHaveBeenCalled();
  });

  it("does NOT fire when arriving state is already active and prev was also active", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: OPERATION_EVENT,
      roomId: "!op1:server.com",
      content: { state: "active" },
      prevContent: { state: "active" },
    });

    handler(event, {}, null);

    expect(onActivated).not.toHaveBeenCalled();
  });

  it("fires when prev state is absent (fresh active event)", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: OPERATION_EVENT,
      roomId: "!op1:server.com",
      content: { state: "active" },
      // no prevContent — fresh arrival
    });

    handler(event, {}, null);

    expect(onActivated).toHaveBeenCalledWith("!op1:server.com");
  });

  it("does NOT fire twice for the same operation while subscribed", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: OPERATION_EVENT,
      roomId: "!op1:server.com",
      content: { state: "active" },
      prevContent: { state: "planning" },
    });

    handler(event, {}, null);
    handler(event, {}, null);

    expect(onActivated).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when new state is NOT active", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    watchOperationActivation(client as any, onActivated);

    const handler = captureHandler(client);
    const event = makeStateEvent({
      type: OPERATION_EVENT,
      roomId: "!op1:server.com",
      content: { state: "completed" },
      prevContent: { state: "active" },
    });

    handler(event, {}, null);

    expect(onActivated).not.toHaveBeenCalled();
  });

  it("removes the listener and stops firing after unsubscribe", () => {
    const client = makeClient({});
    const onActivated = vi.fn();

    const unsub = watchOperationActivation(client as any, onActivated);
    unsub();

    // Verify client.off was called with RoomState.events
    const offCalls = (client.off as ReturnType<typeof vi.fn>).mock.calls;
    const offCall = offCalls.find(([ev]: [string]) => ev === "RoomState.events");
    expect(offCall).toBeDefined();
  });

  it("returns an unsubscribe function", () => {
    const client = makeClient({});
    const unsub = watchOperationActivation(client as any, vi.fn());
    expect(typeof unsub).toBe("function");
  });
});
