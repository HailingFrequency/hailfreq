import type { ServerEntry } from "@shared/types";
import { useState } from "react";
import { Button } from "./Button";

interface Props {
  server: ServerEntry;
  onClose: () => void;
  onRemove: () => Promise<void>;
}

export function ServerContextMenu({ server, onClose, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    setBusy(true);
    try {
      await onRemove();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <>
            <h2 className="text-lg font-semibold text-brand-400">Remove this server?</h2>
            <p className="mt-2 text-sm text-slate-300">
              You'll be signed out of <strong>{server.label}</strong>. Your encryption keys
              for this server will be cleared from this device.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              If you re-add this server later, you'll need your Recovery Key or another
              signed-in device to decrypt encrypted message history.
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={handleRemove} disabled={busy}>
                {busy ? "Removing…" : "Yes, remove"}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-brand-400">{server.label}</h2>
            <p className="mt-1 text-xs text-slate-500">{server.serverUrl}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Remove from Hailfreq…
              </Button>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
