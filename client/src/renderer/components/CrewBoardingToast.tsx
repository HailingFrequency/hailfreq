import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";

// ---------------------------------------------------------------------------
// Toast entry — produced by ScIntegration (Task 11), consumed here
// ---------------------------------------------------------------------------

export interface CrewBoardingToastEntry {
  id: string;
  rsiHandle: string;
  matrixUserId: string | null;
  shipNetRoomId: string;
  shipType: string;
  /** Unix ms timestamp after which the toast should be auto-dismissed. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Single toast card
// ---------------------------------------------------------------------------

export interface CrewBoardingToastProps {
  client: MatrixClient;
  rsiHandle: string;
  matrixUserId: string | null;
  shipNetRoomId: string;
  shipType: string;
  onDismiss: () => void;
  /** Task 11 wires this to the real allowlist mutation. */
  onAddToAllowlist: (rsiHandle: string) => Promise<void>;
}

export function CrewBoardingToast({
  client,
  rsiHandle,
  matrixUserId,
  shipNetRoomId,
  shipType,
  onDismiss,
  onAddToAllowlist,
}: CrewBoardingToastProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    if (!matrixUserId) return;
    setBusy(true);
    setError(null);
    try {
      await client.invite(shipNetRoomId, matrixUserId);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAllowlistAndInvite() {
    if (!matrixUserId) return;
    setBusy(true);
    setError(null);
    try {
      await onAddToAllowlist(rsiHandle);
      await client.invite(shipNetRoomId, matrixUserId);
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-brand-700 bg-slate-900 p-3 shadow-lg">
      <p className="text-sm">
        🚢 <strong>{rsiHandle}</strong> boarded your {shipType}
      </p>
      {!matrixUserId && (
        <p className="mt-1 text-xs text-slate-500">
          No Hailfreq account found (not signed in with CitizenID).
        </p>
      )}
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={handleInvite} disabled={!matrixUserId || busy}>
          Invite to net
        </Button>
        <Button variant="ghost" onClick={handleAllowlistAndInvite} disabled={!matrixUserId || busy}>
          + Always invite
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={busy}>
          Ignore
        </Button>
      </div>
    </div>
  );
}
