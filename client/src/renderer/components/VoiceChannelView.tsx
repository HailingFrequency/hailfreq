import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { ChirpSummary } from "@shared/ipc";
import type { FocusedAppPttSettings, ServerEntry } from "@shared/types";
import { listNets, subscribeToNetsChanges, updateNetProperties, type NetSummary } from "../matrix/nets";
import { VoiceEngine } from "../voice/VoiceEngine";
import { PttController, type PttMode } from "../voice/PttController";
import { KeybindCapture } from "./KeybindCapture";
import { MicLevelBar } from "./MicLevelBar";

/**
 * VoiceChannelView — a focused voice view for a SINGLE net.
 *
 * This is the new (post-redesign) replacement for handing the full NetListPanel
 * to ChannelMainPanel's `voiceContent` slot. Where NetListPanel renders every
 * net as a flat card, VoiceChannelView renders just the controls for the one
 * net that the selected voice channel belongs to.
 *
 * It is self-contained: like NetListPanel it owns its own per-net UI state
 * (volume, PTT mode, keybind, chirps, voice threshold) and its own
 * PttController bound to the SHARED VoiceEngine. It seeds that state from the
 * server's persisted voicePrefs and persists changes back via servers:update.
 *
 * ---------------------------------------------------------------------------
 * HOME.TSX INTEGRATION (deferred to a later phase — documented here)
 * ---------------------------------------------------------------------------
 * When a VOICE channel is selected, Home.tsx should pass a VoiceChannelView as
 * the `voiceContent` slot of ChannelMainPanel INSTEAD of `netListPanel`:
 *
 *   voiceContent={
 *     selected.channel.type === ChannelType.VOICE ? (
 *       <VoiceChannelView
 *         client={client}
 *         netId={selected.channel.netId}        // Matrix room ID of the parent net
 *         netName={selected.netName}
 *         channelName={selected.channel.name}   // "voice" or a custom channel name
 *         voiceEngine={voiceEngine}             // the SHARED engine from AppState
 *         serverEntry={serverEntry}
 *         onTransmittingChange={onTransmittingChange}
 *         focusedAppPtt={focusedAppPtt}
 *       />
 *     ) : undefined
 *   }
 *
 * Notes for the Home.tsx phase:
 *   - `netId` must be the parent NET's Matrix room ID (the LiveKit room name is
 *     derived from it), NOT the voice channel's own id. If a channel's id IS the
 *     net room id in this codebase, pass that; otherwise pass channel.netId.
 *   - `voiceEngine` MUST be the shared instance from AppState so monitor/PTT
 *     state is shared with ScIntegration and ShareEngine.
 *   - Screen-share controls are intentionally NOT part of this focused view in
 *     this phase; the lounge-mode NetListPanel still owns the share UX. If share
 *     controls are wanted here later, thread shareEngine/activeShares/localShare
 *     in the same way NetListPanel consumes them.
 * ---------------------------------------------------------------------------
 */
export interface VoiceChannelViewProps {
  client: MatrixClient;
  /** Matrix room ID of the net (used as the LiveKit room key in VoiceEngine). */
  netId: string;
  netName: string;
  /** The voice channel's display name ("voice" or a custom name). */
  channelName: string;
  /**
   * Shared VoiceEngine from AppState. When provided, this view uses it so PTT /
   * monitor / volume state is shared with the rest of the app. A local engine is
   * created as a fallback for tests / storybook.
   */
  voiceEngine?: VoiceEngine;
  /** Server entry — used to seed/persist per-net voicePrefs. */
  serverEntry: ServerEntry;
  /** Bubble the currently-transmitting net id up to AppState (null when idle). */
  onTransmittingChange: (net: string | null) => void;
  /** Global focused-app PTT filter settings (gates key-press, never key-release). */
  focusedAppPtt?: FocusedAppPttSettings;
}

const DEFAULT_OUTBOUND_CHIRP = "builtin:click";
const DEFAULT_INBOUND_CHIRP = "builtin:classic-two-tone";

