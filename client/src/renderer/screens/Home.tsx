import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { BridgeConfig, FocusedAppPttSettings, ServerEntry } from "@shared/types";
import type { BridgeRunnerStatus } from "../bridge/types";
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
import type { VoiceEngine } from "../voice/VoiceEngine";
import type { ShareEngine } from "../share/ShareEngine";
import type { ActiveShareSummary, LocalShareState } from "../share/types";
import { SharingStatusBar } from "../components/SharingStatusBar";
import { listNets } from "../matrix/nets";

/** Max toasts shown simultaneously. */
const MAX_CREW_TOASTS = 3;
/** Auto-dismiss interval in ms. */
const AUTO_DISMISS_INTERVAL_MS = 1000;

interface HomeProps {
  client: MatrixClient;
  /**
   * Shared VoiceEngine for this server — created at AppState level and passed
   * down so NetListPanel does not create a duplicate instance.
   * May be undefined if the server is not yet signed in (shouldn't occur at
   * "home" screen, but kept optional for safety).
   */
  voiceEngine?: VoiceEngine;
  /**
   * Shared ShareEngine for this server — created at AppState level alongside
   * voiceEngine. Forwarded to NetListPanel for attachRoom/detachRoom calls.
   */
  shareEngine?: ShareEngine;
  /**
   * Active remote shares for this server, mirrored from React state (AppState).
   * Forwarded to NetListPanel so it re-renders reactively when shares start/end.
   */
  activeShares: ActiveShareSummary[];
  /**
   * The local user's current share state, mirrored from AppState React state.
   * Used to render the SharingStatusBar when the local user is sharing.
   */
  localShare: LocalShareState | null;
  onLogout: () => Promise<void> | void;
  serverEntry: ServerEntry;
  onTransmittingChange: (net: string | null) => void;
  /**
   * Crew-boarding toasts to display. Populated by ScIntegration when SC
   * integration is enabled; otherwise empty.
   */
  crewBoardingToasts: CrewBoardingToastEntry[];
  /** Called when a toast is dismissed (by user action or auto-expire). */
  onDismissCrewBoardingToast: (toastId: string) => void;
  /** Add an RSI handle to this server's SC integration auto-invite allowlist. */
  onAddToAllowlist: (rsiHandle: string) => Promise<void>;
  /** Global focused-app PTT filter settings. Forwarded to NetListPanel. */
  focusedAppPtt?: FocusedAppPttSettings;
  /** Global bridge configs. Forwarded to AdminBoard. */
  bridges: BridgeConfig[];
  /** Live runner statuses from BridgeEngine. Forwarded to AdminBoard. */
  bridgeRunnerStatuses: Map<string, { forward: BridgeRunnerStatus; reverse: BridgeRunnerStatus | null }>;
  /** Save updated bridge configs. Forwarded to AdminBoard. */
  onSaveBridges: (bridges: BridgeConfig[]) => Promise<void>;
  /**
   * All signed-in servers, keyed by serverId. Forwarded to AdminBoard → BridgeEditor
   * so the editor can populate server + net dropdowns.
   */
  serversForEditor: Map<string, { label: string; client: MatrixClient }>;
}

export function Home({
  client,
  voiceEngine,
  shareEngine,
  activeShares,
  localShare,
  onLogout,
  serverEntry,
  onTransmittingChange,
  crewBoardingToasts,
  onDismissCrewBoardingToast,
  onAddToAllowlist,
  focusedAppPtt,
  bridges,
  bridgeRunnerStatuses,
  onSaveBridges,
  serversForEditor,
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

  // Delegate directly to the AppState handler which persists + live-updates
  // the ScIntegration instance for this server.
  async function handleAddToAllowlist(rsiHandle: string): Promise<void> {
    await onAddToAllowlist(rsiHandle);
  }

  /** Resolve the display name for the net the local user is currently sharing to. */
  function resolveNetName(share: LocalShareState | null): string | null {
    if (!share) return null;
    const nets = listNets(client);
    const match = nets.find((n) => n.matrixRoomId === share.matrixRoomId);
    if (match) return match.properties.name;
    // Fallback: strip leading "!" and server part from the room id
    return share.matrixRoomId.split(":")[0].replace("!", "");
  }

  // When admin board is open, render it full-screen instead of the normal content
  if (showAdmin) {
    return (
      <AdminBoard
        client={client}
        servers={serversForEditor}
        bridges={bridges}
        runnerStatuses={bridgeRunnerStatuses}
        onSaveBridges={onSaveBridges}
        onClose={() => setShowAdmin(false)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SharingStatusBar
        localShare={localShare}
        netName={resolveNetName(localShare)}
        onStop={() => void shareEngine?.stopLocalShare()}
      />
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
          voiceEngine={voiceEngine}
          shareEngine={shareEngine}
          activeShares={activeShares}
          localShare={localShare}
          serverEntry={serverEntry}
          onTransmittingChange={onTransmittingChange}
          focusedAppPtt={focusedAppPtt}
          bridges={bridges}
          bridgeRunnerStatuses={bridgeRunnerStatuses}
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
