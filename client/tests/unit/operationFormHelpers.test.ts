import { describe, it, expect } from "vitest";
import { validateOperationForm, filterInvitableMembers } from "@/renderer/components/operationFormHelpers";

// ---------------------------------------------------------------------------
// validateOperationForm
// ---------------------------------------------------------------------------

describe("validateOperationForm — name validation", () => {
  it("returns ok:false with error when name is empty string", () => {
    const result = validateOperationForm({ name: "", description: "Valid desc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /name/i.test(e))).toBe(true);
    }
  });

  it("returns ok:false with error when name is whitespace only", () => {
    const result = validateOperationForm({ name: "   ", description: "Valid desc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /name/i.test(e))).toBe(true);
    }
  });

  it("returns ok:false with error when name exceeds 64 chars", () => {
    const longName = "A".repeat(65);
    const result = validateOperationForm({ name: longName, description: "Valid desc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /name/i.test(e))).toBe(true);
    }
  });

  it("accepts name of exactly 64 chars (trimmed)", () => {
    const name = "A".repeat(64);
    const result = validateOperationForm({ name, description: "Valid desc" });
    expect(result.ok).toBe(true);
  });

  it("accepts name of 1 char (trimmed)", () => {
    const result = validateOperationForm({ name: "X", description: "Valid desc" });
    expect(result.ok).toBe(true);
  });

  it("trims whitespace before checking name length", () => {
    // " " + 64 chars + " " = 66 total, but trimmed = 64, so ok
    const name = " " + "A".repeat(64) + " ";
    const result = validateOperationForm({ name, description: "Valid desc" });
    expect(result.ok).toBe(true);
  });
});

describe("validateOperationForm — description validation", () => {
  it("returns ok:false with error when description is empty", () => {
    const result = validateOperationForm({ name: "Op Alpha", description: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
    }
  });

  it("returns ok:false with error when description is whitespace only", () => {
    const result = validateOperationForm({ name: "Op Alpha", description: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
    }
  });

  it("returns ok:false with error when description exceeds 500 chars", () => {
    const longDesc = "D".repeat(501);
    const result = validateOperationForm({ name: "Op Alpha", description: longDesc });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
    }
  });

  it("accepts description of exactly 500 chars (trimmed)", () => {
    const desc = "D".repeat(500);
    const result = validateOperationForm({ name: "Op Alpha", description: desc });
    expect(result.ok).toBe(true);
  });
});

describe("validateOperationForm — scheduledStart validation", () => {
  const FIXED_NOW = new Date("2026-06-12T12:00:00.000Z");

  it("returns ok:true when scheduledStart is absent", () => {
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc" },
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when scheduledStart is undefined", () => {
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc", scheduledStart: undefined },
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when scheduledStart is not a valid date string", () => {
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc", scheduledStart: "not-a-date" },
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /date|start/i.test(e))).toBe(true);
    }
  });

  it("returns ok:false when scheduledStart is in the past", () => {
    const past = "2026-01-01T00:00:00";
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc", scheduledStart: past },
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /future|past|date|start/i.test(e))).toBe(true);
    }
  });

  it("returns ok:true when scheduledStart is in the future", () => {
    const future = "2026-12-31T23:59:00";
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc", scheduledStart: future },
      FIXED_NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when scheduledStart equals now exactly (not strictly future)", () => {
    const exactly = FIXED_NOW.toISOString();
    const result = validateOperationForm(
      { name: "Op Alpha", description: "Desc", scheduledStart: exactly },
      FIXED_NOW,
    );
    expect(result.ok).toBe(false);
  });
});

