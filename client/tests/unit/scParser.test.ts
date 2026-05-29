import { describe, it, expect, vi, afterEach } from "vitest";
import { parseLine } from "@/renderer/sc/parser";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseLine", () => {
  // ---------------------------------------------------------------------------
  // Happy-path tests from Plan 7 Task 13
  // ---------------------------------------------------------------------------

  it("parses login event", () => {
    const line = `<2026-05-28T23:10:18.519Z> [Notice] <Expect Incoming Connection> session=319d8f64a48e484537d0405fb9f49c59 node_id=00000000-0000-0000-0000-00000061ee59 nickname="Rocktato" playerGEID=204741507615 [Team_Network][Network][Gateway]`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "login",
      timestamp: "2026-05-28T23:10:18.519Z",
      nickname: "Rocktato",
      geid: "204741507615",
    });
  });

  it("parses you-joined-channel event", () => {
    const line = `<2026-05-28T23:16:57.612Z> [Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'Anvil Asgard : Rocktato'.`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "you-joined-channel",
      timestamp: "2026-05-28T23:16:57.612Z",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });

  it("parses other-joined-channel event", () => {
    const line = `<2026-05-29T00:09:29.495Z> W4RB0SS has joined the channel 'Anvil Asgard : Rocktato'.`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "other-joined-channel",
      timestamp: "2026-05-29T00:09:29.495Z",
      player: "W4RB0SS",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });

  it("returns null for unrelated lines", () => {
    expect(parseLine("some unrelated log line")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Robustness tests
  // ---------------------------------------------------------------------------

  it("falls back to a current ISO timestamp when the line has no leading <timestamp>", () => {
    // A you-joined line that somehow lacks the timestamp prefix
    const line = `[Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'Drake Cutlass : Pilot'.`;
    const event = parseLine(line);
    // Parser still recognises the event
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("you-joined-channel");
    // Timestamp must be a valid ISO 8601 string (fallback to Date.now)
    expect(event?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("falls back to a pinned Date when mocked, confirming the fallback path", () => {
    const FIXED_ISO = "2030-01-01T00:00:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(FIXED_ISO);

    // Line without a timestamp prefix so the fallback branch is taken
    const line = `[Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'Aegis Avenger : Pilot'.`;
    const event = parseLine(line);
    expect(event?.timestamp).toBe(FIXED_ISO);
  });

  it("handles trailing garbage after the closing quote without erroring", () => {
    // Simulates the operator copy-paste artifact: extra content appended
    const line = `<2026-05-28T23:16:57.612Z> [Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'Anvil Asgard : Rocktato'.: " [68] to queue. New queue   there is one for my friend`;
    const event = parseLine(line);
    expect(event).toEqual({
      kind: "you-joined-channel",
      timestamp: "2026-05-28T23:16:57.612Z",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });

  it("handles trailing whitespace on a line without breaking extraction", () => {
    const line = `<2026-05-29T00:09:29.495Z> W4RB0SS has joined the channel 'Anvil Asgard : Rocktato'.   `;
    const event = parseLine(line);
    expect(event?.kind).toBe("other-joined-channel");
    expect(event).toMatchObject({
      player: "W4RB0SS",
      shipType: "Anvil Asgard",
      owner: "Rocktato",
    });
  });
});
