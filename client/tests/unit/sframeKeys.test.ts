import { describe, it, expect } from "vitest";
import { generateSframeKey } from "@/renderer/voice/sframeKeys";

describe("generateSframeKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const k = generateSframeKey();
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });
  it("produces distinct keys on each call (statistical: 4 calls should be unique)", () => {
    const ks = new Set(Array.from({ length: 4 }, () => Array.from(generateSframeKey()).join(",")));
    expect(ks.size).toBe(4);
  });
});
