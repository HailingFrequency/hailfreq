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
        scIntegration: { enabled: false, autoInviteAllowlist: [], autoCloseOnDestruction: true },
      }],
      activeServerId: "abc",
      ui: { theme: "dark" },
      focusedAppPtt: { enabled: false, allowlistEntries: ["StarCitizen"] },
      bridges: [],
    };
    const migrated = migrateLegacyShape(current);
    expect(migrated).toEqual(current);
  });

  it("defaults scIntegration on legacy v2 entries that lack it", () => {
    const legacyV2: Settings = {
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
    const migrated = migrateLegacyShape(legacyV2);
    expect(migrated.servers[0].scIntegration).toEqual({
      enabled: false,
      autoInviteAllowlist: [],
      autoCloseOnDestruction: true,
    });
  });

  it("defaults focusedAppPtt when missing from legacy v2 store", () => {
    const legacyV2: Settings = {
      servers: [],
      activeServerId: "",
      ui: { theme: "dark" },
    };
    const migrated = migrateLegacyShape(legacyV2);
    expect(migrated.focusedAppPtt).toEqual({
      enabled: false,
      allowlistEntries: ["StarCitizen"],
    });
  });

  it("preserves an existing focusedAppPtt through pass-through migration", () => {
    const existing: Settings = {
      servers: [],
      activeServerId: "",
      ui: { theme: "dark" },
      focusedAppPtt: { enabled: true, allowlistEntries: ["StarCitizen", "ElementX"] },
    };
    const migrated = migrateLegacyShape(existing);
    expect(migrated.focusedAppPtt).toEqual(existing.focusedAppPtt);
  });

  it("handles a totally fresh store (defaults)", () => {
    const empty = {};
    const migrated = migrateLegacyShape(empty);
    expect(migrated.servers).toEqual([]);
    expect(migrated.activeServerId).toBe("");
    expect(migrated.ui.theme).toBe("dark");
  });
});

describe("audio device persistence", () => {
  it("passes through inputDeviceId/outputDeviceId on the multi-server shape", () => {
    const out = migrateLegacyShape({
      servers: [],
      activeServerId: "",
      inputDeviceId: "mic-1",
      outputDeviceId: "spk-1",
    });
    expect(out.inputDeviceId).toBe("mic-1");
    expect(out.outputDeviceId).toBe("spk-1");
  });
  it("leaves them undefined when absent", () => {
    const out = migrateLegacyShape({ servers: [], activeServerId: "" });
    expect(out.inputDeviceId).toBeUndefined();
    expect(out.outputDeviceId).toBeUndefined();
  });
});
