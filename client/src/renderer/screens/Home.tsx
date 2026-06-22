import { useEffect, useMemo, useRef, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";
import type { BridgeConfig, FocusedAppPttSettings, ServerEntry } from "@shared/types";
import type { BridgeRunnerStatus } from "../bridge/types";
import { Button } from "../components/Button";
import { NetListPanel } from "../components/NetListPanel";
import { CreateNetDialog } from "../components/CreateNetDialog";
import { ModeTabBar, type SidebarMode } from "../components/ModeTabBar";
import { LoungeSidebar } from "../components/LoungeSidebar";
import { OperationsSidebar } from "../components/OperationsSidebar";
import { ChannelMainPanel } from "../components/ChannelMainPanel";
import { VoiceChannelView } from "../components/VoiceChannelView";
import { RosterPanel } from "../components/RosterPanel";
import { CreateOperationDialog } from "../components/CreateOperationDialog";
import { InviteToOperationModal } from "../components/InviteToOperationModal";
import { toggleExpanded } from "../components/channelListHelpers";
import { resolveSelectedChannel } from "../components/selectedChannelHelpers";
import { ChannelType } from "../matrix/channelTypes";
import type { HierarchyNode } from "../matrix/hierarchyTypes";
import type { Operation } from "../matrix/operationTypes";
import { buildLoungeTree, buildOperationTree } from "../matrix/hierarchyBuilder";
import { listOperations, getRoster } from "../matrix/operations";
import { watchOperationActivation, placeUserInOperation } from "../matrix/autoPlacement";
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
import { listNets, subscribeToNetsChanges, NET_PRIORITY_EVENT } from "../matrix/nets";
import { AudioSetupWizard } from "./AudioSetupWizard";

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

  // ── Text/voice channel + operations-mode UI state ──────────────────────────
  // Session-only (mirrors how the existing "selected net" UI state is held as
  // Home-local state). There is no per-server settings field reachable here for
  // persisting `mode`/`selectedOperationId`, so these reset on reload — noted in
  // the wiring report.
  const [mode, setMode] = useState<SidebarMode>("lounge");
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [creatingOp, setCreatingOp] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rosterUserIds, setRosterUserIds] = useState<ReadonlySet<string>>(new Set());

  // Operations list for the rail selector — refreshed on Matrix state changes
  // (operation create/activate) and on dialog close.
  const [operations, setOperations] = useState<Operation[]>([]);
  // Lounge hierarchy (nets → channels) and operation hierarchy trees.
  const [loungeNodes, setLoungeNodes] = useState<HierarchyNode[]>([]);
  const [opNodes, setOpNodes] = useState<HierarchyNode[]>([]);
  // Nets the local user is invited to but has not yet joined ("Available to Join").
  // On rpk.chat nets are private_chat, so they never surface via publicRooms;
  // they arrive as room invites carrying the net priority state event.
  const [availableNets, setAvailableNets] = useState<HierarchyNode[]>([]);

  // Discord-style sidebar participant display: poll voiceEngine every 500 ms to
  // build per-net participant and speaker maps for the lounge sidebar.
  const [voiceParticipants, setVoiceParticipants] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const [activeSpeakers, setActiveSpeakers] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

  // Refresh the operations list from joined rooms when Matrix state changes.
  useEffect(() => {
    const refresh = () => setOperations(listOperations(client));
    refresh();
    return subscribeToNetsChanges(client, refresh);
  }, [client]);

  // Refresh the "Available to Join" list: rooms the local user is invited to
  // (membership === "invite") that carry the net priority state event.
  useEffect(() => {
    const refresh = () => {
      const nodes: HierarchyNode[] = client
        .getRooms()
        .filter((r) => r.getMyMembership() === "invite")
        .filter((r) => r.currentState.getStateEvents(NET_PRIORITY_EVENT, ""))
        .map((r) => ({
          id: r.roomId,
          name: r.name ?? r.roomId,
          type: "net" as const,
          children: [],
        }));
      setAvailableNets(nodes);
    };
    refresh();
    return subscribeToNetsChanges(client, refresh);
  }, [client]);

  // Poll voiceEngine every 500 ms to refresh participant/speaker maps used by
  // the lounge sidebar's Discord-style participant sub-rows.
  useEffect(() => {
    if (!voiceEngine) return;
    const poll = () => {
      const participants = new Map<string, readonly string[]>();
      const speakers = new Map<string, ReadonlySet<string>>();
      for (const node of loungeNodes) {
        const netId = node.id;
        const ids = voiceEngine.getConnectedParticipantIds(netId);
        if (ids.length > 0) {
          participants.set(netId, ids);
          speakers.set(netId, new Set(voiceEngine.getActiveSpeakers(netId)));
        }
      }
      setVoiceParticipants(participants);
      setActiveSpeakers(speakers);
    };
    poll();
    const id = setInterval(poll, 500);
    return () => clearInterval(id);
  }, [voiceEngine, loungeNodes]);

  // Build the lounge hierarchy tree (nets + nested channels) whenever the net
  // rooms change. netRooms are sourced the same way NetListPanel sources nets:
  // listNets → resolve each matrixRoomId back to a Room object.
  // subscribeToNetsChanges fires on bursty Matrix events and each rebuild issues
  // one getRoomHierarchy per net, so the rebuild is debounced to collapse bursts.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const build = () => {
      const netRooms = listNets(client)
        .map((n) => client.getRoom(n.matrixRoomId))
        .filter((r): r is Room => r != null);
      void buildLoungeTree(client, netRooms).then((nodes) => {
        if (!cancelled) setLoungeNodes(nodes);
      });
    };
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(build, 150);
    };
    build();
    const unsub = subscribeToNetsChanges(client, refresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [client]);

  // Build the operation hierarchy tree when an operation is selected in ops mode.
  useEffect(() => {
    if (mode !== "ops" || !selectedOperationId) {
      setOpNodes([]);
      return;
    }
    let cancelled = false;
    void buildOperationTree(client, selectedOperationId).then((nodes) => {
      if (!cancelled) setOpNodes(nodes);
    });
    return () => {
      cancelled = true;
    };
  }, [client, mode, selectedOperationId]);

  // Auto-placement: when an operation transitions to ACTIVE, join the local
  // user's assigned channels per the roster. Subscribed for the lifetime of the
  // home screen (i.e. while the Matrix client is ready) and torn down on unmount.
  useEffect(() => {
    const unsub = watchOperationActivation(client, (opId) => {
      const userId = client.getUserId();
      if (!userId) return;
      void placeUserInOperation(client, opId, userId);
    });
    return unsub;
  }, [client]);

  // The currently-active hierarchy nodes (lounge vs ops) — used to resolve the
  // selected channel into a Channel + parent-net name for the main panel.
  const activeNodes = mode === "ops" ? opNodes : loungeNodes;

  const selected = useMemo(
    () =>
      selectedChannelId
        ? resolveSelectedChannel(client, selectedChannelId, activeNodes)
        : null,
    [client, selectedChannelId, activeNodes],
  );

  const selectedOperation =
    operations.find((op) => op.id === selectedOperationId) ?? null;

  function handleSetMode(next: SidebarMode) {
    setMode(next);
    setSelectedChannelId(null);
  }

  function handleSelectOperation(id: string) {
    setSelectedOperationId(id);
    setSelectedChannelId(null);
  }

  function handleToggleExpand(id: string) {
    setExpandedIds((prev) => toggleExpanded(prev, id));
  }

  function handleOpenInvite() {
    if (!selectedOperationId) return;
    const roster = getRoster(client, selectedOperationId);
    setRosterUserIds(new Set(roster.entries.map((e) => e.userId)));
    setInviteOpen(true);
  }

  // First-run audio wizard — null while loading, false = show wizard, true = done
  const [audioSetupComplete, setAudioSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    void window.hailfreq.invoke("settings:get").then((s) => {
      setAudioSetupComplete(!!s.audioSetupComplete);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const recompute = () => {
      if (cancelled) return;
      void detectAdminCapabilities(client).then((caps) => {
        if (!cancelled) setAdminCaps(caps);
      });
    };
    recompute();

    // Re-run when membership / power level changes, or rooms are created
    const events = ["Room", "Room.myMembership", "RoomState.events"];
    for (const evt of events) {
      client.on(evt as never, recompute as never);
    }
    return () => {
      cancelled = true;
      for (const evt of events) {
        client.off(evt as never, recompute as never);
      }
    };
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

  /** Resolve a Matrix user ID to a display name for sidebar participant sub-rows. */
  function resolveDisplayName(userId: string): string {
    // Try to find the member in any joined room where we know them
    for (const room of client.getRooms()) {
      const member = room.getMember(userId);
      if (member?.name) return member.name;
    }
    return userId.split(":")[0].replace("@", "");
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

  // Show first-run audio wizard until the user completes or skips it.
  // null = still loading settings (don't flash wizard), false = show wizard.
  if (audioSetupComplete === false) {
    return <AudioSetupWizard onComplete={() => setAudioSetupComplete(true)} />;
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

  // The existing voice-centric net UI. Reused in two places:
  //   1. As the default lounge-mode content (when no channel is selected), so
  //      all current voice controls (monitor, PTT, share) stay reachable.
  //   2. As the `voiceContent` slot of MainPanel when a VOICE channel is
  //      selected, per the spec's text/voice toggle.
  const netListPanel = (
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
  );

  // Decide what the main area renders:
  //   - A channel is selected (text or voice) → MainPanel via ChannelMainPanel.
  //       Voice channels forward the netListPanel into the voiceContent slot.
  //   - Nothing selected → the existing NetListPanel (lounge) or the ops sidebar
  //       prompt (handled by the sidebar itself), with NetListPanel as a stable
  //       fallback so voice is always reachable.
  let mainArea: React.ReactNode;
  if (selected) {
    mainArea = (
      <ChannelMainPanel
        client={client}
        channel={selected.channel}
        netName={selected.netName}
        onSelectChannel={setSelectedChannelId}
        voiceContent={
          selected.channel.type === ChannelType.VOICE ? (
            <VoiceChannelView
              client={client}
              netId={selected.channel.netId}
              netName={selected.netName}
              channelName={selected.channel.name}
              voiceEngine={voiceEngine}
              serverEntry={serverEntry}
              onTransmittingChange={onTransmittingChange}
              focusedAppPtt={focusedAppPtt}
            />
          ) : undefined
        }
      />
    );
  } else {
    mainArea = <div className="h-full overflow-auto">{netListPanel}</div>;
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

      {/* Mode rail | channel sidebar | main area */}
      <div className="flex min-h-0 flex-1">
        {/* Mode tabs + operation selector (mini-rail, per the spec). Mounted in
            Home rather than the global server Sidebar — see wiring notes. */}
        <ModeTabBar
          mode={mode}
          onSetMode={handleSetMode}
          operations={operations}
          selectedOperationId={selectedOperationId}
          onSelectOperation={handleSelectOperation}
          onCreateOperation={() => setCreatingOp(true)}
        />

        {/* Channel sidebar — lounge tree or operation hierarchy */}
        <div className="w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-950">
          {mode === "ops" ? (
            <OperationsSidebar
              operation={selectedOperation}
              nodes={opNodes}
              selectedChannelId={selectedChannelId}
              expandedIds={expandedIds}
              onSelectChannel={setSelectedChannelId}
              onToggleExpand={handleToggleExpand}
              onInvite={selectedOperation ? handleOpenInvite : undefined}
              onCreateOperation={() => setCreatingOp(true)}
            />
          ) : (
            <LoungeSidebar
              client={client}
              nodes={loungeNodes}
              availableNets={availableNets}
              selectedChannelId={selectedChannelId}
              expandedIds={expandedIds}
              onSelectChannel={setSelectedChannelId}
              onToggleExpand={handleToggleExpand}
              onJoinNet={(id) => void client.joinRoom(id)}
              voiceParticipants={voiceParticipants}
              activeSpeakers={activeSpeakers}
              localUserId={client.getSafeUserId() ?? undefined}
              resolveDisplayName={resolveDisplayName}
            />
          )}
        </div>

        {/* Main area — channel content or the existing net/voice panel */}
        <div className="min-w-0 flex-1 overflow-hidden">{mainArea}</div>

        {/* Roster — joined members of the selected channel's net */}
        <div className="w-48 shrink-0 border-l border-slate-800 bg-slate-950">
          <RosterPanel
            client={client}
            netId={selected?.channel.netId ?? null}
            voiceEngine={voiceEngine}
          />
        </div>
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

      <CreateOperationDialog
        client={client}
        open={creatingOp}
        onClose={() => setCreatingOp(false)}
        onCreated={(op) => {
          setOperations(listOperations(client));
          setMode("ops");
          setSelectedOperationId(op.id);
        }}
      />

      {inviteOpen && selectedOperation && (
        <InviteToOperationModal
          client={client}
          open={inviteOpen}
          operationId={selectedOperation.id}
          operationName={selectedOperation.name}
          alreadyInRoster={rosterUserIds}
          onClose={() => setInviteOpen(false)}
          onInvited={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}
