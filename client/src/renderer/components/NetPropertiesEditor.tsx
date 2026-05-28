import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { NetSummary } from "../matrix/nets";
import { renameNet, updateNetProperties, deleteNet } from "../matrix/nets";
import { Button } from "./Button";

const PRESET_COLORS = [
  "#22d3ee", // cyan
  "#34d399", // emerald
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#f472b6", // pink
  "#fb923c", // orange
  "#facc15", // yellow
  "#f87171", // red
];

interface NetPropertiesEditorProps {
  client: MatrixClient;
  net: NetSummary;
  onClose: () => void;
  onDeleted: () => void;
}

export function NetPropertiesEditor({
  client,
  net,
  onClose,
  onDeleted,
}: NetPropertiesEditorProps) {
  const [name, setName] = useState(net.properties.name);
  const [priority, setPriority] = useState(net.properties.priority);
  const [color, setColor] = useState(net.properties.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Net name cannot be empty");

      // Rename if name changed
      if (trimmedName !== net.properties.name) {
        await renameNet(client, net.matrixRoomId, trimmedName);
      }
      // Update priority + color if changed
      const patch: Partial<{ priority: number; color: string }> = {};
      if (priority !== net.properties.priority) patch.priority = priority;
      if (color !== net.properties.color) patch.color = color;
      if (Object.keys(patch).length > 0) {
        await updateNetProperties(client, net.matrixRoomId, patch);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteNet(client, net.matrixRoomId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-brand-400">
          Net Properties
        </h2>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Net name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Net name"
              required
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
            />
          </div>

          {/* Priority slider */}
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Priority</span>
              <span className="font-mono text-slate-200">{priority}</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>0 (low)</span>
              <span>100 (high)</span>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform ${
                    color === c
                      ? "scale-110 border-white"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded border border-rose-800 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>

        {/* Delete danger zone */}
        <div className="mt-6 border-t border-slate-800 pt-4">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="w-full rounded border border-rose-800 px-3 py-2 text-xs text-rose-300 hover:bg-rose-800/20 disabled:opacity-50"
            >
              Delete net…
            </button>
          ) : (
            <div className="rounded border border-rose-800 bg-rose-950/20 p-3">
              <p className="mb-3 text-xs text-rose-200">
                This sends a tombstone event and removes you from the net.
                Other members will see the net as deleted. This cannot be
                undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  {busy ? "Deleting…" : "Confirm delete"}
                </button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
