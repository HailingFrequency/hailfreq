import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import { buildRoster, subscribeToRosterChanges, type RosterMember } from "../matrix/roster";
import { detectAdminCapabilities, type AdminCapabilities } from "../matrix/permissions";
import { AdminNetList } from "../components/AdminNetList";
import { AdminRoster } from "../components/AdminRoster";
import { AdminDetail } from "../components/AdminDetail";
import { Button } from "../components/Button";

interface AdminBoardProps {
  client: MatrixClient;
  onClose: () => void;
}

export function AdminBoard({ client, onClose }: AdminBoardProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [caps, setCaps] = useState<AdminCapabilities | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const currentNets = listNets(client);
      setNets(currentNets);
      setRoster(buildRoster(client, currentNets));
    };
    refresh();
    const unsubNets = subscribeToNetsChanges(client, refresh);
    const unsubRoster = subscribeToRosterChanges(client, refresh);
    void detectAdminCapabilities(client).then(setCaps);
    return () => {
      unsubNets();
      unsubRoster();
    };
  }, [client]);

  if (!caps) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-slate-400">Loading admin board…</p>
      </div>
    );
  }

  if (!caps.isAnyAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-slate-300">You don't have admin permissions on any net.</p>
        <p className="text-xs text-slate-500">Power level 100 is required.</p>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
      </div>
    );
  }

  const selectedMember = selectedUserId
    ? (roster.find((m) => m.userId === selectedUserId) ?? null)
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-400">Admin Board</h1>
          <p className="text-xs text-slate-500">
            {nets.length} nets · {roster.length} operators
            {caps.isServerAdmin && " · Server admin"}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Back to Home
        </Button>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
        <div className="overflow-auto border-r border-slate-800">
          <AdminNetList
            client={client}
            nets={nets}
            selectedNetId={selectedNetId}
            onSelect={setSelectedNetId}
          />
        </div>
        <div className="overflow-auto">
          <AdminRoster
            roster={roster}
            nets={nets}
            filterNetId={selectedNetId}
            selectedUserId={selectedUserId}
            onSelect={setSelectedUserId}
          />
        </div>
        <div className="overflow-auto border-l border-slate-800">
          <AdminDetail
            client={client}
            member={selectedMember}
            nets={nets}
            caps={caps}
          />
        </div>
      </div>
    </div>
  );
}
