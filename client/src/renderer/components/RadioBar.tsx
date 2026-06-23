// client/src/renderer/components/RadioBar.tsx
interface RadioBarProps {
  channelName: string;
  freqTag: string;
  pttKey: string;
  isTransmitting: boolean;
  isMuted: boolean;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onPttDown: () => void;
  onPttUp: () => void;
}

export function RadioBar({
  channelName,
  freqTag,
  pttKey,
  isTransmitting,
  isMuted,
  onDisconnect,
  onToggleMute,
  onPttDown,
  onPttUp,
}: RadioBarProps) {
  return (
    <div className="flex-shrink-0 border-t-2 border-brand-500/30 bg-slate-950">
      {/* Row 1: channel name + freq tag */}
      <div className="flex items-center gap-2 px-2.5 pt-2 pb-1">
        <span className="text-xs" aria-hidden="true">📻</span>
        <span className="flex-1 truncate text-xs font-semibold text-brand-400">
          {channelName}
        </span>
        {freqTag && (
          <span className="shrink-0 rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
            {freqTag}
          </span>
        )}
      </div>

      {/* Row 2: PTT + mute + disconnect */}
      <div className="flex items-center gap-1.5 px-2.5 pb-2">
        {/* PTT button — spans most of the width */}
        <button
          type="button"
          onMouseDown={onPttDown}
          onMouseUp={onPttUp}
          onMouseLeave={onPttUp}
          aria-label="Push to talk"
          aria-pressed={isTransmitting}
          className={[
            "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-semibold transition-all select-none",
            isTransmitting
              ? "animate-pulse border border-brand-500/60 bg-brand-500/30 text-brand-300"
              : "border border-slate-700 bg-slate-800 text-slate-400 hover:border-brand-500/40 hover:bg-brand-500/10 hover:text-brand-400",
          ].join(" ")}
        >
          <span aria-hidden="true">🎤</span>
          <span>PTT</span>
          <kbd className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-500">
            {pttKey}
          </kbd>
        </button>

        {/* Mute toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          title={isMuted ? "Unmute" : "Mute"}
          className={[
            "flex h-7 w-7 items-center justify-center rounded text-sm transition-colors",
            isMuted
              ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200",
          ].join(" ")}
        >
          {isMuted ? "🔇" : "🎙️"}
        </button>

        {/* Disconnect */}
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect from channel"
          title="Disconnect"
          className="flex h-7 w-7 items-center justify-center rounded bg-slate-800 text-sm text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
        >
          ↩
        </button>
      </div>
    </div>
  );
}
