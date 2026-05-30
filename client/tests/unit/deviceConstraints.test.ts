import { describe, it, expect } from "vitest";
import { micConstraints } from "@/renderer/audio/deviceConstraints";

describe("micConstraints", () => {
  const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 48000 };
  it("uses default audio when no device id", () => {
    expect(micConstraints(undefined)).toEqual({ audio: base });
  });
  it("adds an exact deviceId when provided", () => {
    expect(micConstraints("mic-1")).toEqual({ audio: { ...base, deviceId: { exact: "mic-1" } } });
  });
  it("ignores an empty string device id", () => {
    expect(micConstraints("")).toEqual({ audio: base });
  });
});