interface PerNetUiState {
  monitored: boolean;
  volume: number;
  pttMode: PttMode;
  keybind: string | null;
  voiceThresholdDb: number;
  keybindError: string | null;
  outboundChirp: string;
  inboundChirp: string;
}

function defaultUi(serverEntry: ServerEntry, netId: string): PerNetUiState {
  const prefs = serverEntry.voicePrefs;
  const base: PerNetUiState = {
    monitored: false,
    volume: 1.0,
    pttMode: "toggle",
    keybind: null,
    voiceThresholdDb: -45,
    keybindError: null,
    outboundChirp: DEFAULT_OUTBOUND_CHIRP,
    inboundChirp: DEFAULT_INBOUND_CHIRP,
  };
  if (!prefs) return base;
  return {
    ...base,
    volume: prefs.volumes[netId] ?? base.volume,
    keybind: prefs.keybinds[netId] ?? base.keybind,
    pttMode: (prefs.pttModes[netId] as PttMode | undefined) ?? base.pttMode,
    voiceThresholdDb: prefs.voiceThresholds[netId] ?? base.voiceThresholdDb,
    monitored: prefs.monitored.includes(netId),
    outboundChirp: (prefs.outboundChirps ?? {})[netId] ?? base.outboundChirp,
    inboundChirp: (prefs.inboundChirps ?? {})[netId] ?? base.inboundChirp,
  };
}

/**
 * Persist a single net's prefs back to the store, merging into whatever prefs
 * already exist for OTHER nets so we never clobber sibling state.
 */
function persistNetPrefs(
  serverEntry: ServerEntry,
  netId: string,
  ui: PerNetUiState,
): void {
  const prev = serverEntry.voicePrefs;
  const voicePrefs = {
    volumes: { ...(prev?.volumes ?? {}), [netId]: ui.volume },
    keybinds: { ...(prev?.keybinds ?? {}) },
    pttModes: { ...(prev?.pttModes ?? {}), [netId]: ui.pttMode },
    voiceThresholds: { ...(prev?.voiceThresholds ?? {}), [netId]: ui.voiceThresholdDb },
    monitored: (() => {
      const set = new Set(prev?.monitored ?? []);
      if (ui.monitored) set.add(netId);
      else set.delete(netId);
      return Array.from(set);
    })(),
    outboundChirps: { ...(prev?.outboundChirps ?? {}), [netId]: ui.outboundChirp },
    inboundChirps: { ...(prev?.inboundChirps ?? {}), [netId]: ui.inboundChirp },
  };
  if (ui.keybind !== null) voicePrefs.keybinds[netId] = ui.keybind;
  else delete voicePrefs.keybinds[netId];

  void window.hailfreq
    .invoke("servers:update", { serverId: serverEntry.id, patch: { voicePrefs } })
    .catch((err: unknown) => console.error("Failed to persist voicePrefs:", err));
}

