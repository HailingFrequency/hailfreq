import { describe, it, expect } from "vitest";
import { ChannelType, type Channel, type TextChannel, type VoiceChannel } from "@/renderer/matrix/channelTypes";
import { OperationState, type Operation, type RosterEntry, type Roster } from "@/renderer/matrix/operationTypes";
import { type HierarchyNode, type LoungeSidebarState, type OperationSidebarState } from "@/renderer/matrix/hierarchyTypes";

describe("channelTypes", () => {
  it("ChannelType.TEXT enum value equals 'text'", () => {
    expect(ChannelType.TEXT).toBe("text");
  });

  it("ChannelType.VOICE enum value equals 'voice'", () => {
    expect(ChannelType.VOICE).toBe("voice");
  });

  it("TextChannel type-checks with correct ChannelType", () => {
    const textChannel: TextChannel = {
      id: "!room1:server.com",
      name: "General",
      type: ChannelType.TEXT,
      netId: "!net1:server.com",
      topic: "General discussion",
      encrypted: true,
    };
    expect(textChannel.type).toBe(ChannelType.TEXT);
  });

  it("VoiceChannel type-checks with connected members", () => {
    const voiceChannel: VoiceChannel = {
      id: "!voice1:server.com",
      name: "Ops",
      type: ChannelType.VOICE,
      netId: "!net1:server.com",
      encrypted: true,
      connectedMembers: ["@user1:server.com", "@user2:server.com"],
    };
    expect(voiceChannel.type).toBe(ChannelType.VOICE);
    expect(voiceChannel.connectedMembers).toHaveLength(2);
  });
});

describe("operationTypes", () => {
  it("OperationState.ACTIVE enum value equals 'active'", () => {
    expect(OperationState.ACTIVE).toBe("active");
  });

  it("Operation type-checks correctly", () => {
    const operation: Operation = {
      id: "!op1:server.com",
      name: "Operation Neptune",
      description: "Deep sea salvage mission",
      state: OperationState.ACTIVE,
      commanderId: "@commander:server.com",
      scheduledStart: "2026-06-15T12:00:00Z",
      actualStart: "2026-06-15T12:05:00Z",
    };
    expect(operation.state).toBe(OperationState.ACTIVE);
  });

  it("RosterEntry type-checks with all required fields", () => {
    const entry: RosterEntry = {
      userId: "@user1:server.com",
      userName: "Alice",
      strikeGroupId: "!sg1:server.com",
      shipId: "!ship1:server.com",
      circuitId: "!circuit1:server.com",
      role: "Helm Operator",
      status: "assigned",
    };
    expect(entry.status).toBe("assigned");
  });

  it("Roster type-checks with entries array", () => {
    const roster: Roster = {
      operationId: "!op1:server.com",
      entries: [
        {
          userId: "@user1:server.com",
          userName: "Alice",
          strikeGroupId: "!sg1:server.com",
          shipId: "!ship1:server.com",
          circuitId: "!circuit1:server.com",
          role: "Captain",
          status: "joined",
        },
      ],
    };
    expect(roster.entries).toHaveLength(1);
  });
});

describe("hierarchyTypes", () => {
  it("HierarchyNode tree type-checks with nested children", () => {
    const hierarchy: HierarchyNode = {
      id: "!net1:server.com",
      name: "Fleet",
      type: "net",
      priority: 10,
      isBroadcast: true,
      children: [
        {
          id: "!sg1:server.com",
          name: "Strike Group 1",
          type: "strike-group",
          children: [
            {
              id: "!ship1:server.com",
              name: "Capital Ship",
              type: "ship",
              children: [
                {
                  id: "!circuit1:server.com",
                  name: "Bridge",
                  type: "circuit",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(hierarchy.name).toBe("Fleet");
    expect(hierarchy.children[0].name).toBe("Strike Group 1");
    expect(hierarchy.children[0].children[0].children[0].name).toBe("Bridge");
  });

  it("LoungeSidebarState type-checks correctly", () => {
    const state: LoungeSidebarState = {
      ships: [
        {
          id: "!ship1:server.com",
          name: "My Ship",
          type: "ship",
          children: [],
        },
      ],
      yourNets: [
        {
          id: "!net1:server.com",
          name: "Primary Net",
          type: "net",
          priority: 1,
          children: [],
        },
      ],
      availableToJoin: [],
    };
    expect(state.ships).toHaveLength(1);
    expect(state.yourNets).toHaveLength(1);
  });

  it("OperationSidebarState type-checks correctly", () => {
    const state: OperationSidebarState = {
      broadcastNets: [
        {
          id: "!broadcast1:server.com",
          name: "1MC",
          type: "net",
          isBroadcast: true,
          children: [],
        },
      ],
      admiralsNet: {
        id: "!admirals:server.com",
        name: "Admiral's Net",
        type: "net",
        children: [],
      },
      strikeGroups: [],
    };
    expect(state.broadcastNets).toHaveLength(1);
    expect(state.admiralsNet?.name).toBe("Admiral's Net");
  });
});
