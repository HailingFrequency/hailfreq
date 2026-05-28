import type { NetSummary } from "../matrix/nets";
import { KeybindCapture } from "./KeybindCapture";

import type { PttMode } from "../voice/PttController";

interface NetRowProps {
  net: NetSummary;
  monitored: boolean;
  volume: number;
  activeSpeakers: number;
  transmitting: boolean;
  pttMode: PttMode;
  keybind: string | null;
  voiceThresholdDb: number;
  onToggleMonitor: () => void;
  onVolumeChange: (volume: number) => void;
  onPttModeChange: (mode: PttMode) => void;
  onKeybindChange: (accel: string) => void;
  onKeybindClear: () => void;
  onVoiceThresholdChange: (db: number) => void;
}

export function NetRow({
  net,
  monitored,
  volume,
  activeSpeakers,
  transmitting,
  pttMode,
  keybind,
  voiceThresholdDb,
  onToggleMonitor,
  onVolumeChange,
  onPttModeChange,
  onKeybindChange,
  onKeybindClear,
  onVoiceThresholdChange,
}: NetRowProps) {
  return (
    <div className={`flex items-center gap-3 rounded border p-3 ${
      transmitting
        ? "border-brand-400 bg-brand-500/10"
        : monitored
          ? "border-slate-700 bg-slate-800/50"
          : "border-slate-800 bg-slate-900"
    }`}>
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: net.properties.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-slate-100">{net.properties.name}</span>
          <span className="text-xs text-slate-500">P{net.properties.priority}</span>
          {activeSpeakers > 0 && (
            <span className="text-xs text-ok">{activeSpeakers} talking</span>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-500">{net.memberCount} members</div>
      </div>

      <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        className="w-24"
        title={`Volume: ${Math.round(volume * 100)}%`}
        disabled={!monitored}
      />

      <select
        value={pttMode}
        onChange={(e) => onPttModeChange(e.target.value as PttMode)}
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
        title="PTT mode"
      >
        <option value="toggle">Tap</option>
        <option value="hold">Hold</option>
        <option value="voice">Voice</option>
      </select>

      {pttMode !== "voice" && (
        <KeybindCapture value={keybind ?? ""} onChange={onKeybindChange} onClear={onKeybindClear} />
      )}
      {pttMode === "voice" && (
        <input
          type="range"
          min="-70"
          max="-20"
          step="1"
          value={voiceThresholdDb}
          onChange={(e) => onVoiceThresholdChange(Number(e.target.value))}
          className="w-24"
          title={`Voice threshold: ${voiceThresholdDb} dB`}
        />
      )}

      <button
        onClick={onToggleMonitor}
        className={`rounded px-3 py-1 text-xs ${
          monitored
            ? "border border-brand-400 bg-brand-500/20 text-brand-50"
            : "border border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
        }`}
      >
        {monitored ? "Monitoring" : "Monitor"}
      </button>
    </div>
  );
}
