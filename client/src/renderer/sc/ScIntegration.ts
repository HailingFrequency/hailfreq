import type { MatrixClient } from "matrix-js-sdk";
import type { VoiceEngine } from "../voice/VoiceEngine";
import type { ShareEngine } from "../share/ShareEngine";
import { ScWatcher } from "./ScWatcher";
import { createShipNet, findShipNetByShip } from "../matrix/nets";
import { generateSframeKey, uploadSframeKey } from "../voice/sframeKeys";
import { lookupMatrixIdByRsiHandle } from "../matrix/profileCache";
import type { ServerEntry } from "@shared/types";
import type { YouJoinedChannelEvent, OtherJoinedChannelEvent, ShipDestroyedEvent } from "./events";

export interface ScIntegrationEvents {
  onCrewBoarded?: (info: {
    rsiHandle: string;
    matrixUserId: string | null;
    shipNetRoomId: string;
    /** The ship type (e.g. "Carrack", "Pisces") the crew member boarded. */
    shipType: string;
  }) => void;
  onShipNetCreated?: (matrixRoomId: string) => void;
  onShipNetClosed?: (matrixRoomId: string) => void;
}

export class ScIntegration {
  private readonly client: MatrixClient;
  private readonly engine: VoiceEngine;
  private readonly shareEngine: ShareEngine | undefined;
  private serverEntry: ServerEntry;
  private watcher: ScWatcher | null = null;
  private listeners: ScIntegrationEvents = {};
  private pendingShipNets = new Map<string, Promise<string>>();
  private stopped = false;

  private shipNetKey(shipType: string, owner: string): string {
    return `${shipType}::${owner}`;
  }

  constructor(
    client: MatrixClient,
    engine: VoiceEngine,
    serverEntry: ServerEntry,
    shareEngine?: ShareEngine,
  ) {
    this.client = client;
    this.engine = engine;
    this.serverEntry = serverEntry;
    this.shareEngine = shareEngine;
  }

  setServerEntry(entry: ServerEntry): void {
    this.serverEntry = entry;
  }

  on(events: ScIntegrationEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  async start(gameLogPath: string): Promise<void> {
    if (this.watcher || this.stopped) return;
    const watcher = new ScWatcher();
    watcher.on({
      onOwnShipBoarded: (e: YouJoinedChannelEvent) =>
        void this.handleOwnShipBoarded(e.shipType, e.owner),
      onCrewJoined: (e: OtherJoinedChannelEvent) =>
        void this.handleCrewJoined(e.player, e.shipType, e.owner),
      onShipDestroyed: (e: ShipDestroyedEvent) =>
        void this.handleShipDestroyed(e.shipType, e.owner),
    });
    await watcher.start(gameLogPath);
    if (this.stopped) {
      // stop() ran during our await; shut down the orphan watcher immediately
      await watcher.stop();
      return;
    }
    this.watcher = watcher;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (!this.watcher) return;
    await this.watcher.stop();
    this.watcher = null;
  }

  private async handleOwnShipBoarded(shipType: string, ownerNickname: string): Promise<void> {
    try {
      const key = this.shipNetKey(shipType, ownerNickname);
      const creation = (async () => {
        const existing = findShipNetByShip(this.client, shipType, ownerNickname);
        if (existing) return existing;
        const ownerMatrixId = this.client.getSafeUserId();
        const roomId = await createShipNet(this.client, {
          shipType,
          ownerRsi: ownerNickname,
          ownerMatrixId,
        });
        const keyBytes = generateSframeKey();
        await uploadSframeKey(this.client, roomId, keyBytes);
        this.listeners.onShipNetCreated?.(roomId);
        return roomId;
      })();
      this.pendingShipNets.set(key, creation);
      try {
        const roomId = await creation;
        await this.engine.monitorNet({ matrixRoomId: roomId, priority: 60 });
        this.shareEngine?.attachRoom(roomId);
      } finally {
        this.pendingShipNets.delete(key);
      }
    } catch (err) {
      console.error("[ScIntegration] handleOwnShipBoarded failed:", err);
    }
  }

  private async handleCrewJoined(
    crewNickname: string,
    shipType: string,
    ownerNickname: string,
  ): Promise<void> {
    try {
      const key = this.shipNetKey(shipType, ownerNickname);
      const pending = this.pendingShipNets.get(key);
      const shipNetRoomId = pending
        ? await pending
        : findShipNetByShip(this.client, shipType, ownerNickname);
      if (!shipNetRoomId) return;

      const matrixUserId = await lookupMatrixIdByRsiHandle(this.client, crewNickname);

      this.listeners.onCrewBoarded?.({
        rsiHandle: crewNickname,
        matrixUserId,
        shipNetRoomId,
        shipType,
      });

      const allowed = this.serverEntry.scIntegration?.autoInviteAllowlist
        ?.some((h) => h.toLowerCase() === crewNickname.toLowerCase());
      if (allowed && matrixUserId) {
        try {
          await this.client.invite(shipNetRoomId, matrixUserId);
        } catch (err) {
          console.error(
            `[ScIntegration] auto-invite failed — user: ${matrixUserId}, room: ${shipNetRoomId}, handle: ${crewNickname}`,
            err,
          );
        }
      }
    } catch (err) {
      console.error("[ScIntegration] handleCrewJoined failed:", err);
    }
  }

  private async handleShipDestroyed(
    shipType: string,
    eventOwner: string | null,
  ): Promise<void> {
    try {
      if (!this.serverEntry.scIntegration?.autoCloseOnDestruction) return;
      // Prefer the owner extracted from the destruction event; fall back to the
      // nickname the watcher recorded at login time (destruction events may omit
      // the owner field in some log versions).
      const ownerNickname = eventOwner ?? this.watcher?.getLocalNickname();
      if (!ownerNickname) return;
      const shipNetRoomId = findShipNetByShip(this.client, shipType, ownerNickname);
      if (!shipNetRoomId) return;
      this.shareEngine?.detachRoom(shipNetRoomId);
      await this.engine.unmonitorNet(shipNetRoomId);
      // v1: stop monitoring only. Tombstone + leave is reserved for v1.5 behind
      // an "auto-tombstone on destruction" settings toggle.
      this.listeners.onShipNetClosed?.(shipNetRoomId);
    } catch (err) {
      console.error("[ScIntegration] handleShipDestroyed failed:", err);
    }
  }
}
