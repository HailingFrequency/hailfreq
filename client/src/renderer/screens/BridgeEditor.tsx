import { useState } from "react";
import type { BridgeConfig, BridgeMode, BridgeEndpoint } from "@shared/types";
import type { MatrixClient } from "matrix-js-sdk";
import { listNets } from "../matrix/nets";
import { Button } from "../components/Button";

interface Props {
  /** Existing bridge being edited, or null for create. */
  initial: BridgeConfig | null;
  /** Servers the user is signed into. Map: serverId → label + Matrix client. */
  servers: Map<string, { label: string; client: MatrixClient }>;
  onSave: (bridge: BridgeConfig) => Promise<void>;
  onCancel: () => void;
}

const DEFAULT_SMART_THRESHOLD = 0.02;

interface NetSelectProps {
  endpoint: BridgeEndpoint;
  onChange: (e: BridgeEndpoint) => void;
  servers: Map<string, { label: string; client: MatrixClient }>;
}

function NetSelect({ endpoint, onChange, servers }: NetSelectProps) {
  const serverInstance = endpoint.serverId ? servers.get(endpoint.serverId) : null;
  const nets = serverInstance ? listNets(serverInstance.client) : [];
  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={endpoint.serverId}
        onChange={(e) => onChange({ serverId: e.target.value, matrixRoomId: "" })}
        className="rounded border border-slate-700 bg-slate-800 p-1 text-sm text-slate-100"
      >
        <option value="">— pick server —</option>
        {Array.from(servers.entries()).map(([id, info]) => (
          <option key={id} value={id}>{info.label}</option>
        ))}
      </select>
      <select
        value={endpoint.matrixRoomId}
        onChange={(e) => onChange({ ...endpoint, matrixRoomId: e.target.value })}
        className="rounded border border-slate-700 bg-slate-800 p-1 text-sm text-slate-100 disabled:opacity-50"
        disabled={!endpoint.serverId}
      >
        <option value="">— pick net —</option>
        {nets.map((n) => (
          <option key={n.matrixRoomId} value={n.matrixRoomId}>
            {n.properties.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function BridgeEditor({ initial, servers, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [source, setSource] = useState<BridgeEndpoint>(
    initial?.source ?? { serverId: "", matrixRoomId: "" },
  );
  const [target, setTarget] = useState<BridgeEndpoint>(
    initial?.target ?? { serverId: "", matrixRoomId: "" },
  );
  const [mode, setMode] = useState<BridgeMode>(initial?.mode ?? "smart");
  const [smartThreshold, setSmartThreshold] = useState<number>(
    initial?.smartThreshold ?? DEFAULT_SMART_THRESHOLD,
  );
  const [bidirectional, setBidirectional] = useState<boolean>(initial?.bidirectional ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape key
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onCancel();
    }
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!source.serverId || !source.matrixRoomId) {
      setError("Source net is required");
      return;
    }
    if (!target.serverId || !target.matrixRoomId) {
      setError("Target net is required");
      return;
    }
    if (
      source.serverId === target.serverId &&
      source.matrixRoomId === target.matrixRoomId
    ) {
      setError("Source and target cannot be the same net");
      return;
    }
    setSaving(true);
    try {
      const bridge: BridgeConfig = {
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        source,
        target,
        mode,
        smartThreshold,
        enabled: initial?.enabled ?? false,
        bidirectional,
        createdMs: initial?.createdMs ?? Date.now(),
      };
      await onSave(bridge);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-2xl space-y-4 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-6 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">
          {initial ? "Edit bridge" : "New bridge"}
        </h2>

        {/* Name */}
        <label className="block text-sm">
          <span className="block text-xs uppercase tracking-wider text-slate-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Anvil ↔ Aegis Allies"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
          />
        </label>

        {/* Source net */}
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-400">Source net</span>
          <NetSelect endpoint={source} onChange={setSource} servers={servers} />
        </div>

        {/* Target net */}
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-400">Target net</span>
          <NetSelect endpoint={target} onChange={setTarget} servers={servers} />
        </div>

        {/* Bidirectional */}
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={(e) => setBidirectional(e.target.checked)}
            className="accent-brand-400"
          />
          Bidirectional (relay both directions)
        </label>

        {/* Mode */}
        <div className="space-y-2">
          <span className="block text-xs uppercase tracking-wider text-slate-400">Mode</span>
          {(["smart", "always-on", "ptt-relay"] as BridgeMode[]).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
              <input
                type="radio"
                name="bridge-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-1 accent-brand-400"
              />
              <span>
                <strong>{m}</strong>
                {m === "smart" && (
                  <span className="block text-xs text-slate-500">
                    Relay when source-net voice activity exceeds threshold
                  </span>
                )}
                {m === "always-on" && (
                  <span className="block text-xs text-slate-500">
                    Continuously relay all source audio
                  </span>
                )}
                {m === "ptt-relay" && (
                  <span className="block text-xs text-slate-500">
                    Relay only when source-net member is actively speaking (high VAD threshold)
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        {/* Smart threshold — only shown in smart mode */}
        {mode === "smart" && (
          <label className="block text-sm">
            <span className="block text-xs uppercase tracking-wider text-slate-400">
              Smart threshold ({smartThreshold.toFixed(3)})
            </span>
            <input
              type="range"
              min={0.005}
              max={0.1}
              step={0.001}
              value={smartThreshold}
              onChange={(e) => setSmartThreshold(parseFloat(e.target.value))}
              className="mt-1 w-full accent-brand-400"
            />
            <span className="mt-0.5 block text-xs text-slate-500">
              Lower = more sensitive (opens on quiet audio); higher = opens only on louder speech
            </span>
          </label>
        )}

        {/* Validation error */}
        {error && <p className="text-xs text-rose-300">{error}</p>}

        {/* Footer buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
