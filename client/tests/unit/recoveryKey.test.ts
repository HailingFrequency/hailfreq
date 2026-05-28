import { describe, it, expect } from "vitest";
import { encodeRecoveryKey, decodeRecoveryKey } from "@/renderer/matrix/recoveryKey";

describe("recoveryKey", () => {
  it("round-trips raw → formatted → raw", () => {
    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) raw[i] = i;
    const formatted = encodeRecoveryKey(raw);
    expect(formatted).toMatch(/^[A-Za-z0-9]+( [A-Za-z0-9]+)+$/);
    const back = decodeRecoveryKey(formatted!);
    expect(Array.from(back)).toEqual(Array.from(raw));
  });
});
