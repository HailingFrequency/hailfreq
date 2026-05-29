import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { FocusedAppPttSettings, NetPreferences, ServerEntry } from "@shared/types";
import type { ChirpSummary } from "@shared/ipc";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import { NetRow } from "./NetRow";
import { VoiceEngine } from "../voice/VoiceEngine";
import { PttController, type PttMode } from "../voice/PttController";
import type { ShareEngine } from "../share/ShareEngine";
import type { ActiveShareSummary, LocalShareState } from "../share/types";
import { SourcePickerModal } from "../share/SourcePickerModal";
import { ShareViewerPane } from "../share/ShareViewerPane";
import { acquireDisplayStream } from "../share/acquireDisplayStream";


interface NetListPanelProps {
  client: MatrixClient;
  /**
   * VoiceEngine shared from AppState. When provided, NetListPanel uses this
   * instance instead of creating its own, so that ScIntegration (which also
   * holds a reference to the same engine) can share the same audio context and
   * net-monitoring state.
   * If absent (legacy / test), a local engine is created as before.
   */
  voiceEngine?: VoiceEngine;
  /**
   * ShareEngine shared from AppState. When provided, NetListPanel calls
   * attachRoom after monitorNet and detachRoom before unmonitorNet so the
   * ShareEngine tracks screen-shares for all monitored nets.
   */
  shareEngine?: ShareEngine;
  /**
   * Active remote shares for this server, mirrored from AppState React state.
   * Using this instead of shareEngine.getActiveShares() ensures NetListPanel
   * re-renders reactively when remote shares start or end.
   */
  activeShares?: ActiveShareSummary[];
  serverEntry: ServerEntry;
  onTransmittingChange: (net: string | null) => void;
  /**
   * Global focused-app PTT filter settings. When provided, key-press events
   * are gated on the focused application matching an allowlist entry.
   * Key-release events are never gated.
   */
  focusedAppPtt?: FocusedAppPttSettings;
}

const DEFAULT_OUTBOUND_CHIRP = "builtin:click";
const DEFAULT_INBOUND_CHIRP = "builtin:classic-two-tone";

interface PerNetUiState {
  monitored: boolean;
  volume: number;
  activeSpeakers: number;
  pttMode: PttMode;
  keybind: string | null;
  voiceThresholdDb: number;
  keybindError: string | null;
  outboundChirp: string;
  inboundChirp: string;
}

function defaultUi(): PerNetUiState {
  return {
    monitored: false,
    volume: 1.0,
    activeSpeakers: 0,
    pttMode: "toggle",
    keybind: null,
    voiceThresholdDb: -45,
    keybindError: null,
    outboundChirp: DEFAULT_OUTBOUND_CHIRP,
    inboundChirp: DEFAULT_INBOUND_CHIRP,
  };
}

/** Build initial per-net UI state from persisted voicePrefs for a given net. */
function initialUiForNet(
  matrixRoomId: string,
  voicePrefs: NetPreferences | undefined,
): PerNetUiState {
  const base = defaultUi();
  if (!voicePrefs) return base;
  return {
    ...base,
    volume: voicePrefs.volumes[matrixRoomId] ?? base.volume,
    keybind: voicePrefs.keybinds[matrixRoomId] ?? base.keybind,
    pttMode: (voicePrefs.pttModes[matrixRoomId] as PttMode | undefined) ?? base.pttMode,
    voiceThresholdDb: voicePrefs.voiceThresholds[matrixRoomId] ?? base.voiceThresholdDb,
    monitored: voicePrefs.monitored.includes(matrixRoomId),
    outboundChirp: (voicePrefs.outboundChirps ?? {})[matrixRoomId] ?? base.outboundChirp,
    inboundChirp: (voicePrefs.inboundChirps ?? {})[matrixRoomId] ?? base.inboundChirp,
  };
}

