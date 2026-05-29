import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { BridgeConfig } from "@shared/types";
import type { BridgeRunnerStatus } from "../bridge/types";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import {
  buildRoster,
  enrichRosterWithProfiles,
  subscribeToRosterChanges,
  type RosterMember,
} from "../matrix/roster";
import { detectAdminCapabilities, type AdminCapabilities } from "../matrix/permissions";
import { AdminNetList } from "../components/AdminNetList";
import { AdminRoster } from "../components/AdminRoster";
import { AdminDetail } from "../components/AdminDetail";
import { UserSearchDialog } from "../components/UserSearchDialog";
import { Button } from "../components/Button";
import { BridgesPanel } from "./BridgesPanel";
import { BridgeEditor } from "./BridgeEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminTab = "roster" | "bridges";

/** Editor state: closed, or open for a new bridge, or open editing an existing one. */
type EditorState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "edit"; bridge: BridgeConfig };

interface AdminBoardProps {
  client: MatrixClient;
  /** All signed-in servers, keyed by serverId. Used by BridgeEditor for endpoint selection. */
  servers: Map<string, { label: string; client: MatrixClient }>;
  bridges: BridgeConfig[];
  runnerStatuses: Map<string, { forward: BridgeRunnerStatus; reverse: BridgeRunnerStatus | null }>;
  onSaveBridges: (bridges: BridgeConfig[]) => Promise<void>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminBoard({
  client,
  servers,
  bridges,
  runnerStatuses,
  onSaveBridges,
  onClose,
}: AdminBoardProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [caps, setCaps] = useState<AdminCapabilities | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("roster");
  const [editorState, setEditorState] = useState<EditorState>({ kind: "closed" });

  useEffect(() => {
    const refresh = () => {
      const currentNets = listNets(client);
      setNets(currentNets);
      const baseRoster = buildRoster(client, currentNets);
      setRoster(baseRoster);
      // Asynchronously enrich with CitizenID profiles; triggers a re-render only if data changed
      void enrichRosterWithProfiles(client, baseRoster, setRoster);
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
        <p className="text-slate-300">You don&apos;t have admin permissions on any net.</p>
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
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-400">Admin Board</h1>
          <p className="text-xs text-slate-500">
            {nets.length} nets · {roster.length} operators
            {caps.isServerAdmin && " · Server admin"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "roster" && selectedNetId && caps.adminNets.has(selectedNetId) && (
            <Button variant="ghost" onClick={() => setShowInvite(true)}>
              + Invite user
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Back to Home
          </Button>
        </div>
      </header>

      {/* Tab strip */}
      <nav className="flex border-b border-slate-800 px-6">
        <TabButton
          active={activeTab === "roster"}
          onClick={() => setActiveTab("roster")}
        >
          Members &amp; Nets
        </TabButton>
        <TabButton
          active={activeTab === "bridges"}
          onClick={() => setActiveTab("bridges")}
        >
          Bridges
        </TabButton>
      </nav>

      {/* Tab content */}
      {activeTab === "roster" && (
        <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
          <div className="overflow-auto border-r border-slate-800">
            <AdminNetList
              client={client}
              nets={nets}
              selectedNetId={selectedNetId}
              onSelect={setSelectedNetId}
              adminNetIds={caps.adminNets}
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
      )}

      {activeTab === "bridges" && (
        <div className="flex-1 overflow-auto">
          <BridgesPanel
            bridges={bridges}
            runnerStatuses={runnerStatuses}
            onSave={onSaveBridges}
            onNew={() => setEditorState({ kind: "new" })}
            onEdit={(bridge) => setEditorState({ kind: "edit", bridge })}
          />
          {editorState.kind === "new" && (
            <BridgeEditor
              initial={null}
              servers={servers}
              onSave={async (bridge) => {
                await onSaveBridges([...bridges, bridge]);
                setEditorState({ kind: "closed" });
              }}
              onCancel={() => setEditorState({ kind: "closed" })}
            />
          )}
          {editorState.kind === "edit" && (
            <BridgeEditor
              initial={editorState.bridge}
              servers={servers}
              onSave={async (bridge) => {
                await onSaveBridges(
                  bridges.map((b) => (b.id === bridge.id ? bridge : b)),
                );
                setEditorState({ kind: "closed" });
              }}
              onCancel={() => setEditorState({ kind: "closed" })}
            />
          )}
        </div>
      )}

      {showInvite && selectedNetId && (
        <UserSearchDialog
          client={client}
          targetNetId={selectedNetId}
          targetNetName={
            nets.find((n) => n.matrixRoomId === selectedNetId)?.properties.name ??
            selectedNetId
          }
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button helper
// ---------------------------------------------------------------------------

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={[
        "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-400 text-brand-400"
          : "border-transparent text-slate-400 hover:text-slate-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
