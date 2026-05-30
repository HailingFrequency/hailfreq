import { describe, it, expect } from "vitest";
import { listSframeKeys, fetchSframeKey } from "@/renderer/voice/sframeKeys";

const SFRAME_KEY_EVENT = "org.hailfreq.net.sframe-key";

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}

interface MockEventOpts {
  type?: string;
  sender: string;
  keyBytes?: number[];
  decryptFail?: boolean;
  id?: string;
  ts?: number;
}

function mockEvent(o: MockEventOpts) {
  return {
    getType: () => o.type ?? SFRAME_KEY_EVENT,
    getSender: () => o.sender,
    getContent: () => (o.keyBytes ? { key: b64(o.keyBytes), algorithm: "SFrame-AES-256" } : {}),
    isBeingDecrypted: () => false,
    isDecryptionFailure: () => o.decryptFail ?? false,
    getId: () => o.id ?? "evt",
    getTs: () => o.ts ?? 0,
  };
}

// members: userId -> powerLevel
function mockClient(events: ReturnType<typeof mockEvent>[], members: Record<string, number>) {
  const room = {
    getLiveTimeline: () => ({ getEvents: () => events }),
    getMember: (uid: string) => (uid in members ? { powerLevel: members[uid] } : null),
  };
  return { getRoom: () => room } as any;
}

describe("SFrame key sender authorization (C1)", () => {
  it("listSframeKeys ignores key events from senders with PL < 50", async () => {
    const client = mockClient(
      [
        mockEvent({ sender: "@mod:hs", keyBytes: [1, 2, 3], id: "a" }),
        mockEvent({ sender: "@rando:hs", keyBytes: [9, 9, 9], id: "b" }),
      ],
      { "@mod:hs": 50, "@rando:hs": 0 },
    );
    const keys = await listSframeKeys(client, "!room:hs");
    expect(keys).toHaveLength(1);
    expect(keys[0].eventId).toBe("a");
  });

  it("listSframeKeys skips decryption-failure events", async () => {
    const client = mockClient(
      [
        mockEvent({ sender: "@mod:hs", keyBytes: [1, 2, 3], id: "good" }),
        mockEvent({ sender: "@mod:hs", decryptFail: true, id: "bad" }),
      ],
      { "@mod:hs": 50 },
    );
    const keys = await listSframeKeys(client, "!room:hs");
    expect(keys).toHaveLength(1);
    expect(keys[0].eventId).toBe("good");
  });

  it("fetchSframeKey returns null when only an unauthorized sender posted a key", async () => {
    const client = mockClient([mockEvent({ sender: "@rando:hs", keyBytes: [5, 5, 5] })], {
      "@rando:hs": 0,
    });
    expect(await fetchSframeKey(client, "!room:hs")).toBeNull();
  });

  it("fetchSframeKey ignores a later unauthorized key and returns the authorized one", async () => {
    const authorized = [7, 7, 7, 7];
    const client = mockClient(
      [
        mockEvent({ sender: "@mod:hs", keyBytes: authorized, id: "auth", ts: 1 }),
        mockEvent({ sender: "@rando:hs", keyBytes: [1, 1, 1], id: "evil", ts: 2 }),
      ],
      { "@mod:hs": 50, "@rando:hs": 0 },
    );
    const got = await fetchSframeKey(client, "!room:hs");
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(authorized);
  });
});
