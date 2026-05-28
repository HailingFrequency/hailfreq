import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// We mock electron-store with a factory that returns a real conf-backed store
// pointing at a temp directory. This lets us exercise the actual migration wiring
// in store.ts without needing a live Electron process.
vi.mock("electron-store", async () => {
  const { default: Conf } = await import("conf");
  return {
    default: vi.fn(function (options: Record<string, unknown> = {}) {
      // Use HAILFREQ_TEST_USERDATA if set so each test gets its own dir
      const cwd = (process.env.HAILFREQ_TEST_USERDATA as string) || os.tmpdir();
      const configName = typeof options.name === "string" ? options.name : "config";
      const inst = new Conf({ cwd, configName, ...(options.defaults ? { defaults: options.defaults } : {}) });
      return inst;
    }),
  };
});

describe("settings store — legacy migration on construction", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "hailfreq-store-test-"));
    process.env.HAILFREQ_TEST_USERDATA = testDir;
    vi.resetModules(); // critical: store.ts is a module-level singleton
  });

  it("migrates a legacy single-server store on first import", async () => {
    // Pre-seed a legacy settings.json before importing the store module
    fs.writeFileSync(
      path.join(testDir, "settings.json"),
      JSON.stringify({
        serverUrl: "https://radio.example.com",
        userId: "@alice:example.com",
        lastLoginMethod: "local",
        ui: { theme: "dark" },
      })
    );

    // Importing the store module triggers the eager migration block
    const { settings } = await import("@/main/store");
    const storeState = settings.store as { servers: Array<{ serverUrl: string; userId: string; id: string }>; activeServerId: string };
    expect(storeState.servers).toHaveLength(1);
    expect(storeState.servers[0].serverUrl).toBe("https://radio.example.com");
    expect(storeState.servers[0].userId).toBe("@alice:example.com");
    expect(storeState.activeServerId).toBe(storeState.servers[0].id);
  });

  it("leaves a fresh store unchanged", async () => {
    const { settings } = await import("@/main/store");
    const storeState = settings.store as { servers: unknown[]; activeServerId: string };
    expect(storeState.servers).toEqual([]);
    expect(storeState.activeServerId).toBe("");
  });
});