export function VoiceChannelView({
  client,
  netId,
  netName,
  channelName,
  voiceEngine: externalEngine,
  serverEntry,
  onTransmittingChange,
  focusedAppPtt,
}: VoiceChannelViewProps) {
  // Use the shared engine from AppState when available; fall back to a local
  // instance for backwards compatibility (tests, storybook, etc.).
  const [localEngine] = useState(() => externalEngine ?? new VoiceEngine(client));
  const engineRef = useRef<VoiceEngine>(localEngine);
  engineRef.current = externalEngine ?? localEngine;
  const engine = engineRef.current;
  const [ptt] = useState(() => new PttController(engine));

  const [net, setNet] = useState<NetSummary | null>(() =>
    listNets(client).find((n) => n.matrixRoomId === netId) ?? null,
  );
  const [ui, setUi] = useState<PerNetUiState>(() => defaultUi(serverEntry, netId));
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [transmitting, setTransmitting] = useState(false);
  const [availableChirps, setAvailableChirps] = useState<ChirpSummary[]>([]);

  // Keep a live ref of focusedAppPtt so the gate provider closure reads current
  // settings without stale-closure issues.
  const focusedAppPttRef = useRef<FocusedAppPttSettings | undefined>(focusedAppPtt);
  focusedAppPttRef.current = focusedAppPtt;

  useEffect(() => {
    ptt.setFocusGateConfig(() => ({
      enabled: focusedAppPttRef.current?.enabled ?? false,
      allowlist: focusedAppPttRef.current?.allowlistEntries ?? [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt]);

  // Fetch available chirps once on mount.
  useEffect(() => {
    void window.hailfreq
      .invoke("chirps:list")
      .then((chirps) => setAvailableChirps(chirps))
      .catch((err: unknown) => console.error("Failed to list chirps:", err));
  }, []);

  // Track the net summary for this room across Matrix changes (members, name…).
  useEffect(() => {
    const refresh = () =>
      setNet(listNets(client).find((n) => n.matrixRoomId === netId) ?? null);
    refresh();
    return subscribeToNetsChanges(client, refresh);
  }, [client, netId]);

  // Wire active-speaker events for THIS net only.
  useEffect(() => {
    engine.on("activeSpeakersChanged", (roomId, identities) => {
      if (roomId === netId) setActiveSpeakers(identities);
    });
  }, [engine, netId]);

  // Wire PTT state changes; reflect transmitting only when it's our net.
  useEffect(() => {
    engine.on("pttStateChanged", (roomId) => {
      setTransmitting(roomId === netId);
      onTransmittingChange(roomId);
    });
  }, [engine, netId, onTransmittingChange]);

  // Poll the ptt controller as a cheap fallback for the transmitting indicator.
  useEffect(() => {
    const i = setInterval(
      () => setTransmitting(ptt.getTransmittingNet() === netId),
      100,
    );
    return () => clearInterval(i);
  }, [ptt, netId]);

  // Shutdown the ptt controller on unmount. The VoiceEngine is NOT shut down
  // here when provided externally — AppState owns its lifetime.
  useEffect(() => {
    return () => {
      void ptt.shutdown();
      if (!externalEngine) void localEngine.shutdown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt]);

  /** Apply a UI patch, persist it, and return the merged state. */
  const applyUi = useCallback(
    (patch: Partial<PerNetUiState>, persist = true) => {
      setUi((prev) => {
        const next = { ...prev, ...patch };
        if (persist) persistNetPrefs(serverEntry, netId, next);
        return next;
      });
    },
    [serverEntry, netId],
  );

  const handleToggleMonitor = useCallback(async () => {
    if (!net) return;
    if (ui.monitored) {
      await engine.unmonitorNet(netId);
      applyUi({ monitored: false });
      setActiveSpeakers([]);
    } else {
      engine.setChirps(netId, { inbound: ui.inboundChirp, outbound: ui.outboundChirp });
      await engine.monitorNet({ matrixRoomId: netId, priority: net.properties.priority });
      applyUi({ monitored: true });
    }
  }, [net, ui.monitored, ui.inboundChirp, ui.outboundChirp, engine, netId, applyUi]);

  const handleVolume = useCallback(
    (volume: number) => {
      engine.setNetVolume(netId, volume);
      applyUi({ volume });
    },
    [engine, netId, applyUi],
  );

  const handlePttModeChange = useCallback(
    async (mode: PttMode) => {
      await ptt.unbind(netId);
      applyUi({ pttMode: mode, keybind: null });
      if (mode === "voice") {
        const result = await ptt.bind({
          matrixRoomId: netId,
          mode: "voice",
          voiceThresholdDb: ui.voiceThresholdDb,
        });
        if (!result.ok) console.error(`Failed to enable voice activation: ${result.error}`);
      }
    },
    [ptt, netId, ui.voiceThresholdDb, applyUi],
  );

  const handleKeybindChange = useCallback(
    async (accel: string) => {
      const result = await ptt.bind({ matrixRoomId: netId, mode: ui.pttMode, accelerator: accel });
      if (!result.ok) {
        applyUi({ keybindError: result.error ?? "Failed to bind" }, false);
        return;
      }
      applyUi({ keybind: accel, keybindError: null });
    },
    [ptt, netId, ui.pttMode, applyUi],
  );

  const handleKeybindClear = useCallback(async () => {
    await ptt.unbind(netId);
    applyUi({ keybind: null });
  }, [ptt, netId, applyUi]);

  const handleVoiceThresholdChange = useCallback(
    async (db: number) => {
      applyUi({ voiceThresholdDb: db });
      await ptt.bind({ matrixRoomId: netId, mode: "voice", voiceThresholdDb: db });
    },
    [ptt, netId, applyUi],
  );

  const handleChirpChange = useCallback(
    (kind: "inbound" | "outbound", chirpId: string) => {
      const next: PerNetUiState =
        kind === "inbound"
          ? { ...ui, inboundChirp: chirpId }
          : { ...ui, outboundChirp: chirpId };
      engine.setChirps(netId, { inbound: next.inboundChirp, outbound: next.outboundChirp });
      applyUi(kind === "inbound" ? { inboundChirp: chirpId } : { outboundChirp: chirpId });
    },
    [ui, engine, netId, applyUi],
  );

  const handleSetSelfMonitor = useCallback(
    async (enabled: boolean) => {
      await updateNetProperties(client, netId, { selfMonitor: enabled });
      engine.setSelfMonitor(netId, enabled);
    },
    [client, netId, engine],
  );

  // Tap-to-talk button — toggle PTT directly via the engine for "toggle" mode,
  // press/hold for "hold" mode. Mirrors PttController semantics for the on-screen
  // button so a keybind isn't strictly required to transmit.
  const handlePttDown = useCallback(() => {
    if (!ui.monitored) return;
    if (ui.pttMode === "hold") void engine.startPtt(netId);
    else void (transmitting ? engine.stopPtt() : engine.startPtt(netId));
  }, [ui.monitored, ui.pttMode, transmitting, engine, netId]);

  const handlePttUp = useCallback(() => {
    if (ui.pttMode === "hold" && transmitting) void engine.stopPtt();
  }, [ui.pttMode, transmitting, engine]);

  const memberLabel = useMemo(() => {
    if (!net) return "0 members";
    return `${net.memberCount} member${net.memberCount === 1 ? "" : "s"}`;
  }, [net]);

  if (!net) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        <p>Voice channel unavailable.</p>
        <p className="mt-1 text-xs text-slate-500">
          The net for this channel could not be found.
        </p>
      </div>
    );
  }

  const live = activeSpeakers.length > 0 || transmitting;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      {/* Header: net + channel name + live/idle status */}
      <div className="flex items-center gap-3">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: net.properties.color }}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-slate-100">
            {netName}
            <span className="ml-2 text-sm font-normal text-slate-500">#{channelName}</span>
          </h2>
          <p className="text-xs text-slate-500">
            P{net.properties.priority} · {memberLabel}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold uppercase ${
            live ? "bg-rose-700 text-white" : "bg-slate-800 text-slate-400"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              live ? "animate-pulse bg-rose-200" : "bg-emerald-400"
            }`}
          />
          {live ? "🔴 Live" : "🟢 Idle"}
        </span>
      </div>

      {/* Primary interaction: PTT / Tap to Talk */}
      <button
        onMouseDown={handlePttDown}
        onMouseUp={handlePttUp}
        onMouseLeave={handlePttUp}
        disabled={!ui.monitored}
        className={`w-full rounded-lg py-6 text-lg font-bold uppercase tracking-wider transition-colors ${
          !ui.monitored
            ? "cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-600"
            : transmitting
              ? "border border-rose-500 bg-rose-600 text-white"
              : "border border-brand-500 bg-brand-500/20 text-brand-50 hover:bg-brand-500/30"
        }`}
        title={
          ui.monitored
            ? ui.pttMode === "hold"
              ? "Hold to talk"
              : "Tap to talk"
            : "Monitor this net first"
        }
      >
        {transmitting
          ? "Transmitting…"
          : ui.pttMode === "hold"
            ? "Hold to Talk"
            : "Tap to Talk"}
      </button>

      {/* Monitor toggle */}
      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
        <span className="text-sm text-slate-300">Monitor</span>
        <button
          onClick={() => void handleToggleMonitor()}
          className={`rounded px-3 py-1 text-xs ${
            ui.monitored
              ? "border border-brand-400 bg-brand-500/20 text-brand-50"
              : "border border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
          }`}
        >
          {ui.monitored ? "Monitoring" : "Monitor"}
        </button>
      </div>

      {/* Voice mode selector */}
      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
        <span className="text-sm text-slate-300">Voice mode</span>
        <select
          value={ui.pttMode}
          onChange={(e) => void handlePttModeChange(e.target.value as PttMode)}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
          title="Voice mode"
        >
          <option value="voice">Hot Mic (Voice)</option>
          <option value="hold">Push-to-Talk (Hold)</option>
          <option value="toggle">Monitor-only / Tap</option>
        </select>
      </div>

      {/* Keybind (toggle/hold) or voice threshold (voice) */}
      {ui.pttMode !== "voice" ? (
        <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
          <span className="text-sm text-slate-300">Keybind</span>
          <div className="flex flex-col items-end gap-1">
            <KeybindCapture
              value={ui.keybind ?? ""}
              onChange={(a) => void handleKeybindChange(a)}
              onClear={() => void handleKeybindClear()}
            />
            {ui.keybindError && <span className="text-xs text-red-400">{ui.keybindError}</span>}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
          <span className="text-sm text-slate-300">
            Voice threshold ({ui.voiceThresholdDb} dB)
          </span>
          <input
            type="range"
            min="-70"
            max="-20"
            step="1"
            value={ui.voiceThresholdDb}
            onChange={(e) => void handleVoiceThresholdChange(Number(e.target.value))}
            className="w-40"
            title={`Voice threshold: ${ui.voiceThresholdDb} dB`}
          />
        </div>
      )}

      {/* Volume slider */}
      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
        <span className="text-sm text-slate-300">Volume ({Math.round(ui.volume * 100)}%)</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={ui.volume}
          onChange={(e) => handleVolume(Number(e.target.value))}
          className="w-40"
          title={`Volume: ${Math.round(ui.volume * 100)}%`}
          disabled={!ui.monitored}
        />
      </div>

      {/* Mic level bar */}
      <div className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 p-3">
        <span className="text-sm text-slate-300">Mic level</span>
        <MicLevelBar voiceEngine={engine} className="w-40" />
      </div>

      {/* Chirp selectors */}
      {availableChirps.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">Outbound chirp</label>
            <select
              value={ui.outboundChirp}
              onChange={(e) => handleChirpChange("outbound", e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
              title="Outbound chirp (played locally when you start PTT)"
            >
              {availableChirps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">Inbound chirp</label>
            <select
              value={ui.inboundChirp}
              onChange={(e) => handleChirpChange("inbound", e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
              title="Inbound chirp (played when a remote participant starts transmitting)"
            >
              {availableChirps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void window.hailfreq.invoke("chirps:openFolder")}
            className="text-left text-xs text-slate-500 underline hover:text-slate-300"
            title="Open folder to add custom chirp files"
          >
            Custom chirps…
          </button>
        </div>
      )}

      {/* Self-monitor checkbox */}
      <label
        className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300"
        title="Hear yourself while transmitting (for solo testing)"
      >
        <input
          type="checkbox"
          checked={!!net.properties.selfMonitor}
          onChange={(e) => void handleSetSelfMonitor(e.target.checked)}
        />
        Self-monitor
      </label>

      {/* Member / speaker list */}
      <div className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-900 p-3">
        <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">
          Connected ({activeSpeakers.length} talking)
        </div>
        {activeSpeakers.length === 0 ? (
          <p className="text-xs text-slate-500">
            {ui.monitored ? "No one is speaking." : "Monitor the net to see activity."}
          </p>
        ) : (
          activeSpeakers.map((identity) => (
            <div key={identity} className="flex items-center gap-2 text-sm text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="truncate">{identity}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
