import { describe, it, expect, vi } from "vitest";
import {
  timelineToMessages,
  sendTextMessage,
  formatMessageTime,
  type ChatMessage,
} from "@/renderer/matrix/messages";

// ---------------------------------------------------------------------------
// Minimal helpers — match the mocking style from channels.test.ts
// ---------------------------------------------------------------------------

function makeEvent(opts: {
  eventId: string;
  sender: string;
  type: string;
  content: Record<string, unknown>;
  ts: number;
  redacted?: boolean;
}) {
  return {
    getId: () => opts.eventId,
    getSender: () => opts.sender,
    getType: () => opts.type,
    getContent: () => opts.content,
    getTs: () => opts.ts,
    isRedacted: () => opts.redacted ?? false,
  };
}

function makeRoomMember(userId: string, displayName: string | null) {
  return {
    userId,
    name: displayName ?? userId,
  };
}

function makeRoom(
  members: { userId: string; displayName: string | null }[],
  events: ReturnType<typeof makeEvent>[],
) {
  const memberMap = new Map(
    members.map((m) => [m.userId, makeRoomMember(m.userId, m.displayName)]),
  );
  return {
    getLiveTimeline: () => ({
      getEvents: () => events,
    }),
    getMember: (userId: string) => memberMap.get(userId) ?? null,
  };
}

// ---------------------------------------------------------------------------
// formatMessageTime
// ---------------------------------------------------------------------------

describe("formatMessageTime", () => {
  it("formats a timestamp as HH:MM in local time", () => {
    // Use a real timestamp and verify it matches what Date would produce
    // constructing the expected value via Date APIs (timezone-agnostic).
    const ts = 1_700_000_000_000; // arbitrary fixed point
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const expected = `${h}:${m}`;
    expect(formatMessageTime(ts)).toBe(expected);
  });

  it("pads single-digit hours and minutes with a leading zero", () => {
    // Build a date that is known to have a single-digit hour (01) and single-digit minute (05)
    // by constructing it directly — use local time setters to avoid timezone issues.
    const d = new Date();
    d.setHours(1, 5, 0, 0);
    const ts = d.getTime();
    expect(formatMessageTime(ts)).toBe("01:05");
  });

  it("correctly represents midnight (00:00)", () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    expect(formatMessageTime(d.getTime())).toBe("00:00");
  });
});

// ---------------------------------------------------------------------------
// timelineToMessages
// ---------------------------------------------------------------------------

describe("timelineToMessages", () => {
  it("maps m.room.message text events to ChatMessage[]", () => {
    const room = makeRoom(
      [{ userId: "@alice:example.com", displayName: "Alice" }],
      [
        makeEvent({
          eventId: "$evt1",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "Hello" },
          ts: 1_000,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, "@bob:example.com");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject<ChatMessage>({
      eventId: "$evt1",
      senderId: "@alice:example.com",
      senderName: "Alice",
      body: "Hello",
      timestamp: 1_000,
      isOwn: false,
    });
  });

  it("sets isOwn = true for own messages", () => {
    const ownId = "@me:example.com";
    const room = makeRoom(
      [{ userId: ownId, displayName: "Me" }],
      [
        makeEvent({
          eventId: "$own1",
          sender: ownId,
          type: "m.room.message",
          content: { msgtype: "m.text", body: "My message" },
          ts: 1_000,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, ownId);

    expect(messages[0].isOwn).toBe(true);
  });

  it("skips non m.room.message events", () => {
    const room = makeRoom(
      [{ userId: "@alice:example.com", displayName: "Alice" }],
      [
        makeEvent({
          eventId: "$state1",
          sender: "@alice:example.com",
          type: "m.room.member",
          content: { membership: "join" },
          ts: 500,
        }),
        makeEvent({
          eventId: "$msg1",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "Hi" },
          ts: 1_000,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, "@bob:example.com");
    expect(messages).toHaveLength(1);
    expect(messages[0].eventId).toBe("$msg1");
  });

  it("skips m.room.message events with non-text msgtype", () => {
    const room = makeRoom(
      [{ userId: "@alice:example.com", displayName: "Alice" }],
      [
        makeEvent({
          eventId: "$img1",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.image", url: "mxc://example.com/abc" },
          ts: 1_000,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, "@bob:example.com");
    expect(messages).toHaveLength(0);
  });

  it("skips redacted events", () => {
    const room = makeRoom(
      [{ userId: "@alice:example.com", displayName: "Alice" }],
      [
        makeEvent({
          eventId: "$redacted1",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "" },
          ts: 1_000,
          redacted: true,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, "@bob:example.com");
    expect(messages).toHaveLength(0);
  });

  it("falls back to senderId when member has no display name", () => {
    const room = makeRoom(
      [],
      [
        makeEvent({
          eventId: "$evt1",
          sender: "@ghost:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "Boo" },
          ts: 1_000,
        }),
      ],
    );

    // getMember returns null — no member found
    const messages = timelineToMessages(room as any, "@bob:example.com");
    expect(messages[0].senderName).toBe("@ghost:example.com");
  });

  it("sorts events oldest→newest by timestamp", () => {
    const room = makeRoom(
      [{ userId: "@alice:example.com", displayName: "Alice" }],
      [
        makeEvent({
          eventId: "$newer",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "Second" },
          ts: 2_000,
        }),
        makeEvent({
          eventId: "$older",
          sender: "@alice:example.com",
          type: "m.room.message",
          content: { msgtype: "m.text", body: "First" },
          ts: 1_000,
        }),
      ],
    );

    const messages = timelineToMessages(room as any, "@bob:example.com");
    expect(messages[0].eventId).toBe("$older");
    expect(messages[1].eventId).toBe("$newer");
  });

  it("returns [] for a room with no events", () => {
    const room = makeRoom([], []);
    expect(timelineToMessages(room as any, "@bob:example.com")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sendTextMessage
// ---------------------------------------------------------------------------

describe("sendTextMessage", () => {
  it("calls client.sendTextMessage with trimmed body", async () => {
    const client = { sendTextMessage: vi.fn().mockResolvedValue({ event_id: "$sent" }) };

    await sendTextMessage(client as any, "!room:example.com", "  Hello world  ");

    expect(client.sendTextMessage).toHaveBeenCalledOnce();
    expect(client.sendTextMessage).toHaveBeenCalledWith("!room:example.com", "Hello world");
  });

  it("rejects with descriptive error for empty body", async () => {
    const client = { sendTextMessage: vi.fn() };

    await expect(sendTextMessage(client as any, "!room:example.com", "")).rejects.toThrow(
      /empty/i,
    );
    expect(client.sendTextMessage).not.toHaveBeenCalled();
  });

  it("rejects with descriptive error for whitespace-only body", async () => {
    const client = { sendTextMessage: vi.fn() };

    await expect(
      sendTextMessage(client as any, "!room:example.com", "   \t\n   "),
    ).rejects.toThrow(/empty/i);
    expect(client.sendTextMessage).not.toHaveBeenCalled();
  });

  it("does not call the SDK when validation fails", async () => {
    const client = { sendTextMessage: vi.fn() };

    try {
      await sendTextMessage(client as any, "!room:example.com", "");
    } catch {
      // expected
    }

    expect(client.sendTextMessage).not.toHaveBeenCalled();
  });
});
