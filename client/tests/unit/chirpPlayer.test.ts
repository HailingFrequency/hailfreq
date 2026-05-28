import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock window.hailfreq IPC bridge (renderer environment)
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();

vi.stubGlobal("window", {
  hailfreq: {
    invoke: mockInvoke,
  },
});

// Mock Web Audio API — AudioContext is not available in Node
class MockAudioBuffer {}

class MockAudioContext {
  decodeAudioData = vi.fn((_ab: ArrayBuffer) => Promise.resolve(new MockAudioBuffer() as AudioBuffer));
}

vi.stubGlobal("AudioContext", MockAudioContext);

import { loadChirp, clearChirpCache } from "@/renderer/voice/chirpPlayer";

describe("chirpPlayer — loadChirp", () => {
  beforeEach(() => {
    // Reset the module-level decoded cache between tests
    clearChirpCache();
    vi.clearAllMocks();
  });

  it("invokes chirps:read via IPC and decodes the audio data", async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    mockInvoke.mockResolvedValueOnce(fakeBytes);

    const ctx = new MockAudioContext() as unknown as AudioContext;
    const result = await loadChirp(ctx, "builtin:click");

    // IPC was called with the correct channel and id
    expect(mockInvoke).toHaveBeenCalledWith("chirps:read", { id: "builtin:click" });
    // decodeAudioData was called (returns a MockAudioBuffer)
    expect(ctx.decodeAudioData).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(MockAudioBuffer);
  });

  it("returns the cached AudioBuffer on second load (no extra IPC call)", async () => {
    const fakeBytes = new Uint8Array([5, 6, 7, 8]);
    mockInvoke.mockResolvedValueOnce(fakeBytes);

    const ctx = new MockAudioContext() as unknown as AudioContext;

    // First load — triggers IPC
    const first = await loadChirp(ctx, "builtin:click");
    expect(mockInvoke).toHaveBeenCalledOnce();

    // Second load — should return cache hit, no more IPC calls
    const second = await loadChirp(ctx, "builtin:click");
    expect(mockInvoke).toHaveBeenCalledOnce(); // still only once
    expect(second).toBe(first); // exact same object reference from cache
  });
});
