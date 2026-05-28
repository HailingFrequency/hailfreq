import { describe, it, expect, vi } from "vitest";
import type { ServerEntry } from "@shared/types";

// Mock electron-store to avoid requiring Electron context in unit tests
vi.mock("electron-store", () => {
  return {
    default: vi.fn(function () {
      return {
        get: vi.fn(),
        set: vi.fn(),
        clear: vi.fn(),
        store: {},
      };
    }),
  };
});

import { reorderServerList } from "@/main/store";

// ---------------------------------------------------------------------------
// Minimal ServerEntry factory — only fields needed by the ordering logic
// ---------------------------------------------------------------------------

function makeEntry(id: string): ServerEntry {
  return {
    id,
    label: `Server ${id}`,
    serverUrl: `https://${id}.example.com`,
    userId: "",
    lastLoginMethod: "",
    lastSyncedMs: 0,
  };
}

describe("reorderServerList", () => {
  it("returns servers in the order specified by orderedIds", () => {
    const a = makeEntry("a");
    const b = makeEntry("b");
    const c = makeEntry("c");
    const servers = [a, b, c];

    const result = reorderServerList(servers, ["c", "a", "b"]);

    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("appends servers not present in orderedIds at the end", () => {
    const a = makeEntry("a");
    const b = makeEntry("b");
    const c = makeEntry("c");
    const servers = [a, b, c];

    // orderedIds only covers "c" and "a" — "b" should be appended
    const result = reorderServerList(servers, ["c", "a"]);

    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});
