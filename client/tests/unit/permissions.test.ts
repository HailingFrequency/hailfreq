import { describe, it, expect, vi, afterEach } from "vitest";
import { detectAdminCapabilities } from "@/renderer/matrix/permissions";

// ---------------------------------------------------------------------------
// Minimal MatrixClient factory
// ---------------------------------------------------------------------------

function makeRoom(
  roomId: string,
  userId: string,
  myPowerLevel: number,
  hasPriorityEvent = true,
) {
  return {
    roomId,
    currentState: {
      getStateEvents: (type: string, _key: string) => {
        if (type === "org.hailfreq.net.priority") {
          return hasPriorityEvent ? { getContent: () => ({ value: 50 }) } : null;
        }
        return null;
      },
    },
    getJoinedMemberCount: () => 2,
    getMember: (uid: string) =>
      uid === userId ? { powerLevel: myPowerLevel, userId } : null,
    name: "Test Net",
  };
}

function makeClient(
  userId: string,
  rooms: ReturnType<typeof makeRoom>[],
  homeserverUrl = "https://matrix.example.com",
  accessToken = "tok_test",
) {
  return {
    getSafeUserId: () => userId,
    getRooms: () => rooms,
    getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
    getHomeserverUrl: () => homeserverUrl,
    getAccessToken: () => accessToken,
    getUser: (_uid: string) => null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectAdminCapabilities", () => {
  it("returns isAnyAdmin=false when user has PL 0 in all nets", async () => {
    const room = makeRoom("!room1:example.com", "@alice:example.com", 0);
    const client = makeClient("@alice:example.com", [room]);

    // Stub fetch so the server-admin check fails cleanly
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const caps = await detectAdminCapabilities(client as any);
    expect(caps.isAnyAdmin).toBe(false);
    expect(caps.adminNets.size).toBe(0);
    expect(caps.squadLeaderNets.size).toBe(0);
    expect(caps.isServerAdmin).toBe(false);
  });

  it("returns isAnyAdmin=true and adminNets when user has PL 100", async () => {
    const room = makeRoom("!room1:example.com", "@alice:example.com", 100);
    const client = makeClient("@alice:example.com", [room]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const caps = await detectAdminCapabilities(client as any);
    expect(caps.isAnyAdmin).toBe(true);
    expect(caps.adminNets.has("!room1:example.com")).toBe(true);
    // PL 100 also counts as squad leader
    expect(caps.squadLeaderNets.has("!room1:example.com")).toBe(true);
  });

  it("recognises squad leader (PL 75) without full admin", async () => {
    const room = makeRoom("!room2:example.com", "@bob:example.com", 75);
    const client = makeClient("@bob:example.com", [room]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const caps = await detectAdminCapabilities(client as any);
    expect(caps.isAnyAdmin).toBe(false);
    expect(caps.adminNets.size).toBe(0);
    expect(caps.squadLeaderNets.has("!room2:example.com")).toBe(true);
  });

  it("ignores rooms that lack the org.hailfreq.net.priority state event", async () => {
    // Room without the priority event is not a voice net
    const nonNet = makeRoom("!chat1:example.com", "@alice:example.com", 100, false);
    const voiceNet = makeRoom("!net1:example.com", "@alice:example.com", 100, true);
    const client = makeClient("@alice:example.com", [nonNet, voiceNet]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const caps = await detectAdminCapabilities(client as any);
    expect(caps.adminNets.has("!chat1:example.com")).toBe(false);
    expect(caps.adminNets.has("!net1:example.com")).toBe(true);
  });

  it("detects isServerAdmin=true when Synapse admin self-lookup succeeds", async () => {
    const room = makeRoom("!room1:example.com", "@alice:example.com", 100);
    const client = makeClient("@alice:example.com", [room]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ admin: true }),
      }),
    );

    const caps = await detectAdminCapabilities(client as any);
    expect(caps.isServerAdmin).toBe(true);
  });
});
