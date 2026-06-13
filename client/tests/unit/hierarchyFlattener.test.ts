import { describe, it, expect } from "vitest";
import {
  flattenForLounge,
  flattenForOperations,
} from "@/renderer/matrix/hierarchyFlattener";
import type { HierarchyNode } from "@/renderer/matrix/hierarchyTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  name: string,
  type: HierarchyNode["type"],
  opts: Partial<Pick<HierarchyNode, "priority" | "isBroadcast" | "children">> = {},
): HierarchyNode {
  return {
    id,
    name,
    type,
    children: opts.children ?? [],
    priority: opts.priority,
    isBroadcast: opts.isBroadcast,
  };
}

// Produce a deep-frozen copy so mutation is detectable at runtime.
function freeze<T>(value: T): T {
  if (Array.isArray(value)) {
    (value as unknown[]).forEach(freeze);
    return Object.freeze(value) as T;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as object).forEach(freeze);
    return Object.freeze(value) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// flattenForLounge
// ---------------------------------------------------------------------------

describe("flattenForLounge", () => {
  it("returns empty sections for empty input", () => {
    const result = flattenForLounge([]);
    expect(result.ships).toEqual([]);
    expect(result.yourNets).toEqual([]);
    expect(result.availableToJoin).toEqual([]);
  });

  it("collects ship nodes sorted alphabetically", () => {
    const nodes: HierarchyNode[] = [
      makeNode("s2", "Zephyr", "ship"),
      makeNode("s1", "Alpha", "ship"),
      makeNode("s3", "Bravo", "ship"),
    ];
    const { ships } = flattenForLounge(nodes);
    expect(ships.map((s) => s.name)).toEqual(["Alpha", "Bravo", "Zephyr"]);
  });

  it("collects non-broadcast net nodes sorted by priority descending", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Low", "net", { priority: 1 }),
      makeNode("n2", "High", "net", { priority: 10 }),
      makeNode("n3", "Mid", "net", { priority: 5 }),
    ];
    const { yourNets } = flattenForLounge(nodes);
    expect(yourNets.map((n) => n.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("treats missing priority as 0 for sort purposes", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "NoPriority", "net"),
      makeNode("n2", "HasPriority", "net", { priority: 3 }),
    ];
    const { yourNets } = flattenForLounge(nodes);
    expect(yourNets[0].name).toBe("HasPriority");
    expect(yourNets[1].name).toBe("NoPriority");
  });

  it("moves the monitored net to the front after priority sort", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Alpha", "net", { priority: 10 }),
      makeNode("n2", "Bravo", "net", { priority: 5 }),
      makeNode("n3", "Charlie", "net", { priority: 1 }),
    ];
    const { yourNets } = flattenForLounge(nodes, "n3");
    expect(yourNets[0].id).toBe("n3");
    expect(yourNets.map((n) => n.id)).toEqual(["n3", "n1", "n2"]);
  });

  it("leaves order unchanged when monitoredNetId is not found", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Alpha", "net", { priority: 10 }),
      makeNode("n2", "Bravo", "net", { priority: 5 }),
    ];
    const { yourNets } = flattenForLounge(nodes, "nonexistent");
    expect(yourNets.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("leaves order unchanged when monitored net is already first", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Alpha", "net", { priority: 10 }),
      makeNode("n2", "Bravo", "net", { priority: 5 }),
    ];
    const { yourNets } = flattenForLounge(nodes, "n1");
    expect(yourNets.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("excludes broadcast nets from yourNets", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "BroadcastNet", "net", { isBroadcast: true }),
      makeNode("n2", "RegularNet", "net", { priority: 1 }),
    ];
    const { yourNets } = flattenForLounge(nodes);
    expect(yourNets).toHaveLength(1);
    expect(yourNets[0].id).toBe("n2");
  });

  it("excludes non-net, non-ship node types from all lounge sections", () => {
    const nodes: HierarchyNode[] = [
      makeNode("t1", "TextChannel", "text"),
      makeNode("v1", "VoiceChannel", "voice"),
      makeNode("sg1", "StrikeGroup", "strike-group"),
      makeNode("c1", "Circuit", "circuit"),
    ];
    const result = flattenForLounge(nodes);
    expect(result.ships).toEqual([]);
    expect(result.yourNets).toEqual([]);
  });

  it("passes availableNets through as-is", () => {
    const available: HierarchyNode[] = [
      makeNode("a1", "AvailNet", "net"),
      makeNode("a2", "AnotherNet", "net"),
    ];
    const { availableToJoin } = flattenForLounge([], undefined, available);
    expect(availableToJoin).toBe(available); // same reference
  });

  it("defaults availableToJoin to [] when argument is omitted", () => {
    const { availableToJoin } = flattenForLounge([]);
    expect(availableToJoin).toEqual([]);
  });

  it("stable sort — nodes with equal priority keep relative input order", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "First", "net", { priority: 5 }),
      makeNode("n2", "Second", "net", { priority: 5 }),
      makeNode("n3", "Third", "net", { priority: 5 }),
    ];
    const { yourNets } = flattenForLounge(nodes);
    expect(yourNets.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("does not mutate the input array", () => {
    const nodes: HierarchyNode[] = freeze([
      makeNode("n1", "Zed", "ship"),
      makeNode("n2", "Alpha", "ship"),
      makeNode("n3", "MyNet", "net", { priority: 3 }),
    ]);
    // Should not throw even though input is frozen
    expect(() => flattenForLounge(nodes)).not.toThrow();
  });

  it("does not mutate input node objects", () => {
    const original = makeNode("n1", "MyNet", "net", { priority: 5 });
    const snapshot = { ...original };
    flattenForLounge([original], "n1");
    expect(original).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// flattenForOperations
// ---------------------------------------------------------------------------

describe("flattenForOperations", () => {
  it("returns empty sections for empty input", () => {
    const result = flattenForOperations([]);
    expect(result.broadcastNets).toEqual([]);
    expect(result.admiralsNet).toBeUndefined();
    expect(result.strikeGroups).toEqual([]);
  });

  it("collects broadcast nets sorted by priority descending", () => {
    const nodes: HierarchyNode[] = [
      makeNode("b1", "Low Broadcast", "net", { isBroadcast: true, priority: 1 }),
      makeNode("b2", "High Broadcast", "net", { isBroadcast: true, priority: 10 }),
      makeNode("b3", "Mid Broadcast", "net", { isBroadcast: true, priority: 5 }),
    ];
    const { broadcastNets } = flattenForOperations(nodes);
    expect(broadcastNets.map((n) => n.name)).toEqual([
      "High Broadcast",
      "Mid Broadcast",
      "Low Broadcast",
    ]);
  });

  it("picks the first non-broadcast net whose name includes 'admiral' (case-insensitive) as admiralsNet", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Strike Net", "net"),
      makeNode("n2", "Admiral's Net", "net"),
    ];
    const { admiralsNet } = flattenForOperations(nodes);
    expect(admiralsNet?.id).toBe("n2");
  });

  it("admiralsNet is undefined when no net name matches 'admiral'", () => {
    const nodes: HierarchyNode[] = [makeNode("n1", "Fleet Net", "net")];
    const { admiralsNet } = flattenForOperations(nodes);
    expect(admiralsNet).toBeUndefined();
  });

  it("admiralsNet matches case-insensitively (uppercase ADMIRAL)", () => {
    const nodes: HierarchyNode[] = [makeNode("n1", "ADMIRAL COMMAND", "net")];
    const { admiralsNet } = flattenForOperations(nodes);
    expect(admiralsNet?.id).toBe("n1");
  });

  it("when two nets match 'admiral', the first one wins", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Admiral Blue", "net"),
      makeNode("n2", "Admiral Red", "net"),
    ];
    const { admiralsNet } = flattenForOperations(nodes);
    expect(admiralsNet?.id).toBe("n1");
  });

  it("broadcast net of type net is excluded from admiralsNet even if name contains 'admiral'", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Admiral Broadcast", "net", { isBroadcast: true }),
      makeNode("n2", "Admiral Net", "net"),
    ];
    const { admiralsNet, broadcastNets } = flattenForOperations(nodes);
    expect(admiralsNet?.id).toBe("n2");
    expect(broadcastNets).toHaveLength(1);
    expect(broadcastNets[0].id).toBe("n1");
  });

  it("collects strike-group nodes in input order", () => {
    const nodes: HierarchyNode[] = [
      makeNode("sg2", "Bravo Group", "strike-group"),
      makeNode("sg1", "Alpha Group", "strike-group"),
      makeNode("sg3", "Charlie Group", "strike-group"),
    ];
    const { strikeGroups } = flattenForOperations(nodes);
    expect(strikeGroups.map((s) => s.id)).toEqual(["sg2", "sg1", "sg3"]);
  });

  it("ignores non-broadcast net nodes that are not the admirals net", () => {
    const nodes: HierarchyNode[] = [
      makeNode("n1", "Ignored Net", "net"),
      makeNode("n2", "Also Ignored", "net"),
    ];
    // Neither is broadcast, neither matches 'admiral'
    const result = flattenForOperations(nodes);
    expect(result.broadcastNets).toEqual([]);
    expect(result.admiralsNet).toBeUndefined();
    expect(result.strikeGroups).toEqual([]);
  });

  it("ignores ship, text, voice, circuit node types", () => {
    const nodes: HierarchyNode[] = [
      makeNode("s1", "Ship One", "ship"),
      makeNode("t1", "Text Chan", "text"),
      makeNode("v1", "Voice Chan", "voice"),
      makeNode("c1", "Circuit One", "circuit"),
    ];
    const result = flattenForOperations(nodes);
    expect(result.broadcastNets).toEqual([]);
    expect(result.strikeGroups).toEqual([]);
    expect(result.admiralsNet).toBeUndefined();
  });

  it("does not mutate the input array", () => {
    const nodes: HierarchyNode[] = freeze([
      makeNode("b1", "Broadcast", "net", { isBroadcast: true, priority: 5 }),
      makeNode("sg1", "Strike Group A", "strike-group"),
    ]);
    expect(() => flattenForOperations(nodes)).not.toThrow();
  });

  it("broadcast nets missing priority treat priority as 0", () => {
    const nodes: HierarchyNode[] = [
      makeNode("b1", "NoPriority", "net", { isBroadcast: true }),
      makeNode("b2", "HasPriority", "net", { isBroadcast: true, priority: 3 }),
    ];
    const { broadcastNets } = flattenForOperations(nodes);
    expect(broadcastNets[0].name).toBe("HasPriority");
    expect(broadcastNets[1].name).toBe("NoPriority");
  });
});
