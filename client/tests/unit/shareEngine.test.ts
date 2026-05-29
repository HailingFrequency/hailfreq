import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShareEngine } from "@/renderer/share/ShareEngine";
import type { ActiveShareSummary } from "@/renderer/share/types";

// The vitest environment is "node", so MediaStream is not available.
// Use a minimal fake that mirrors the interface ShareEngine reads.
class FakeMediaStream {
  private videoTracks: MediaStreamTrack[] = [];
  private audioTracks: MediaStreamTrack[] = [];
  getVideoTracks() {
    return this.videoTracks;
  }
  getAudioTracks() {
    return this.audioTracks;
  }
}

function makeFakeRoom() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    localParticipant: {
      publishTrack: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeFakeVoiceEngine(rooms: Map<string, ReturnType<typeof makeFakeRoom>>) {
  return {
    getLiveKitRoom(matrixRoomId: string) {
      return rooms.get(matrixRoomId) ?? null;
    },
  } as never;
}

describe("ShareEngine", () => {
  let rooms: Map<string, ReturnType<typeof makeFakeRoom>>;
  let engine: ShareEngine;
  let started: ActiveShareSummary[];
  let ended: Array<{ matrixRoomId: string; sharerIdentity: string }>;

  beforeEach(() => {
    rooms = new Map([["!room1:hf.example", makeFakeRoom()]]);
    engine = new ShareEngine(makeFakeVoiceEngine(rooms));
    started = [];
    ended = [];
    engine.on({
      onShareStarted: (s) => started.push(s),
      onShareEnded: (roomId, identity) =>
        ended.push({ matrixRoomId: roomId, sharerIdentity: identity }),
    });
  });

  it("attachRoom is idempotent", () => {
    engine.attachRoom("!room1:hf.example");
    engine.attachRoom("!room1:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
  });

  it("attachRoom no-ops for an unmonitored room", () => {
    engine.attachRoom("!missing:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
  });

  it("startLocalShare rejects when no MediaStream video track", async () => {
    const stream = new FakeMediaStream() as unknown as MediaStream; // empty stream
    await expect(
      engine.startLocalShare("!room1:hf.example", stream),
    ).rejects.toThrow(/no video track/);
  });

  it("startLocalShare throws when room is missing", async () => {
    await expect(
      engine.startLocalShare("!missing:hf.example", new FakeMediaStream() as unknown as MediaStream),
    ).rejects.toThrow(/not currently monitored/);
  });

  it("startLocalShare rejects when a local share is already active", async () => {
    (engine as unknown as { localShare: unknown }).localShare = {
      matrixRoomId: "!room1:hf.example",
      videoTrack: {} as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    await expect(
      engine.startLocalShare("!room1:hf.example", new FakeMediaStream() as unknown as MediaStream),
    ).rejects.toThrow(/already active/);
  });

  it("stopLocalShare on null state is a no-op", async () => {
    await expect(engine.stopLocalShare()).resolves.toBeUndefined();
  });

  it("detachRoom clears any remote shares for that room and emits onShareEnded", () => {
    const fake: ActiveShareSummary = {
      matrixRoomId: "!room1:hf.example",
      sharerIdentity: "@bob:hf.example",
      sharerMatrixUserId: "@bob:hf.example",
      videoTrack: {} as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    engine.attachRoom("!room1:hf.example");
    (engine as unknown as { remoteShares: Map<string, ActiveShareSummary> }).remoteShares.set(
      "!room1:hf.example::@bob:hf.example",
      fake,
    );
    engine.detachRoom("!room1:hf.example");
    expect(engine.getActiveShares()).toHaveLength(0);
    expect(ended).toEqual([
      { matrixRoomId: "!room1:hf.example", sharerIdentity: "@bob:hf.example" },
    ]);
  });

  it("shutdown clears all state", () => {
    engine.attachRoom("!room1:hf.example");
    (engine as unknown as { localShare: unknown }).localShare = {
      matrixRoomId: "!room1:hf.example",
      videoTrack: { stop: vi.fn() } as never,
      audioTrack: null,
      startedAt: Date.now(),
    };
    engine.shutdown();
    expect(engine.getActiveShares()).toHaveLength(0);
    expect(engine.getLocalShare()).toBeNull();
  });
});