describe("validateOperationForm — multiple errors", () => {
  it("collects multiple field errors at once", () => {
    const result = validateOperationForm({ name: "", description: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("validateOperationForm — valid form", () => {
  it("returns ok:true for valid name and description without scheduledStart", () => {
    const result = validateOperationForm({
      name: "Operation Bravo",
      description: "A valid description",
    });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for valid form with future scheduledStart", () => {
    const now = new Date("2026-06-12T12:00:00.000Z");
    const result = validateOperationForm(
      {
        name: "Operation Charlie",
        description: "Another description",
        scheduledStart: "2027-01-01T08:00:00",
      },
      now,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterInvitableMembers
// ---------------------------------------------------------------------------

const MEMBERS = [
  { userId: "@alice:server.com", displayName: "Alice Smith" },
  { userId: "@bob:server.com", displayName: "Bob Jones" },
  { userId: "@charlie:server.com", displayName: "Charlie Brown" },
  { userId: "@delta:server.com", displayName: "Delta Force" },
];

describe("filterInvitableMembers — filtering by displayName", () => {
  it("returns members whose displayName contains the query (case-insensitive)", () => {
    const results = filterInvitableMembers(MEMBERS, "alice", new Set());
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("@alice:server.com");
  });

  it("matches uppercase query against lowercase displayName", () => {
    const results = filterInvitableMembers(MEMBERS, "BOB", new Set());
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("@bob:server.com");
  });

  it("returns multiple matches when query matches several displayNames", () => {
    // "brown" only matches Charlie Brown
    const results = filterInvitableMembers(MEMBERS, "o", new Set());
    // "o" matches Bob Jones, Charlie Brown, Delta Force
    const ids = results.map((r) => r.userId);
    expect(ids).toContain("@bob:server.com");
    expect(ids).toContain("@charlie:server.com");
  });
});

describe("filterInvitableMembers — filtering by userId", () => {
  it("returns members whose userId contains the query (case-insensitive)", () => {
    const results = filterInvitableMembers(MEMBERS, "@delta", new Set());
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("@delta:server.com");
  });

  it("matches userId substring", () => {
    const results = filterInvitableMembers(MEMBERS, "server.com", new Set());
    expect(results).toHaveLength(MEMBERS.length);
  });
});

describe("filterInvitableMembers — empty and no-match cases", () => {
  it("returns all members when query is empty string", () => {
    const results = filterInvitableMembers(MEMBERS, "", new Set());
    expect(results).toHaveLength(MEMBERS.length);
  });

  it("returns empty array when no members match query", () => {
    const results = filterInvitableMembers(MEMBERS, "zzznomatch", new Set());
    expect(results).toHaveLength(0);
  });
});

describe("filterInvitableMembers — alreadyInvited marking", () => {
  it("marks members in alreadyInvited set with alreadyInvited: true", () => {
    const invited = new Set(["@alice:server.com"]);
    const results = filterInvitableMembers(MEMBERS, "", invited);
    const alice = results.find((r) => r.userId === "@alice:server.com");
    expect(alice).toBeDefined();
    expect(alice!.alreadyInvited).toBe(true);
  });

  it("marks non-invited members with alreadyInvited: false", () => {
    const invited = new Set(["@alice:server.com"]);
    const results = filterInvitableMembers(MEMBERS, "", invited);
    const bob = results.find((r) => r.userId === "@bob:server.com");
    expect(bob).toBeDefined();
    expect(bob!.alreadyInvited).toBe(false);
  });

  it("does NOT remove already-invited members from results", () => {
    const invited = new Set(["@alice:server.com"]);
    const results = filterInvitableMembers(MEMBERS, "", invited);
    expect(results.some((r) => r.userId === "@alice:server.com")).toBe(true);
  });

  it("marks members correctly when both invited and non-invited are in results", () => {
    const invited = new Set(["@alice:server.com", "@charlie:server.com"]);
    const results = filterInvitableMembers(MEMBERS, "smith", invited);
    // Only alice matches "smith"
    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("@alice:server.com");
    expect(results[0].alreadyInvited).toBe(true);
  });
});

describe("filterInvitableMembers — input order preserved", () => {
  it("preserves input order of MEMBERS array", () => {
    const results = filterInvitableMembers(MEMBERS, "", new Set());
    const returnedIds = results.map((r) => r.userId);
    const sourceIds = MEMBERS.map((m) => m.userId);
    expect(returnedIds).toEqual(sourceIds);
  });
});