/** Derive a NetPreferences snapshot from the current uiState map (excluding activeSpeakers). */
function buildNetPreferences(uiState: Map<string, PerNetUiState>): NetPreferences {
  const prefs: NetPreferences = {
    volumes: {},
    keybinds: {},
    pttModes: {},
    voiceThresholds: {},
    monitored: [],
    outboundChirps: {},
    inboundChirps: {},
  };
  for (const [roomId, ui] of uiState) {
    prefs.volumes[roomId] = ui.volume;
    if (ui.keybind !== null) prefs.keybinds[roomId] = ui.keybind;
    prefs.pttModes[roomId] = ui.pttMode;
    prefs.voiceThresholds[roomId] = ui.voiceThresholdDb;
    if (ui.monitored) prefs.monitored.push(roomId);
    prefs.outboundChirps[roomId] = ui.outboundChirp;
    prefs.inboundChirps[roomId] = ui.inboundChirp;
  }
  return prefs;
}

export function NetListPanel({ client, voiceEngine: externalEngine, shareEngine, activeShares = [], serverEntry, onTransmittingChange, focusedAppPtt }: NetListPanelProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [uiState, setUiState] = useState<Map<string, PerNetUiState>>(new Map());
  // Use the shared engine from AppState when available; fall back to a local
  // instance for backwards compatibility (tests, storybook, etc.).
  const [localEngine] = useState(() => externalEngine ?? new VoiceEngine(client));
  // Stable ref so effects always see the current engine without re-subscribing
  const engineRef = useRef<VoiceEngine>(localEngine);
  engineRef.current = externalEngine ?? localEngine;
  const engine = engineRef.current;
  const [ptt] = useState(() => new PttController(engine));
  const [transmitting, setTransmitting] = useState<string | null>(null);
  const [availableChirps, setAvailableChirps] = useState<ChirpSummary[]>([]);

  // Share UI state
  // localShare mirrors ShareEngine.getLocalShare() and is updated via event subscription.
  // NOTE: ShareEngine.on() merges listeners and does not support deduplication — calling
  // it on each remount would accumulate stale closures. This is acceptable for v1 because
  // NetListPanel does not remount frequently; the shareEngine is replaced wholesale on logout.
  const [localShare, setLocalShare] = useState<LocalShareState | null>(
    () => shareEngine?.getLocalShare() ?? null,
  );
  // pickerForRoomId: non-null while the SourcePickerModal is open for a specific net
  const [pickerForRoomId, setPickerForRoomId] = useState<string | null>(null);
  // viewingShare: set when the user clicks the 📺 viewer button (Task 7 renders the pane)
  const [viewingShare, setViewingShare] = useState<ActiveShareSummary | null>(null);
  // shareError: inline error shown when acquireDisplayStream or startLocalShare fails
  const [shareError, setShareError] = useState<string | null>(null);

  // Expose the VoiceEngine for Plan 4/5 E2E tests when running under HAILFREQ_TEST=1.
  // This lets Playwright's page.evaluate() reach the engine without requiring a real UI action.
  useEffect(() => {
    if (process.env.HAILFREQ_TEST === "1") {
      (window as any).__voiceEngine = engine;
    }
    return () => {
      if (process.env.HAILFREQ_TEST === "1") {
        delete (window as any).__voiceEngine;
      }
    };
  }, [engine]);

  // Track whether initial seed from voicePrefs has been applied
  const seededRef = useRef(false);

  // Keep a live ref of focusedAppPtt so the gate provider closure always reads
  // the current settings without stale-closure issues.
  const focusedAppPttRef = useRef<FocusedAppPttSettings | undefined>(focusedAppPtt);
  focusedAppPttRef.current = focusedAppPtt;

  // Wire the focus-gate config provider into the PttController once on mount.
  // The closure reads from the ref, so it stays current across every re-render.
  useEffect(() => {
    ptt.setFocusGateConfig(() => ({
      enabled: focusedAppPttRef.current?.enabled ?? false,
      allowlist: focusedAppPttRef.current?.allowlistEntries ?? [],
    }));
    // ptt is stable (created via useState initialiser) — this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt]);

  // Persist a prefs snapshot back to the store
  const persistPrefs = useCallback(
    (nextUiState: Map<string, PerNetUiState>) => {
      const voicePrefs = buildNetPreferences(nextUiState);
      void window.hailfreq
        .invoke("servers:update", {
          serverId: serverEntry.id,
          patch: { voicePrefs },
        })
        .catch((err: unknown) => {
          console.error("Failed to persist voicePrefs:", err);
        });
    },
    [serverEntry.id],
  );

  // Fetch available chirps once on mount
  useEffect(() => {
    void window.hailfreq
      .invoke("chirps:list")
      .then((chirps) => setAvailableChirps(chirps))
      .catch((err: unknown) => console.error("Failed to list chirps:", err));
  }, []);

  // Refresh net list on Matrix changes
  useEffect(() => {
    const refresh = () => setNets(listNets(client));
    refresh();
    return subscribeToNetsChanges(client, refresh);
  }, [client]);

  // Seed uiState from persisted voicePrefs once the net list is first populated
  useEffect(() => {
    if (seededRef.current || nets.length === 0) return;
    seededRef.current = true;
    setUiState(() => {
      const seeded = new Map<string, PerNetUiState>();
      for (const net of nets) {
        seeded.set(net.matrixRoomId, initialUiForNet(net.matrixRoomId, serverEntry.voicePrefs));
      }
      return seeded;
    });
  }, [nets, serverEntry.voicePrefs]);

  // Wire voice engine active-speaker events to UI state
  useEffect(() => {
    engine.on("activeSpeakersChanged", (matrixRoomId, identities) => {
      setUiState((m) => {
        const next = new Map(m);
        const existing = next.get(matrixRoomId) ?? defaultUi();
        next.set(matrixRoomId, { ...existing, activeSpeakers: identities.length });
        return next;
      });
    });
  }, [engine]);

  // Wire PTT state changed events from voice engine
  useEffect(() => {
    engine.on("pttStateChanged", (matrixRoomId) => {
      setTransmitting(matrixRoomId);
      onTransmittingChange(matrixRoomId);
    });
  }, [engine, onTransmittingChange]);

  // Poll PTT transmitting state (cheap, runs only when ptt reference changes)
  useEffect(() => {
    const i = setInterval(() => setTransmitting(ptt.getTransmittingNet()), 100);
    return () => clearInterval(i);
  }, [ptt]);

  // Subscribe to ShareEngine local-share events so localShare state stays
  // in sync with engine state across start/stop without polling.
  useEffect(() => {
    if (!shareEngine) return;
    const update = () => setLocalShare(shareEngine.getLocalShare());
    shareEngine.on({
      onLocalShareStarted: update,
      onLocalShareEnded: update,
    });
    // No off() method on ShareEngine v1 — listeners are merged and cleared
    // wholesale on shareEngine.shutdown() (which happens on logout).
    return () => {/* no-op for v1 */};
  }, [shareEngine]);

  // Shutdown ptt controller on unmount.
  // The VoiceEngine is NOT shut down here when it was provided externally —
  // AppState owns the engine's lifetime and will shut it down alongside the
  // ClientHandle on logout / server removal.
  useEffect(() => {
    return () => {
      void ptt.shutdown();
      if (!externalEngine) {
        void localEngine.shutdown();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt]);

  async function handlePickerResult(
    selection: { source: import("@shared/ipc").DesktopCaptureSource; captureAudio: boolean } | null,
  ) {
    if (!selection) {
      setPickerForRoomId(null);
      return;
    }
    if (!shareEngine || !pickerForRoomId) {
      setPickerForRoomId(null);
      return;
    }
    const roomId = pickerForRoomId;
    setPickerForRoomId(null);
    try {
      const stream = await acquireDisplayStream(selection.source, selection.captureAudio);
      await shareEngine.startLocalShare(roomId, stream);
      setShareError(null);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Failed to start share");
    }
  }

  function handleStopShare() {
    if (!shareEngine) return;
    void shareEngine.stopLocalShare();
  }

  async function handleToggleMonitor(net: NetSummary) {
    const current = uiState.get(net.matrixRoomId) ?? defaultUi();
    if (current.monitored) {
      // Detach ShareEngine BEFORE unmonitorNet — the LiveKit Room is still
      // valid during disconnect, so listeners are cleanly removed.
      shareEngine?.detachRoom(net.matrixRoomId);
      await engine.unmonitorNet(net.matrixRoomId);
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: false, activeSpeakers: 0 });
        persistPrefs(next);
        return next;
      });
    } else {
      // Push chirp selection into the engine before monitoring so the first PTT
      // uses the correct chirp IDs.
      engine.setChirps(net.matrixRoomId, {
        inbound: current.inboundChirp,
        outbound: current.outboundChirp,
      });
      try {
        await engine.monitorNet({
          matrixRoomId: net.matrixRoomId,
          priority: net.properties.priority,
        });
        // Attach ShareEngine AFTER monitorNet resolves so the LiveKit Room exists.
        shareEngine?.attachRoom(net.matrixRoomId);
      } catch (err) {
        // monitorNet failed (e.g. LiveKit token error) — do not attach ShareEngine.
        throw err;
      }
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: true });
        persistPrefs(next);
        return next;
      });
    }
  }

  function handleChirpChange(
    matrixRoomId: string,
    kind: "inbound" | "outbound",
    chirpId: string,
  ): void {
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      const updated: PerNetUiState =
        kind === "inbound"
          ? { ...existing, inboundChirp: chirpId }
          : { ...existing, outboundChirp: chirpId };
      next.set(matrixRoomId, updated);
      // Update the engine in real-time so changes take effect without re-monitoring
      engine.setChirps(matrixRoomId, {
        inbound: updated.inboundChirp,
        outbound: updated.outboundChirp,
      });
      persistPrefs(next);
      return next;
    });
  }

  function handleVolume(matrixRoomId: string, volume: number) {
    engine.setNetVolume(matrixRoomId, volume);
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, volume });
      persistPrefs(next);
      return next;
    });
  }

  async function handlePttModeChange(matrixRoomId: string, mode: PttMode) {
    const current = uiState.get(matrixRoomId) ?? defaultUi();
    // Unbind the current mode before switching
    await ptt.unbind(matrixRoomId);
    setUiState((m) => {
      const next = new Map(m);
      next.set(matrixRoomId, { ...current, pttMode: mode, keybind: null });
      persistPrefs(next);
      return next;
    });
    // Auto-bind voice mode immediately (no keybind needed)
    if (mode === "voice") {
      const result = await ptt.bind({
        matrixRoomId,
        mode: "voice",
        voiceThresholdDb: current.voiceThresholdDb,
      });
      if (!result.ok) {
        console.error(`Failed to enable voice activation: ${result.error}`);
      }
    }
  }

  async function handleKeybindChange(matrixRoomId: string, accel: string) {
    const current = uiState.get(matrixRoomId) ?? defaultUi();
    const result = await ptt.bind({
      matrixRoomId,
      mode: current.pttMode,
      accelerator: accel,
    });
    if (!result.ok) {
      setUiState((m) => {
        const next = new Map(m);
        const existing = next.get(matrixRoomId) ?? defaultUi();
        next.set(matrixRoomId, { ...existing, keybindError: result.error ?? "Failed to bind" });
        return next;
      });
      return;
    }
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, keybind: accel, keybindError: null });
      persistPrefs(next);
      return next;
    });
  }

  async function handleKeybindClear(matrixRoomId: string) {
    await ptt.unbind(matrixRoomId);
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, keybind: null });
      persistPrefs(next);
      return next;
    });
  }

  async function handleVoiceThresholdChange(matrixRoomId: string, db: number) {
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, voiceThresholdDb: db });
      persistPrefs(next);
      return next;
    });
    // Re-bind voice mode with the updated threshold
    await ptt.bind({
      matrixRoomId,
      mode: "voice",
      voiceThresholdDb: db,
    });
  }

  if (nets.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        <p>No nets yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          An admin can create one via the "+" button.
        </p>
      </div>
    );
  }

  // Group: ship-nets first (alphabetical), then regular nets (priority order, already sorted)
  const shipNets = nets
    .filter((n) => n.isShipNet)
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  const regularNets = nets.filter((n) => !n.isShipNet);

  function renderNetRow(net: (typeof nets)[number]) {
    const ui = uiState.get(net.matrixRoomId) ?? defaultUi();
    // Derive per-row share state from React state (not engine direct read)
    // so NetListPanel re-renders reactively when remote shares appear/disappear.
    const rowActiveShare =
      activeShares.find((s) => s.matrixRoomId === net.matrixRoomId) ?? null;
    const rowLocalShare =
      localShare?.matrixRoomId === net.matrixRoomId ? localShare : null;
    const anyLocalShareActive = localShare !== null;
    return (
      <NetRow
        key={net.matrixRoomId}
        net={net}
        monitored={ui.monitored}
        volume={ui.volume}
        activeSpeakers={ui.activeSpeakers}
        transmitting={transmitting === net.matrixRoomId}
        isShipNet={net.isShipNet}
        pttMode={ui.pttMode}
        keybind={ui.keybind}
        keybindError={ui.keybindError}
        voiceThresholdDb={ui.voiceThresholdDb}
        outboundChirp={ui.outboundChirp}
        inboundChirp={ui.inboundChirp}
        availableChirps={availableChirps}
        activeShare={rowActiveShare}
        localShare={rowLocalShare}
        anyLocalShareActive={anyLocalShareActive}
        onToggleMonitor={() => void handleToggleMonitor(net)}
        onVolumeChange={(v) => handleVolume(net.matrixRoomId, v)}
        onPttModeChange={(mode) => void handlePttModeChange(net.matrixRoomId, mode)}
        onKeybindChange={(a) => void handleKeybindChange(net.matrixRoomId, a)}
        onKeybindClear={() => void handleKeybindClear(net.matrixRoomId)}
        onVoiceThresholdChange={(db) => void handleVoiceThresholdChange(net.matrixRoomId, db)}
        onOutboundChirpChange={(id) => handleChirpChange(net.matrixRoomId, "outbound", id)}
        onInboundChirpChange={(id) => handleChirpChange(net.matrixRoomId, "inbound", id)}
        onStartShare={(matrixRoomId) => setPickerForRoomId(matrixRoomId)}
        onStopShare={handleStopShare}
        onOpenViewer={(share) => setViewingShare(share)}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-4">
        {shareError && (
          <div className="rounded border border-rose-500/40 bg-rose-900/20 px-3 py-2 text-xs text-rose-300">
            Share error: {shareError}
            <button
              onClick={() => setShareError(null)}
              className="ml-2 text-rose-400 hover:text-rose-200"
            >
              ✕
            </button>
          </div>
        )}
        {shipNets.length > 0 && (
          <>
            <div className="px-3 pb-1 text-xs uppercase tracking-wider text-slate-500">
              Ships
            </div>
            {shipNets.map(renderNetRow)}
            {regularNets.length > 0 && (
              <div className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-slate-500">
                Nets
              </div>
            )}
          </>
        )}
        {regularNets.map(renderNetRow)}
      </div>

      {/* Source picker modal — open while pickerForRoomId is non-null */}
      {pickerForRoomId && (
        <SourcePickerModal onPick={(selection) => void handlePickerResult(selection)} />
      )}

      {/* Share viewer pane — opens when user clicks the 📺 viewer button on a net row */}
      {viewingShare && (
        <ShareViewerPane
          share={viewingShare}
          onClose={() => setViewingShare(null)}
        />
      )}
    </>
  );
}
