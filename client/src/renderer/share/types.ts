import type { RemoteVideoTrack, RemoteAudioTrack, LocalVideoTrack, LocalAudioTrack } from "livekit-client";

export interface ActiveShareSummary {
  /** Matrix room id of the net the share is happening in. */
  matrixRoomId: string;
  /** LiveKit participant identity of the sharer. */
  sharerIdentity: string;
  /** Optional Matrix user id derived from participant identity, if resolvable. */
  sharerMatrixUserId: string | null;
  /** Live video track to attach to a <video> element. */
  videoTrack: RemoteVideoTrack;
  /** Live audio track if the sharer also published system audio, null otherwise. */
  audioTrack: RemoteAudioTrack | null;
  /** Wall-clock timestamp (ms) when this share was first observed. */
  startedAt: number;
}

export interface LocalShareState {
  matrixRoomId: string;
  videoTrack: LocalVideoTrack;
  audioTrack: LocalAudioTrack | null;
  startedAt: number;
}

export interface ShareEngineEvents {
  onShareStarted?: (share: ActiveShareSummary) => void;
  onShareEnded?: (matrixRoomId: string, sharerIdentity: string) => void;
  onLocalShareStarted?: (state: LocalShareState) => void;
  onLocalShareEnded?: (matrixRoomId: string) => void;
}
