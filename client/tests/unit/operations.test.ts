import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  createOperation,
  getOperation,
  listOperations,
  updateOperationState,
  getRoster,
  addRosterEntry,
  updateRosterEntry,
  inviteToOperation,
  OPERATION_EVENT,
  ROSTER_EVENT,
} from "@/renderer/matrix/operations";
import { OperationState } from "@/renderer/matrix/operationTypes";
import type { RosterEntry } from "@/renderer/matrix/operationTypes";

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
  opts: {
    opContent?: Record<string, unknown>;
    rosterContent?: Record<string, unknown>;
  } = {},
) {
  const stateMap: Map<string, ReturnType<typeof makeStateEvent>> = new Map();

  if (opts.opContent !== undefined) {
    stateMap.set(OPERATION_EVENT, makeStateEvent(OPERATION_EVENT, opts.opContent));
  }
  if (opts.rosterContent !== undefined) {
    stateMap.set(ROSTER_EVENT, makeStateEvent(ROSTER_EVENT, opts.rosterContent));
  }

  return {
    roomId,
    currentState: {
      getStateEvents: (evType: string, stateKey: string) => {
        if (stateKey !== "") return null;
        return stateMap.get(evType) ?? null;
      },
    },
  };
}

function makeClient(
  rooms: ReturnType<typeof makeRoom>[],
  overrides: Partial<{
    getUserId: () => string;
    createRoom: ReturnType<typeof vi.fn>;
    sendStateEvent: ReturnType<typeof vi.fn>;
    invite: ReturnType<typeof vi.fn>;
    getProfileInfo: ReturnType<typeof vi.fn>;
    getRoom: (id: string) => ReturnType<typeof makeRoom> | null;
  }> = {},
) {
  return {
    getUserId: overrides.getUserId ?? (() => "@commander:server.com"),
    getRooms: () => rooms,
    getRoom: overrides.getRoom ?? ((id: string) => rooms.find((r) => r.roomId === id) ?? null),
    createRoom: overrides.createRoom ?? vi.fn().mockResolvedValue({ room_id: "!new-op:server.com" }),
    sendStateEvent: overrides.sendStateEvent ?? vi.fn().mockResolvedValue({}),
    invite: overrides.invite ?? vi.fn().mockResolvedValue({}),
    getProfileInfo: overrides.getProfileInfo ?? vi.fn().mockResolvedValue({ displayname: undefined }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OPERATION_EVENT / ROSTER_EVENT constants", () => {
  it("OPERATION_EVENT is the correct org.hailfreq event type string", () => {
    expect(OPERATION_EVENT).toBe("org.hailfreq.operation");
  });

  it("ROSTER_EVENT is the correct org.hailfreq event type string", () => {
    expect(ROSTER_EVENT).toBe("org.hailfreq.roster");
  });
});

// ---------------------------------------------------------------------------
// createOperation
// ---------------------------------------------------------------------------

describe("createOperation", () => {
  it("calls createRoom with creation_content type m.space and E2EE initial state", async () => {
    const client = makeClient([]);

    await createOperation(client as any, "Op Alpha", "Test operation");

    expect(client.createRoom).toHaveBeenCalledOnce();
    const args = (client.createRoom as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Must be a Space
    expect(args.creation_content).toMatchObject({ type: "m.space" });

    // Must have E2EE
    const initialState: any[] = args.initial_state;
    const encEvent = initialState.find((e: any) => e.type === "m.room.encryption");
    expect(encEvent).toBeDefined();
    expect(encEvent.content.algorithm).toBe("m.megolm.v1.aes-sha2");

    // Must have org.hailfreq.operation state event
    const opEvent = initialState.find((e: any) => e.type === OPERATION_EVENT);
    expect(opEvent).toBeDefined();
    expect(opEvent.content.name).toBe("Op Alpha");
    expect(opEvent.content.description).toBe("Test operation");
    expect(opEvent.content.state).toBe("planning");
    expect(opEvent.content.commanderId).toBe("@commander:server.com");
    expect(typeof opEvent.content.createdAt).toBe("string");
  });

  it("includes scheduledStart in the initial state event when provided", async () => {
    const client = makeClient([]);
    const scheduledStart = "2026-07-01T12:00:00.000Z";

    await createOperation(client as any, "Op Beta", "Scheduled op", scheduledStart);

    const args = (client.createRoom as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const initialState: any[] = args.initial_state;
    const opEvent = initialState.find((e: any) => e.type === OPERATION_EVENT);
    expect(opEvent.content.scheduledStart).toBe(scheduledStart);
  });

  it("does not include scheduledStart when not provided", async () => {
    const client = makeClient([]);

    await createOperation(client as any, "Op Gamma", "No schedule");

    const args = (client.createRoom as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const initialState: any[] = args.initial_state;
    const opEvent = initialState.find((e: any) => e.type === OPERATION_EVENT);
    expect(opEvent.content.scheduledStart).toBeUndefined();
  });

  it("returns an Operation with the correct fields", async () => {
    const client = makeClient([]);

    const op = await createOperation(client as any, "Op Delta", "Return test");

    expect(op.id).toBe("!new-op:server.com");
    expect(op.name).toBe("Op Delta");
    expect(op.description).toBe("Return test");
    expect(op.state).toBe(OperationState.PLANNING);
    expect(op.commanderId).toBe("@commander:server.com");
    expect(typeof op.id).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// getOperation
// ---------------------------------------------------------------------------

describe("getOperation", () => {
  it("returns the Operation when room and state event are present", async () => {
    const opContent = {
      name: "Op Alpha",
      description: "Active op",
      state: "active",
      commanderId: "@commander:server.com",
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    const room = makeRoom("!op1:server.com", { opContent });
    const client = makeClient([room]);

    const op = await getOperation(client as any, "!op1:server.com");

    expect(op.id).toBe("!op1:server.com");
    expect(op.name).toBe("Op Alpha");
    expect(op.state).toBe(OperationState.ACTIVE);
  });

  it("throws when the room is not found", async () => {
    const client = makeClient([]);

    await expect(getOperation(client as any, "!missing:server.com")).rejects.toThrow(
      /!missing:server\.com/,
    );
  });

  it("throws when the org.hailfreq.operation state event is absent", async () => {
    const room = makeRoom("!op-no-event:server.com"); // no opContent
    const client = makeClient([room]);

    await expect(getOperation(client as any, "!op-no-event:server.com")).rejects.toThrow(
      /org\.hailfreq\.operation/,
    );
  });
});

// ---------------------------------------------------------------------------
// listOperations
// ---------------------------------------------------------------------------

describe("listOperations", () => {
  it("returns only rooms carrying the org.hailfreq.operation state event", () => {
    const opRoom = makeRoom("!op1:server.com", {
      opContent: {
        name: "Op One",
        description: "",
        state: "planning",
        commanderId: "@c:server.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const plainRoom = makeRoom("!plain:server.com"); // no op event
    const client = makeClient([opRoom, plainRoom]);

    const ops = listOperations(client as any);

    expect(ops).toHaveLength(1);
    expect(ops[0].id).toBe("!op1:server.com");
    expect(ops[0].name).toBe("Op One");
  });

  it("returns [] when no rooms have the operation event", () => {
    const client = makeClient([makeRoom("!plain:server.com")]);
    expect(listOperations(client as any)).toEqual([]);
  });

  it("maps multiple operations correctly", () => {
    const makeOpRoom = (id: string, name: string) =>
      makeRoom(id, {
        opContent: {
          name,
          description: "",
          state: "planning",
          commanderId: "@c:server.com",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });

    const client = makeClient([makeOpRoom("!op1:s.com", "Alpha"), makeOpRoom("!op2:s.com", "Bravo")]);
    const ops = listOperations(client as any);
    expect(ops).toHaveLength(2);
    const names = ops.map((o) => o.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Bravo");
  });
});

// ---------------------------------------------------------------------------
// updateOperationState — lifecycle transitions
// ---------------------------------------------------------------------------

describe("updateOperationState", () => {
  it("sets actualStart (ISO string) when transitioning to ACTIVE", async () => {
    const beforeNow = new Date().toISOString();
    const opRoom = makeRoom("!op1:server.com", {
      opContent: {
        name: "Op",
        description: "",
        state: "planning",
        commanderId: "@c:server.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await updateOperationState(client as any, "!op1:server.com", OperationState.ACTIVE);

    expect(sendStateEvent).toHaveBeenCalledOnce();
    const [, eventType, content] = sendStateEvent.mock.calls[0];
    expect(eventType).toBe(OPERATION_EVENT);
    expect(content.state).toBe("active");
    expect(typeof content.actualStart).toBe("string");
    const afterNow = new Date().toISOString();
    expect(content.actualStart >= beforeNow).toBe(true);
    expect(content.actualStart <= afterNow).toBe(true);
  });

  it("sets actualEnd (ISO string) when transitioning to COMPLETED", async () => {
    const opRoom = makeRoom("!op1:server.com", {
      opContent: {
        name: "Op",
        description: "",
        state: "active",
        commanderId: "@c:server.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        actualStart: "2026-06-01T10:00:00.000Z",
      },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await updateOperationState(client as any, "!op1:server.com", OperationState.COMPLETED);

    const [, , content] = sendStateEvent.mock.calls[0];
    expect(content.state).toBe("completed");
    expect(typeof content.actualEnd).toBe("string");
    // Must NOT clobber existing actualStart
    expect(content.actualStart).toBe("2026-06-01T10:00:00.000Z");
  });

  it("does not clobber existing actualStart when transitioning to COMPLETED", async () => {
    const existingStart = "2026-06-01T10:00:00.000Z";
    const opRoom = makeRoom("!op1:server.com", {
      opContent: {
        name: "Op",
        description: "",
        state: "active",
        commanderId: "@c:server.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        actualStart: existingStart,
      },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await updateOperationState(client as any, "!op1:server.com", OperationState.COMPLETED);

    const [, , content] = sendStateEvent.mock.calls[0];
    expect(content.actualStart).toBe(existingStart);
  });

  it("transitions to ARCHIVED without setting timestamps", async () => {
    const opRoom = makeRoom("!op1:server.com", {
      opContent: {
        name: "Op",
        description: "",
        state: "completed",
        commanderId: "@c:server.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        actualStart: "2026-06-01T10:00:00.000Z",
        actualEnd: "2026-06-01T12:00:00.000Z",
      },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await updateOperationState(client as any, "!op1:server.com", OperationState.ARCHIVED);

    const [, , content] = sendStateEvent.mock.calls[0];
    expect(content.state).toBe("archived");
  });

  it("throws when the operation room is not found", async () => {
    const client = makeClient([]);

    await expect(
      updateOperationState(client as any, "!missing:server.com", OperationState.ACTIVE),
    ).rejects.toThrow(/!missing:server\.com/);
  });
});

// ---------------------------------------------------------------------------
// getRoster
// ---------------------------------------------------------------------------

describe("getRoster", () => {
  it("returns the roster when the state event is present", () => {
    const entries = [
      {
        userId: "@alice:server.com",
        userName: "Alice",
        strikeGroupId: "sg1",
        shipId: "ship1",
        circuitId: "circ1",
        role: "Captain",
        status: "assigned",
      },
    ];
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: { entries },
    });
    const client = makeClient([opRoom]);

    const roster = getRoster(client as any, "!op1:server.com");

    expect(roster.operationId).toBe("!op1:server.com");
    expect(roster.entries).toHaveLength(1);
    expect(roster.entries[0].userId).toBe("@alice:server.com");
  });

  it("returns empty roster when the org.hailfreq.roster state event is absent", () => {
    const opRoom = makeRoom("!op1:server.com"); // no roster event
    const client = makeClient([opRoom]);

    const roster = getRoster(client as any, "!op1:server.com");

    expect(roster.operationId).toBe("!op1:server.com");
    expect(roster.entries).toEqual([]);
  });

  it("returns empty roster when room is not found", () => {
    const client = makeClient([]);

    const roster = getRoster(client as any, "!missing:server.com");

    expect(roster.operationId).toBe("!missing:server.com");
    expect(roster.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addRosterEntry
// ---------------------------------------------------------------------------

describe("addRosterEntry", () => {
  const baseEntry: RosterEntry = {
    userId: "@alice:server.com",
    userName: "Alice",
    strikeGroupId: "",
    shipId: "",
    circuitId: "",
    role: "Pilot",
    status: "pending",
  };

  it("adds an entry to a previously empty roster", async () => {
    const opRoom = makeRoom("!op1:server.com"); // no roster event
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await addRosterEntry(client as any, "!op1:server.com", baseEntry);

    expect(sendStateEvent).toHaveBeenCalledOnce();
    const [, eventType, content] = sendStateEvent.mock.calls[0];
    expect(eventType).toBe(ROSTER_EVENT);
    expect(content.entries).toHaveLength(1);
    expect(content.entries[0].userId).toBe("@alice:server.com");
  });

  it("rejects duplicates with a descriptive error when userId already in roster", async () => {
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: {
        entries: [
          {
            userId: "@alice:server.com",
            userName: "Alice",
            strikeGroupId: "",
            shipId: "",
            circuitId: "",
            role: "Pilot",
            status: "assigned",
          },
        ],
      },
    });
    const client = makeClient([opRoom]);

    await expect(
      addRosterEntry(client as any, "!op1:server.com", baseEntry),
    ).rejects.toThrow(/@alice:server\.com/);
  });

  it("appends to an existing roster without mutating", async () => {
    const existingEntry = {
      userId: "@bob:server.com",
      userName: "Bob",
      strikeGroupId: "",
      shipId: "",
      circuitId: "",
      role: "Engineer",
      status: "assigned",
    };
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: { entries: [existingEntry] },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await addRosterEntry(client as any, "!op1:server.com", baseEntry);

    const [, , content] = sendStateEvent.mock.calls[0];
    expect(content.entries).toHaveLength(2);
    const ids = content.entries.map((e: RosterEntry) => e.userId);
    expect(ids).toContain("@bob:server.com");
    expect(ids).toContain("@alice:server.com");
  });
});

// ---------------------------------------------------------------------------
// updateRosterEntry
// ---------------------------------------------------------------------------

describe("updateRosterEntry", () => {
  it("updates the specified user's entry with the provided fields", async () => {
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: {
        entries: [
          {
            userId: "@alice:server.com",
            userName: "Alice",
            strikeGroupId: "",
            shipId: "",
            circuitId: "",
            role: "Pilot",
            status: "pending",
          },
        ],
      },
    });
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { sendStateEvent });

    await updateRosterEntry(client as any, "!op1:server.com", "@alice:server.com", {
      status: "assigned",
      shipId: "ship-alpha",
    });

    const [, , content] = sendStateEvent.mock.calls[0];
    expect(content.entries).toHaveLength(1);
    const alice = content.entries[0];
    expect(alice.status).toBe("assigned");
    expect(alice.shipId).toBe("ship-alpha");
    // Existing fields preserved
    expect(alice.role).toBe("Pilot");
  });

  it("throws when userId is not in the roster", async () => {
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: {
        entries: [
          {
            userId: "@bob:server.com",
            userName: "Bob",
            strikeGroupId: "",
            shipId: "",
            circuitId: "",
            role: "Engineer",
            status: "assigned",
          },
        ],
      },
    });
    const client = makeClient([opRoom]);

    await expect(
      updateRosterEntry(client as any, "!op1:server.com", "@alice:server.com", { status: "joined" }),
    ).rejects.toThrow(/@alice:server\.com/);
  });

  it("does not mutate the original entries array", async () => {
    let capturedEntries: any[] = [];
    const opRoom = makeRoom("!op1:server.com", {
      rosterContent: {
        entries: [
          {
            userId: "@alice:server.com",
            userName: "Alice",
            strikeGroupId: "",
            shipId: "",
            circuitId: "",
            role: "Pilot",
            status: "pending",
          },
        ],
      },
    });
    // Capture original entries reference before update
    const originalEntries = opRoom.currentState
      .getStateEvents(ROSTER_EVENT, "")
      ?.getContent().entries;

    const sendStateEvent = vi.fn().mockImplementation((_roomId, _type, content) => {
      capturedEntries = content.entries;
      return Promise.resolve({});
    });
    const client = makeClient([opRoom], { sendStateEvent });

    await updateRosterEntry(client as any, "!op1:server.com", "@alice:server.com", {
      status: "joined",
    });

    // The written entries should be a new array reference
    expect(capturedEntries).not.toBe(originalEntries);
  });
});

// ---------------------------------------------------------------------------
// inviteToOperation
// ---------------------------------------------------------------------------

describe("inviteToOperation", () => {
  it("calls client.invite for each userId", async () => {
    const opRoom = makeRoom("!op1:server.com");
    const invite = vi.fn().mockResolvedValue({});
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { invite, sendStateEvent });

    await inviteToOperation(client as any, "!op1:server.com", [
      "@alice:server.com",
      "@bob:server.com",
    ]);

    expect(invite).toHaveBeenCalledTimes(2);
    const invitedUsers = invite.mock.calls.map((c: any[]) => c[1]);
    expect(invitedUsers).toContain("@alice:server.com");
    expect(invitedUsers).toContain("@bob:server.com");
  });

  it("adds a pending roster entry for each invited user", async () => {
    const opRoom = makeRoom("!op1:server.com");
    const invite = vi.fn().mockResolvedValue({});
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { invite, sendStateEvent });

    await inviteToOperation(client as any, "!op1:server.com", ["@alice:server.com"]);

    // sendStateEvent should have been called to add to roster
    const rosterCall = sendStateEvent.mock.calls.find((c: any[]) => c[1] === ROSTER_EVENT);
    expect(rosterCall).toBeDefined();
    const entries = rosterCall![2].entries;
    const aliceEntry = entries.find((e: RosterEntry) => e.userId === "@alice:server.com");
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry.status).toBe("pending");
  });

  it("continues on per-user failure and throws aggregate error listing failed users", async () => {
    const opRoom = makeRoom("!op1:server.com");
    const invite = vi
      .fn()
      .mockResolvedValueOnce({}) // alice succeeds
      .mockRejectedValueOnce(new Error("Forbidden")); // bob fails
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient([opRoom], { invite, sendStateEvent });

    let thrown: unknown;
    try {
      await inviteToOperation(client as any, "!op1:server.com", [
        "@alice:server.com",
        "@bob:server.com",
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect((thrown as Error).message).toContain("@bob:server.com");
    // alice should NOT appear in error
    expect((thrown as Error).message).not.toContain("@alice:server.com");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("does not throw when all invitations succeed", async () => {
    const opRoom = makeRoom("!op1:server.com");
    const invite = vi.fn().mockResolvedValue({});
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const client = makeClient([opRoom], { invite, sendStateEvent });

    await expect(
      inviteToOperation(client as any, "!op1:server.com", ["@alice:server.com"]),
    ).resolves.toBeUndefined();
  });
});
