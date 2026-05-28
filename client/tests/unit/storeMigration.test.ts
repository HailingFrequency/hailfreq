import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@shared/types";

// Mock electron-store to prevent it from trying to access Electron context in tests
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

// electron-store is hard to test in a Node environment — for unit testing we
// extract the pure migration function from store.ts. Refactor store.ts to
// export `migrateLegacyShape(rawStore: unknown): Settings` and have the
// `beforeEachMigration` callback call it.

import { migrateLegacyShape } from "@/main/store";

describe("migrateLegacyShape", () => {
  it("converts a legacy single-server store to multi-server", () => {
    const legacy = {
      serverUrl: "https://radio.example.com",
      userId: "@alice:example.com",
      lastLoginMethod: "local",
      ui: { theme: "dark" },
    };
    const migrated = migrateLegacyShape(legacy);
    expect(migrated.servers).toHaveLength(1);
    expect(migrated.servers[0].serverUrl).toBe("https://radio.example.com");
    expect(migrated.servers[0].userId).toBe("@alice:example.com");
    expect(migrated.servers[0].lastLoginMethod).toBe("local");
    expect(migrated.servers[0].label).toBe("Example");
    expect(migrated.activeServerId).toBe(migrated.servers[0].id);
    expect(migrated.ui.theme).toBe("dark");
  });

  it("leaves an already-migrated store alone", () => {
    const current: Settings = {
      servers: [{
        id: "abc",
        label: "Test",
        serverUrl: "https://x.com",
        userId: "@u:x",
        lastLoginMethod: "citizenid",
        lastSyncedMs: 0,
      }],
      activeServerId: "abc",
      ui: { theme: "dark" },
    };
    const migrated = migrateLegacyShape(current);
    expect(migrated).toEqual(current);
  });

  it("handles a totally fresh store (defaults)", () => {
    const empty = {};
    const migrated = migrateLegacyShape(empty);
    expect(migrated.servers).toEqual([]);
    expect(migrated.activeServerId).toBe("");
    expect(migrated.ui.theme).toBe("dark");
  });
});
