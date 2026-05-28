import { useEffect, useState } from "react";
import { eventToAccelerator, formatAccelerator } from "../voice/keybinds";

interface KeybindCaptureProps {
  value: string;
  onChange: (accelerator: string) => void;
  onClear?: () => void;
}

export function KeybindCapture({ value, onChange, onClear }: KeybindCaptureProps) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const accel = eventToAccelerator(e);
      if (!accel) return;
      onChange(accel);
      setCapturing(false);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [capturing, onChange]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCapturing((c) => !c)}
        className={`rounded border px-3 py-1 text-xs font-mono ${
          capturing
            ? "border-brand-400 bg-brand-500/20 text-brand-50"
            : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
        }`}
      >
        {capturing ? "Press a key…" : value ? formatAccelerator(value) : "Click to set"}
      </button>
      {value && onClear && !capturing && (
        <button
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-rose-400"
          title="Clear keybind"
        >
          ✕
        </button>
      )}
    </div>
  );
}
