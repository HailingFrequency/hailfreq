import { describe, it, expect } from "vitest";
import {
  isSelectableNode,
  nodeIcon,
  toggleExpanded,
} from "@/renderer/components/channelListHelpers";
import type { HierarchyNode } from "@/renderer/matrix/hierarchyTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: HierarchyNode["type"],
  opts: Partial<Pick<HierarchyNode, "name" | "priority" | "isBroadcast" | "children">> = {},
): HierarchyNode {
  return {
    id,
    name: opts.name ?? id,
    type,
    children: opts.children ?? [],
    priority: opts.priority,
    isBroadcast: opts.isBroadcast,
  };
}

// ---------------------------------------------------------------------------
// isSelectableNode
// ---------------------------------------------------------------------------

describe("isSelectableNode", () => {
  it("returns true for text nodes", () => {
    expect(isSelectableNode(makeNode("t1", "text"))).toBe(true);
  });

  it("returns true for voice nodes", () => {
    expect(isSelectableNode(makeNode("v1", "voice"))).toBe(true);
  });

  it("returns true for circuit nodes", () => {
    expect(isSelectableNode(makeNode("c1", "circuit"))).toBe(true);
  });

  it("returns false for net nodes (structural)", () => {
    expect(isSelectableNode(makeNode("n1", "net"))).toBe(false);
  });

  it("returns false for ship nodes (structural)", () => {
    expect(isSelectableNode(makeNode("s1", "ship"))).toBe(false);
  });

  it("returns false for strike-group nodes (structural)", () => {
    expect(isSelectableNode(makeNode("sg1", "strike-group"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nodeIcon
// ---------------------------------------------------------------------------

describe("nodeIcon", () => {
  it("returns '#' for text channel nodes", () => {
    expect(nodeIcon(makeNode("t1", "text"))).toBe("#");
  });

  it("returns '🎤' for voice channel nodes", () => {
    expect(nodeIcon(makeNode("v1", "voice"))).toBe("🎤");
  });

  it("returns '🚢' for ship nodes", () => {
    expect(nodeIcon(makeNode("s1", "ship"))).toBe("🚢");
  });

  it("returns '' for net nodes (no broadcast)", () => {
    expect(nodeIcon(makeNode("n1", "net"))).toBe("");
  });

  it("returns '' for strike-group nodes (no broadcast)", () => {
    expect(nodeIcon(makeNode("sg1", "strike-group"))).toBe("");
  });

  it("returns '' for circuit nodes (no broadcast)", () => {
    expect(nodeIcon(makeNode("c1", "circuit"))).toBe("");
  });

  it("broadcast takes precedence — returns '📢' for broadcast net node", () => {
    expect(nodeIcon(makeNode("n1", "net", { isBroadcast: true }))).toBe("📢");
  });

  it("broadcast takes precedence — returns '📢' for broadcast text node", () => {
    // Edge case: even if type is text, isBroadcast wins
    expect(nodeIcon(makeNode("t1", "text", { isBroadcast: true }))).toBe("📢");
  });

  it("broadcast takes precedence — returns '📢' for broadcast voice node", () => {
    expect(nodeIcon(makeNode("v1", "voice", { isBroadcast: true }))).toBe("📢");
  });

  it("isBroadcast=false does not trigger broadcast icon", () => {
    expect(nodeIcon(makeNode("n1", "net", { isBroadcast: false }))).toBe("");
  });

  it("isBroadcast=undefined does not trigger broadcast icon", () => {
    const node: HierarchyNode = { id: "n1", name: "Net", type: "net", children: [] };
    expect(nodeIcon(node)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// toggleExpanded
// ---------------------------------------------------------------------------

describe("toggleExpanded", () => {
  it("adds the id when it is not in the set", () => {
    const before = new Set(["a", "b"]);
    const after = toggleExpanded(before, "c");
    expect(after.has("c")).toBe(true);
    expect(after.has("a")).toBe(true);
    expect(after.has("b")).toBe(true);
  });

  it("removes the id when it is already in the set", () => {
    const before = new Set(["a", "b", "c"]);
    const after = toggleExpanded(before, "b");
    expect(after.has("b")).toBe(false);
    expect(after.has("a")).toBe(true);
    expect(after.has("c")).toBe(true);
  });

  it("returns a NEW Set instance (immutability)", () => {
    const before = new Set(["a"]);
    const after = toggleExpanded(before, "b");
    expect(after).not.toBe(before);
  });

  it("does not mutate the original set when adding", () => {
    const before = new Set(["a"]);
    toggleExpanded(before, "b");
    expect(before.has("b")).toBe(false);
    expect(before.size).toBe(1);
  });

  it("does not mutate the original set when removing", () => {
    const before = new Set(["a", "b"]);
    toggleExpanded(before, "a");
    expect(before.has("a")).toBe(true);
    expect(before.size).toBe(2);
  });

  it("works on an empty set (adds the id)", () => {
    const before = new Set<string>();
    const after = toggleExpanded(before, "x");
    expect(after.size).toBe(1);
    expect(after.has("x")).toBe(true);
  });

  it("accepts ReadonlySet as input", () => {
    const before: ReadonlySet<string> = new Set(["a"]);
    const after = toggleExpanded(before, "a");
    expect(after.has("a")).toBe(false);
  });
});
