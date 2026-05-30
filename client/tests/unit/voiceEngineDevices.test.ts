import { describe, it, expect } from "vitest";
import { audioContextSupportsSinkId } from "@/renderer/voice/VoiceEngine";

describe("audioContextSupportsSinkId", () => {
  it("true when AudioContext.prototype has setSinkId", () => {
    const ctor = { prototype: { setSinkId: () => {} } } as unknown as typeof AudioContext;
    expect(audioContextSupportsSinkId(ctor)).toBe(true);
  });
  it("false when it does not", () => {
    const ctor = { prototype: {} } as unknown as typeof AudioContext;
    expect(audioContextSupportsSinkId(ctor)).toBe(false);
  });
  it("false when ctor is undefined", () => {
    expect(audioContextSupportsSinkId(undefined)).toBe(false);
  });
});
