import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { NetPreferences, ServerEntry } from "@shared/types";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import { NetRow } from "./NetRow";
import { VoiceEngine } from "../voice/VoiceEngine";
import { PttController, type PttMode } from "../voice/PttController";

interface NetListPanelProps {
  client: MatrixClient;
  serverEntry: ServerEntry;
  onTransmittingChange: (net: string | null) => void;
}

interface PerNetUiState {
  monitored: boolean;
  volume: number;
  activeSpeakers: number;
  pttMode: PttMode;
  keybind: string | null;
  voiceThresholdDb: number;
}

function defaultUi(): PerNetUiState {
  return {
    monitored: false,
    volume: 1.0,
    activeSpeakers: 0,
    pttMode: "toggle",
    keybind: null,
    voiceThresholdDb: -45,
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
  };
  for (const [roomId, ui] of uiState) {
    prefs.volumes[roomId] = ui.volume;
    if (ui.keybind !== null) prefs.keybinds[roomId] = ui.keybind;
    prefs.pttModes[roomId] = ui.pttMode;
    prefs.voiceThresholds[roomId] = ui.voiceThresholdDb;
    if (ui.monitored) prefs.monitored.push(roomId);
  }
  return prefs;
}

export function NetListPanel({ client, serverEntry, onTransmittingChange }: NetListPanelProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [uiState, setUiState] = useState<Map<string, PerNetUiState>>(new Map());
  const [engine] = useState(() => new VoiceEngine(client));
  const [ptt] = useState(() => new PttController(engine));
  const [transmitting, setTransmitting] = useState<string | null>(null);

  // Track whether initial seed from voicePrefs has been applied
  const seededRef = useRef(false);

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

  // Shutdown engine + ptt controller on unmount
  useEffect(() => {
    return () => {
      void ptt.shutdown();
      void engine.shutdown();
    };
  }, [engine, ptt]);

  async function handleToggleMonitor(net: NetSummary) {
    const current = uiState.get(net.matrixRoomId) ?? defaultUi();
    if (current.monitored) {
      await engine.unmonitorNet(net.matrixRoomId);
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: false, activeSpeakers: 0 });
        persistPrefs(next);
        return next;
      });
    } else {
      await engine.monitorNet({
        matrixRoomId: net.matrixRoomId,
        priority: net.properties.priority,
      });
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: true });
        persistPrefs(next);
        return next;
      });
    }
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
      alert(`Failed to register keybind: ${result.error}`);
      return;
    }
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, keybind: accel });
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
          An admin can create one via the "+" button (when wired in Task 15).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {nets.map((net) => {
        const ui = uiState.get(net.matrixRoomId) ?? defaultUi();
        return (
          <NetRow
            key={net.matrixRoomId}
            net={net}
            monitored={ui.monitored}
            volume={ui.volume}
            activeSpeakers={ui.activeSpeakers}
            transmitting={transmitting === net.matrixRoomId}
            pttMode={ui.pttMode}
            keybind={ui.keybind}
            voiceThresholdDb={ui.voiceThresholdDb}
            onToggleMonitor={() => void handleToggleMonitor(net)}
            onVolumeChange={(v) => handleVolume(net.matrixRoomId, v)}
            onPttModeChange={(mode) => void handlePttModeChange(net.matrixRoomId, mode)}
            onKeybindChange={(a) => void handleKeybindChange(net.matrixRoomId, a)}
            onKeybindClear={() => void handleKeybindClear(net.matrixRoomId)}
            onVoiceThresholdChange={(db) => void handleVoiceThresholdChange(net.matrixRoomId, db)}
          />
        );
      })}
    </div>
  );
}
