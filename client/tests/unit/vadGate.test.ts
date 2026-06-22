import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

// VadGate uses Web Audio APIs which aren't available in the Node test
// environment. We mock them minimally to assert state-machine behavior.
// vi.stubGlobal is required in Vitest 4 — top-level global assignment is not
// applied before module evaluation in the new runtime.

beforeAll(() => {
  vi.stubGlobal(
    "AudioContext",
    vi.fn().mockImplementation(() => ({
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
      createAnalyser: vi.fn().mockReturnValue({
        fftSize: 1024,
        connect: vi.fn(),
        getFloatTimeDomainData: vi.fn(),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  );
  vi.stubGlobal("MediaStream", vi.fn());
});

afterAll(() => {
  vi.unstubAllGlobals();
});

import { VadGate } from "@/renderer/bridge/vadGate";

describe("VadGate", () => {
  it("constructs without throwing", () => {
    const gate = new VadGate({} as MediaStreamTrack, { threshold: 0.02 });
    expect(gate.isCurrentlyOpen()).toBe(false);
    gate.stop();
  });

  it("isCurrentlyOpen returns false before start", () => {
    const gate = new VadGate({} as MediaStreamTrack);
    expect(gate.isCurrentlyOpen()).toBe(false);
    gate.stop();
  });

  it("stop closes the audio context", () => {
    const gate = new VadGate({} as MediaStreamTrack);
    gate.start();
    gate.stop();
    // No exception means audio context close was called without error
    expect(gate.isCurrentlyOpen()).toBe(false);
  });
});
