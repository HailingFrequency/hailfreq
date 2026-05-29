import type { BridgeConfig } from "@shared/types";

export type BridgeRunnerStatus =
  | "stopped"
  | "starting"
  | "idle"        // running but not currently relaying audio (smart mode below threshold)
  | "relaying"    // currently passing audio
  | "error";

export interface BridgeRunnerSummary {
  bridgeId: string;
  direction: "forward" | "reverse";
  status: BridgeRunnerStatus;
  /** Last error message if status is "error". */
  errorMessage: string | null;
  /** Ms timestamp of last status transition. */
  changedMs: number;
}

export interface BridgeRunnerEvents {
  onStatusChanged?: (summary: BridgeRunnerSummary) => void;
}

export interface BridgeRunnerContext {
  /** Look up a LiveKit Room across servers. */
  getRoom: (serverId: string, matrixRoomId: string) => import("livekit-client").Room | null;
  /** Play the bridge-active chirp on a target room (best-effort). */
  playBridgeChirp: (targetServerId: string, targetMatrixRoomId: string) => void;
  config: BridgeConfig;
  direction: "forward" | "reverse";
}
