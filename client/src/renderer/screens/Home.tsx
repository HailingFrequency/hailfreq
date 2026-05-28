import { useEffect, useState } from "react";
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

interface HomeProps {
  client: MatrixClient;
  onLogout: () => Promise<void> | void;
  serverEntry: ServerEntry;
  onTransmittingChange: (net: string | null) => void;
}

export function Home({ client, onLogout, serverEntry, onTransmittingChange }: HomeProps) {
  const [creating, setCreating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [adminCaps, setAdminCaps] = useState<AdminCapabilities | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    void detectAdminCapabilities(client).then(setAdminCaps);
  }, [client]);

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
