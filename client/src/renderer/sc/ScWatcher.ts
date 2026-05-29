import { parseLine } from "./parser";
import type {
  ScEvent,
  LoginEvent,
  YouJoinedChannelEvent,
  OtherJoinedChannelEvent,
  ShipDestroyedEvent,
} from "./events";

export interface ScWatcherEvents {
  /** Fired the first time we see a login event. */
  onLogin?: (event: LoginEvent) => void;
  /** Fired when YOU board YOUR ship (owner matches login nickname). */
  onOwnShipBoarded?: (event: YouJoinedChannelEvent) => void;
  /** Fired when YOU board SOMEONE ELSE's ship (owner != login nickname). */
  onOtherShipBoarded?: (event: YouJoinedChannelEvent) => void;
  /** Fired when ANOTHER player joins a channel for YOUR ship. */
  onCrewJoined?: (event: OtherJoinedChannelEvent) => void;
  /** Fired when a ship-destroyed event is parsed (best-effort). */
  onShipDestroyed?: (event: ShipDestroyedEvent) => void;
}

export class ScWatcher {
  private localNickname: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners: ScWatcherEvents = {};

  on(events: ScWatcherEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  async start(gameLogPath: string): Promise<void> {
    if (this.unsubscribe !== null) {
      throw new Error("ScWatcher.start() called while already running — call stop() first");
    }
    await window.hailfreq.invoke("sc:startWatch", { gameLogPath });
    this.unsubscribe = window.hailfreq.onScLogLine((payload) => {
      const event = parseLine(payload.line);
      if (!event) return;
      this.dispatch(event);
    });
  }

  async stop(): Promise<void> {
    await window.hailfreq.invoke("sc:stopWatch");
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getLocalNickname(): string | null {
    return this.localNickname;
  }

  private dispatch(event: ScEvent): void {
    switch (event.kind) {
      case "login":
        this.localNickname = event.nickname;
        this.listeners.onLogin?.(event);
        return;
      case "you-joined-channel":
        if (this.localNickname && event.owner === this.localNickname) {
          this.listeners.onOwnShipBoarded?.(event);
        } else {
          this.listeners.onOtherShipBoarded?.(event);
        }
        return;
      case "other-joined-channel":
        if (this.localNickname && event.owner === this.localNickname) {
          this.listeners.onCrewJoined?.(event);
        }
        return;
      case "ship-destroyed":
        this.listeners.onShipDestroyed?.(event);
        return;
    }
  }
}
