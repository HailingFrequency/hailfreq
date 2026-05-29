import { useState } from "react";
import { Button } from "../../components/Button";

interface Props {
  onFinish: (config: { defaultMode: "toggle" | "hold" | "voice"; defaultKey: string | null }) => void;
  onBack: () => void;
  onSkip: () => void;
}

export function PttStep({ onFinish, onBack, onSkip }: Props) {
  const [mode, setMode] = useState<"toggle" | "hold" | "voice">("hold");
  const [key, setKey] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  // Capture next key press as the PTT key
  // Uses event.code (e.g. "KeyV", "Space") for layout-independent binding
  function startCapture() {
    setCapturing(true);
    const handler = (ev: KeyboardEvent) => {
      ev.preventDefault();
      setKey(ev.code);
      setCapturing(false);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("keydown", handler);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 3 of 3 — PTT</h2>
      <p className="text-sm text-slate-400">
        Pick how Hailfreq decides when your mic is open. You can change this per net later.
      </p>

      <div className="space-y-2">
        {(["hold", "toggle", "voice"] as const).map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
            <span>
              <strong>
                {m === "hold" ? "Press-and-hold" : m === "toggle" ? "Tap-to-toggle" : "Voice activation"}
              </strong>
              <span className="block text-xs text-slate-500">
                {m === "hold" && "Mic open while you hold the key. Most common for tactical comms."}
                {m === "toggle" && "Tap key to open, tap again to close. Hands-free for long stretches."}
                {m === "voice" && "Mic opens automatically when you speak above a threshold."}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode !== "voice" && (
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400">PTT key</span>
          <div className="mt-1 flex items-center gap-2">
            <code className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm">
              {capturing ? "Press a key…" : key ?? "(not set)"}
            </code>
            <Button onClick={startCapture}>{key ? "Change" : "Capture"}</Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Optional — you can set per-net keys later in net properties.
          </p>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onSkip}>Skip setup</Button>
          <Button onClick={() => onFinish({ defaultMode: mode, defaultKey: key })}>Finish</Button>
        </div>
      </div>
    </div>
  );
}
