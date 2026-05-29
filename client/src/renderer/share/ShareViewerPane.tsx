import { useEffect, useRef } from "react";
import type { ActiveShareSummary } from "./types";

interface Props {
  share: ActiveShareSummary;
  onClose: () => void;
}

export function ShareViewerPane({ share, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    const audioEl = audioRef.current;
    if (videoEl) {
      share.videoTrack.attach(videoEl);
    }
    if (audioEl && share.audioTrack) {
      share.audioTrack.attach(audioEl);
    }
    return () => {
      if (videoEl) share.videoTrack.detach(videoEl);
      if (audioEl && share.audioTrack) share.audioTrack.detach(audioEl);
    };
  }, [share]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = share.sharerMatrixUserId ?? share.sharerIdentity;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-6xl flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-300">
            📺 Watching <strong>{displayName}</strong>
            {share.audioTrack && <span className="ml-2 text-slate-500">(with audio)</span>}
          </p>
          <button
            onClick={onClose}
            className="text-sm text-slate-300 hover:text-slate-100"
          >
            Close (Esc)
          </button>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full rounded border border-slate-700 bg-black object-contain"
        />
        <audio ref={audioRef} autoPlay style={{ display: "none" }} />
      </div>
    </div>
  );
}
