import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";
import { Input } from "./Input";
import { createNet } from "../matrix/nets";
import { generateSframeKey, uploadSframeKey } from "../voice/sframeKeys";

interface CreateNetDialogProps {
  client: MatrixClient;
  onClose: () => void;
  onCreated: (matrixRoomId: string) => void;
}

const PRESET_COLORS = ["#22d3ee", "#a78bfa", "#fb7185", "#fbbf24", "#34d399", "#f97316"];

export function CreateNetDialog({ client, onClose, onCreated }: CreateNetDialogProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(50);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const roomId = await createNet(client, { name, priority, color });
      const keyBytes = generateSframeKey();
      await uploadSframeKey(client, roomId, keyBytes);
      onCreated(roomId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create net");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-brand-400">Create a net</h2>
        <p className="mt-1 text-xs text-slate-500">
          A new encrypted Matrix room paired with a LiveKit voice room.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Name"
            placeholder="Command, Alpha Squad, All-Hands…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">
              Priority: <span className="text-brand-400">{priority}</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <span className="text-xs text-slate-500">Higher priority ducks lower-priority nets.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Color</span>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-white" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </label>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create net"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
