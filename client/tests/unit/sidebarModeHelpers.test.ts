import { describe, it, expect } from "vitest";
import {
  sortOperationsForSelector,
  operationStateBadge,
  abbreviateOpName,
} from "@/renderer/components/sidebarModeHelpers";
import { OperationState } from "@/renderer/matrix/operationTypes";
import type { Operation } from "@/renderer/matrix/operationTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(
  id: string,
  name: string,
  state: OperationState,
): Operation {
  return {
    id,
    name,
    description: "",
    state,
    commanderId: "@test:server.com",
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
// sortOperationsForSelector
// ---------------------------------------------------------------------------

describe("sortOperationsForSelector", () => {
  it("returns empty array for empty input", () => {
    expect(sortOperationsForSelector([])).toEqual([]);
  });

  it("active comes before planning", () => {
    const ops = [
      makeOp("p1", "Alpha", OperationState.PLANNING),
      makeOp("a1", "Bravo", OperationState.ACTIVE),
    ];
    const sorted = sortOperationsForSelector(ops);
    expect(sorted[0].state).toBe(OperationState.ACTIVE);
    expect(sorted[1].state).toBe(OperationState.PLANNING);
  });

  it("active before planning before completed before archived", () => {
    const ops = [
      makeOp("ar1", "Archived", OperationState.ARCHIVED),
      makeOp("co1", "Completed", OperationState.COMPLETED),
      makeOp("pl1", "Planning", OperationState.PLANNING),
      makeOp("ac1", "Active", OperationState.ACTIVE),
    ];
    const sorted = sortOperationsForSelector(ops);
    const states = sorted.map((o) => o.state);
    expect(states).toEqual([
      OperationState.ACTIVE,
      OperationState.PLANNING,
      OperationState.COMPLETED,
      OperationState.ARCHIVED,
    ]);
  });

  it("sorts alphabetically within the same state group", () => {
    const ops = [
      makeOp("a3", "Zulu Op", OperationState.ACTIVE),
      makeOp("a1", "Alpha Op", OperationState.ACTIVE),
      makeOp("a2", "Bravo Op", OperationState.ACTIVE),
    ];
    const sorted = sortOperationsForSelector(ops);
    expect(sorted.map((o) => o.name)).toEqual(["Alpha Op", "Bravo Op", "Zulu Op"]);
  });

  it("sorts alphabetically across multiple groups", () => {
    const ops = [
      makeOp("p2", "Zulu Plan", OperationState.PLANNING),
      makeOp("a2", "Zulu Active", OperationState.ACTIVE),
      makeOp("p1", "Alpha Plan", OperationState.PLANNING),
      makeOp("a1", "Alpha Active", OperationState.ACTIVE),
    ];
    const sorted = sortOperationsForSelector(ops);
    expect(sorted.map((o) => o.name)).toEqual([
      "Alpha Active",
      "Zulu Active",
      "Alpha Plan",
      "Zulu Plan",
    ]);
  });

  it("returns a NEW array (immutable — does not mutate input)", () => {
    const ops = [
      makeOp("a1", "Active", OperationState.ACTIVE),
      makeOp("p1", "Planning", OperationState.PLANNING),
    ];
    const copy = [...ops];
    const sorted = sortOperationsForSelector(ops);
    // same-length, not same reference
    expect(sorted).not.toBe(ops);
    // original preserved
    expect(ops[0]).toBe(copy[0]);
    expect(ops[1]).toBe(copy[1]);
  });

  it("does not mutate a frozen input array", () => {
    const ops = freeze([
      makeOp("ar1", "Archived Op", OperationState.ARCHIVED),
      makeOp("ac1", "Active Op", OperationState.ACTIVE),
    ]);
    expect(() => sortOperationsForSelector(ops)).not.toThrow();
    const sorted = sortOperationsForSelector(ops);
    expect(sorted[0].state).toBe(OperationState.ACTIVE);
  });

  it("single item returns single-item array with same operation", () => {
    const op = makeOp("x1", "Lone Ranger", OperationState.COMPLETED);
    const sorted = sortOperationsForSelector([op]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]).toBe(op);
  });

  it("operations with the same name within same group preserve original relative order", () => {
    // When names are equal, localeCompare returns 0 and sort is stable
    const ops = [
      makeOp("a1", "Twin", OperationState.ACTIVE),
      makeOp("a2", "Twin", OperationState.ACTIVE),
    ];
    const sorted = sortOperationsForSelector(ops);
    // Both present, original relative order preserved
    expect(sorted[0].id).toBe("a1");
    expect(sorted[1].id).toBe("a2");
  });
});

// ---------------------------------------------------------------------------
// operationStateBadge
// ---------------------------------------------------------------------------

describe("operationStateBadge", () => {
  it("returns label PLANNING in uppercase for planning state", () => {
    const badge = operationStateBadge(OperationState.PLANNING);
    expect(badge.label).toBe("PLANNING");
  });

  it("returns amber colorClass for planning state", () => {
    const badge = operationStateBadge(OperationState.PLANNING);
    expect(badge.colorClass).toContain("amber");
  });

  it("returns label ACTIVE in uppercase for active state", () => {
    const badge = operationStateBadge(OperationState.ACTIVE);
    expect(badge.label).toBe("ACTIVE");
  });

  it("returns green colorClass for active state", () => {
    const badge = operationStateBadge(OperationState.ACTIVE);
    expect(badge.colorClass).toContain("green");
  });

  it("returns label COMPLETED in uppercase for completed state", () => {
    const badge = operationStateBadge(OperationState.COMPLETED);
    expect(badge.label).toBe("COMPLETED");
  });

  it("returns blue colorClass for completed state", () => {
    const badge = operationStateBadge(OperationState.COMPLETED);
    expect(badge.colorClass).toContain("blue");
  });

  it("returns label ARCHIVED in uppercase for archived state", () => {
    const badge = operationStateBadge(OperationState.ARCHIVED);
    expect(badge.label).toBe("ARCHIVED");
  });

  it("returns gray colorClass for archived state", () => {
    const badge = operationStateBadge(OperationState.ARCHIVED);
    expect(badge.colorClass).toContain("gray");
  });

  it("returns an object with both label and colorClass keys", () => {
    const badge = operationStateBadge(OperationState.ACTIVE);
    expect(badge).toHaveProperty("label");
    expect(badge).toHaveProperty("colorClass");
  });
});

// ---------------------------------------------------------------------------
// abbreviateOpName
// ---------------------------------------------------------------------------

describe("abbreviateOpName", () => {
  it("returns uppercase name when it fits within default maxLen of 6", () => {
    expect(abbreviateOpName("Alpha")).toBe("ALPHA");
  });

  it("returns name as-is (uppercase) when length equals maxLen exactly", () => {
    // "SIXLET" = 6 characters
    expect(abbreviateOpName("SIXLET")).toBe("SIXLET");
  });

  it("truncates to first 6 chars (uppercase) when name exceeds default maxLen", () => {
    expect(abbreviateOpName("Operation Bravo")).toBe("OPERAT");
  });

  it("returns uppercase truncation for long names with custom maxLen", () => {
    expect(abbreviateOpName("Operation Bravo", 3)).toBe("OPE");
  });

  it("returns full uppercase name when maxLen is larger than name length", () => {
    expect(abbreviateOpName("Hi", 10)).toBe("HI");
  });

  it("handles empty string without throwing", () => {
    expect(abbreviateOpName("")).toBe("");
  });

  it("custom maxLen of 1 returns first character uppercase", () => {
    expect(abbreviateOpName("alpha", 1)).toBe("A");
  });

  it("custom maxLen of 0 returns empty string", () => {
    expect(abbreviateOpName("alpha", 0)).toBe("");
  });

  it("lowercased input is uppercased in output", () => {
    expect(abbreviateOpName("bravo")).toBe("BRAVO");
  });

  it("mixed-case input is fully uppercased", () => {
    expect(abbreviateOpName("OpBrAvO", 7)).toBe("OPBRAVO");
  });

  it("name longer than default maxLen=6 is truncated", () => {
    const result = abbreviateOpName("Foxtrot");
    // "Foxtrot" is 7 chars > 6, so truncated to "FOXTRO"
    expect(result).toBe("FOXTRO");
  });
});
