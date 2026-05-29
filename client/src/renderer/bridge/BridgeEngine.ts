import type { BridgeConfig } from "@shared/types";
import type { Room } from "livekit-client";
import { BridgeRunner } from "./BridgeRunner";
import type { BridgeRunnerSummary } from "./types";

export interface BridgeEngineContext {
  /** Look up a LiveKit Room across servers (BridgeRunner needs this). */
  getRoom: (serverId: string, matrixRoomId: string) => Room | null;
  /** Play the bridge-active chirp on a target room (best-effort). */
  playBridgeChirp: (targetServerId: string, targetMatrixRoomId: string) => void;
}

export interface BridgeEngineEvents {
  onRunnerStatusChanged?: (summary: BridgeRunnerSummary) => void;
}

interface ActiveBridge {
  config: BridgeConfig;
  forward: BridgeRunner;
  reverse: BridgeRunner | null;
}

export class BridgeEngine {
  private readonly ctx: BridgeEngineContext;
  private listeners: BridgeEngineEvents = {};
  private active = new Map<string, ActiveBridge>(); // key: bridge.id
  private configs: BridgeConfig[] = [];

  constructor(ctx: BridgeEngineContext) {
    this.ctx = ctx;
  }

  on(events: BridgeEngineEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  /**
   * Replace the full set of bridge configs. Starts new enabled bridges,
   * stops removed/disabled bridges, restarts bridges whose config changed.
   */
  async setConfigs(configs: BridgeConfig[]): Promise<void> {
    this.configs = configs;
    const seen = new Set<string>();
    for (const config of configs) {
      seen.add(config.id);
      const existing = this.active.get(config.id);
      if (!existing) {
        if (config.enabled) {
          await this.startBridge(config);
        }
      } else if (this.isStructuralChange(existing.config, config)) {
        await this.stopBridge(config.id);
        if (config.enabled) await this.startBridge(config);
      } else if (existing.config.enabled !== config.enabled) {
        if (config.enabled) await this.startBridge(config);
        else await this.stopBridge(config.id);
      }
      // Else: enabled status unchanged, no structural change → no-op
    }
    // Stop bridges that were removed from the config list
    for (const id of Array.from(this.active.keys())) {
      if (!seen.has(id)) await this.stopBridge(id);
    }
  }

  /** Re-evaluate whether stopped bridges can now start (e.g., a monitored room came online). */
  async refreshRoomAvailability(): Promise<void> {
    for (const config of this.configs) {
      if (!config.enabled) continue;
      if (this.active.has(config.id)) continue;
      const srcAvailable = this.ctx.getRoom(config.source.serverId, config.source.matrixRoomId) !== null;
      const tgtAvailable = this.ctx.getRoom(config.target.serverId, config.target.matrixRoomId) !== null;
      if (srcAvailable && tgtAvailable) {
        await this.startBridge(config);
      }
    }
  }

  getActiveSummaries(): BridgeRunnerSummary[] {
    const out: BridgeRunnerSummary[] = [];
    for (const ab of this.active.values()) {
      out.push({
        bridgeId: ab.config.id,
        direction: "forward",
        status: ab.forward.getStatus(),
        errorMessage: null,
        changedMs: Date.now(),
      });
      if (ab.reverse) {
        out.push({
          bridgeId: ab.config.id,
          direction: "reverse",
          status: ab.reverse.getStatus(),
          errorMessage: null,
          changedMs: Date.now(),
        });
      }
    }
    return out;
  }

  async shutdown(): Promise<void> {
    for (const id of Array.from(this.active.keys())) {
      await this.stopBridge(id);
    }
    this.configs = [];
    this.listeners = {};
  }

  private isStructuralChange(a: BridgeConfig, b: BridgeConfig): boolean {
    return (
      a.source.serverId !== b.source.serverId ||
      a.source.matrixRoomId !== b.source.matrixRoomId ||
      a.target.serverId !== b.target.serverId ||
      a.target.matrixRoomId !== b.target.matrixRoomId ||
      a.mode !== b.mode ||
      a.smartThreshold !== b.smartThreshold ||
      a.bidirectional !== b.bidirectional
    );
  }

  private async startBridge(config: BridgeConfig): Promise<void> {
    const forward = new BridgeRunner({
      getRoom: this.ctx.getRoom,
      playBridgeChirp: this.ctx.playBridgeChirp,
      config,
      direction: "forward",
    });
    forward.on({ onStatusChanged: (s) => this.listeners.onRunnerStatusChanged?.(s) });
    await forward.start();

    let reverse: BridgeRunner | null = null;
    if (config.bidirectional) {
      reverse = new BridgeRunner({
        getRoom: this.ctx.getRoom,
        playBridgeChirp: this.ctx.playBridgeChirp,
        config,
        direction: "reverse",
      });
      reverse.on({ onStatusChanged: (s) => this.listeners.onRunnerStatusChanged?.(s) });
      await reverse.start();
    }
    this.active.set(config.id, { config, forward, reverse });
  }

  private async stopBridge(bridgeId: string): Promise<void> {
    const ab = this.active.get(bridgeId);
    if (!ab) return;
    this.active.delete(bridgeId);
    await ab.forward.stop();
    if (ab.reverse) await ab.reverse.stop();
  }
}
