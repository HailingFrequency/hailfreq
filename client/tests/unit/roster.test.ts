import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRoster } from "@/renderer/matrix/roster";
import type { NetSummary } from "@/renderer/matrix/nets";

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

interface FakeMember {
  userId: string;
  name: string;
  powerLevel: number;
}

function makeRoom(roomId: string, members: FakeMember[]) {
  return {
    roomId,
    getJoinedMembers: () =>
      members.map((m) => ({
        userId: m.userId,
        name: m.name,
        powerLevel: m.powerLevel,
      })),
  };
}

function makeNet(
  matrixRoomId: string,
  priority = 50,
  memberCount = 2,
): NetSummary {
  return {
    matrixRoomId,
    liveKitRoomName: matrixRoomId.substring(1, matrixRoomId.indexOf(":")),
    properties: { priority, name: "Net", color: "#22d3ee" },
    memberCount,
    myPowerLevel: 100,
  };
}

function makeClient(rooms: ReturnType<typeof makeRoom>[]) {
  return {
    getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
    getUser: (_uid: string) => null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildRoster", () => {
  it("returns one entry per unique user across multiple nets", () => {
    const roomA = makeRoom("!netA:example.com", [
      { userId: "@alice:example.com", name: "Alice", powerLevel: 100 },
      { userId: "@bob:example.com", name: "Bob", powerLevel: 50 },
    ]);
    const roomB = makeRoom("!netB:example.com", [
      { userId: "@alice:example.com", name: "Alice", powerLevel: 75 },
      { userId: "@carol:example.com", name: "Carol", powerLevel: 50 },
    ]);
    const client = makeClient([roomA, roomB]);
    const nets = [makeNet("!netA:example.com"), makeNet("!netB:example.com")];

    const roster = buildRoster(client as any, nets);
    expect(roster).toHaveLength(3);
    const userIds = roster.map((m) => m.userId);
    expect(userIds).toContain("@alice:example.com");
    expect(userIds).toContain("@bob:example.com");
    expect(userIds).toContain("@carol:example.com");
  });

  it("aggregates per-net power levels for members present in multiple nets", () => {
    const roomA = makeRoom("!netA:example.com", [
      { userId: "@alice:example.com", name: "Alice", powerLevel: 100 },
    ]);
    const roomB = makeRoom("!netB:example.com", [
      { userId: "@alice:example.com", name: "Alice", powerLevel: 75 },
    ]);
    const client = makeClient([roomA, roomB]);
    const nets = [makeNet("!netA:example.com"), makeNet("!netB:example.com")];

    const roster = buildRoster(client as any, nets);
    const alice = roster.find((m) => m.userId === "@alice:example.com")!;
    expect(alice.perNetPowerLevel.get("!netA:example.com")).toBe(100);
    expect(alice.perNetPowerLevel.get("!netB:example.com")).toBe(75);
    expect(alice.joinedNets.has("!netA:example.com")).toBe(true);
    expect(alice.joinedNets.has("!netB:example.com")).toBe(true);
  });

  it("sorts result by displayName ascending", () => {
    const room = makeRoom("!net:example.com", [
      { userId: "@z:example.com", name: "Zara", powerLevel: 50 },
      { userId: "@a:example.com", name: "Aaron", powerLevel: 50 },
      { userId: "@m:example.com", name: "Maria", powerLevel: 50 },
    ]);
    const client = makeClient([room]);
    const nets = [makeNet("!net:example.com")];

    const roster = buildRoster(client as any, nets);
    expect(roster.map((m) => m.displayName)).toEqual(["Aaron", "Maria", "Zara"]);
  });

  it("skips net rooms that cannot be resolved (getRoom returns null)", () => {
    const room = makeRoom("!real:example.com", [
      { userId: "@alice:example.com", name: "Alice", powerLevel: 100 },
    ]);
    const client = makeClient([room]);
    const nets = [
      makeNet("!real:example.com"),
      makeNet("!missing:example.com"), // no matching room
    ];

    const roster = buildRoster(client as any, nets);
    // Should still return Alice (from the real net)
    expect(roster).toHaveLength(1);
    expect(roster[0].userId).toBe("@alice:example.com");
    // joinedNets should only include the net where the room resolved
    expect(roster[0].joinedNets.has("!missing:example.com")).toBe(false);
  });
});
