import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { ServerEntry } from "@shared/types";
import { Button } from "../components/Button";
import { NetListPanel } from "../components/NetListPanel";
import { CreateNetDialog } from "../components/CreateNetDialog";
import { AdminBoard } from "./AdminBoard";
import {
  detectAdminCapabilities,
  type AdminCapabilities,
} from "../matrix/permissions";
import {
  CrewBoardingToast,
  type CrewBoardingToastEntry,
} from "../components/CrewBoardingToast";

/** Max toasts shown simultaneously. */
const MAX_CREW_TOASTS = 3;
/** Auto-dismiss interval in ms. */
const AUTO_DISMISS_INTERVAL_MS = 1000;

interface HomeProps {
  client: MatrixClient;
  onLogout: () => Promise<void> | void;
  serverEntry: ServerEntry;
  onTransmittingChange: (net: string | null) => void;
  /**
   * Crew-boarding toasts to display. Populated by ScIntegration in Task 11;
   * for now the queue is always empty until that wiring is in place.
   */
  crewBoardingToasts: CrewBoardingToastEntry[];
  /** Called when a toast is dismissed (by user action or auto-expire). */
  onDismissCrewBoardingToast: (toastId: string) => void;
}

export function Home({
  client,
  onLogout,
  serverEntry,
  onTransmittingChange,
  crewBoardingToasts,
  onDismissCrewBoardingToast,
}: HomeProps) {
  const [creating, setCreating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [adminCaps, setAdminCaps] = useState<AdminCapabilities | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    void detectAdminCapabilities(client).then(setAdminCaps);
  }, [client]);

  // Auto-dismiss toasts whose expiresAt has passed.
  // A single interval is cheaper than one timeout per toast.
  const onDismissRef = useRef(onDismissCrewBoardingToast);
  onDismissRef.current = onDismissCrewBoardingToast;

  useEffect(() => {
    if (crewBoardingToasts.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      for (const toast of crewBoardingToasts) {
        if (toast.expiresAt < now) {
          onDismissRef.current(toast.id);
        }
      }
    }, AUTO_DISMISS_INTERVAL_MS);
    return () => clearInterval(id);
  }, [crewBoardingToasts]);

  // Slice to MAX_CREW_TOASTS; oldest entries (lowest index) are dropped first
  // when the queue exceeds the cap (producer side enforces this in Task 11,
  // but guard here too).
  const visibleToasts = crewBoardingToasts.slice(0, MAX_CREW_TOASTS);

  // TODO Task 11: wire onAddToAllowlist to the real ScIntegration allowlist mutation.
  async function handleAddToAllowlist(_rsiHandle: string): Promise<void> {
    // Stubbed — Task 11 will replace this with the real implementation.
  }

  // When admin board is open, render it full-screen instead of the normal content
  if (showAdmin) {
    return <AdminBoard client={client} onClose={() => setShowAdmin(false)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-400">Hailfreq</h1>
          <p className="text-xs text-slate-500">{client.getSafeUserId()}</p>
        </div>
        <div className="flex gap-2">
          {adminCaps?.isAnyAdmin && (
            <Button variant="ghost" onClick={() => setShowAdmin(true)}>
              Admin
            </Button>
          )}
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New net
          </Button>
          <Button
            variant="ghost"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              await onLogout();
            }}
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </div>
      </header>

      {/* Crew-boarding toast stack — fixed top-right, max 3 visible */}
      {visibleToasts.length > 0 && (
        <div className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
          {visibleToasts.map((toast) => (
            <CrewBoardingToast
              key={toast.id}
              client={client}
              rsiHandle={toast.rsiHandle}
              matrixUserId={toast.matrixUserId}
              shipNetRoomId={toast.shipNetRoomId}
              shipType={toast.shipType}
              onDismiss={() => onDismissCrewBoardingToast(toast.id)}
              onAddToAllowlist={handleAddToAllowlist}
            />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <NetListPanel
          client={client}
          serverEntry={serverEntry}
          onTransmittingChange={onTransmittingChange}
        />
      </div>

      {creating && (
        <CreateNetDialog
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(_roomId) => {
            // NetListPanel re-syncs from Matrix events; nothing else to do
          }}
        />
      )}
    </div>
  );
}
