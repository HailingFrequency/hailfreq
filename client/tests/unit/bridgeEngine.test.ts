import { describe, it, expect, beforeEach, vi } from "vitest";
import { BridgeEngine } from "@/renderer/bridge/BridgeEngine";
import type { BridgeConfig } from "@shared/types";

const baseConfig: BridgeConfig = {
  id: "b1",
  name: "Test Bridge",
  source: { serverId: "srvA", matrixRoomId: "!a:hf.example" },
  target: { serverId: "srvB", matrixRoomId: "!b:hf.example" },
  mode: "always-on",
  smartThreshold: 0.02,
  enabled: true,
  bidirectional: false,
  createdMs: 1,
};

function makeContext() {
  return {
    getRoom: vi.fn().mockReturnValue(null), // always returns null — runners go to "error"
    playBridgeChirp: vi.fn(),
  };
}

describe("BridgeEngine", () => {
  let ctx: ReturnType<typeof makeContext>;
  let engine: BridgeEngine;

  beforeEach(() => {
    ctx = makeContext();
    engine = new BridgeEngine(ctx);
  });

  it("setConfigs is a no-op when called with empty array", async () => {
    await engine.setConfigs([]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs starts a forward runner for an enabled bridge", async () => {
    await engine.setConfigs([baseConfig]);
    const sums = engine.getActiveSummaries();
    expect(sums).toHaveLength(1);
    expect(sums[0].bridgeId).toBe("b1");
    expect(sums[0].direction).toBe("forward");
    expect(sums[0].status).toBe("error"); // getRoom returns null
  });

  it("setConfigs starts both forward AND reverse runners for bidirectional bridge", async () => {
    await engine.setConfigs([{ ...baseConfig, bidirectional: true }]);
    expect(engine.getActiveSummaries()).toHaveLength(2);
  });

  it("setConfigs does NOT start a disabled bridge", async () => {
    await engine.setConfigs([{ ...baseConfig, enabled: false }]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs stops a previously-active bridge when removed", async () => {
    await engine.setConfigs([baseConfig]);
    expect(engine.getActiveSummaries()).toHaveLength(1);
    await engine.setConfigs([]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("setConfigs disables a bridge when enabled flips false", async () => {
    await engine.setConfigs([baseConfig]);
    await engine.setConfigs([{ ...baseConfig, enabled: false }]);
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });

  it("shutdown clears all active bridges", async () => {
    await engine.setConfigs([baseConfig]);
    await engine.shutdown();
    expect(engine.getActiveSummaries()).toHaveLength(0);
  });
});
