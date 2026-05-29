import type { LocalShareState } from "../share/types";

interface Props {
  localShare: LocalShareState | null;
  netName: string | null;
  onStop: () => void;
}

export function SharingStatusBar({ localShare, netName, onStop }: Props) {
  if (!localShare) return null;
  return (
    <div className="flex items-center justify-between border-b border-rose-800/40 bg-rose-950/40 px-3 py-1 text-xs">
      <span className="flex items-center gap-2 text-rose-200">
        🔴 Sharing your screen to <strong>{netName ?? "(net)"}</strong>
      </span>
      <button
        onClick={onStop}
        className="rounded bg-rose-700 px-2 py-0.5 text-xs text-white hover:bg-rose-600"
      >
        Stop sharing
      </button>
    </div>
  );
}
