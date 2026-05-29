import { useState } from "react";
import type { BridgeConfig } from "@shared/types";
import type { BridgeRunnerStatus } from "../bridge/types";
import { Button } from "../components/Button";

interface Props {
  bridges: BridgeConfig[];
  runnerStatuses: Map<string, { forward: BridgeRunnerStatus; reverse: BridgeRunnerStatus | null }>;
  onSave: (bridges: BridgeConfig[]) => Promise<void>;
  onNew: () => void;
  onEdit: (bridge: BridgeConfig) => void;
}

const STATUS_LABELS: Record<BridgeRunnerStatus, { text: string; cls: string }> = {
  stopped: { text: "Stopped", cls: "text-slate-500" },
  starting: { text: "Starting…", cls: "text-amber-300" },
  idle: { text: "Idle", cls: "text-slate-400" },
  relaying: { text: "Relaying", cls: "text-rose-300" },
  error: { text: "Error", cls: "text-rose-400" },
};

export function BridgesPanel({ bridges, runnerStatuses, onSave, onNew, onEdit }: Props) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function handleToggle(bridge: BridgeConfig) {
    const updated = bridges.map((b) => (b.id === bridge.id ? { ...b, enabled: !b.enabled } : b));
    await onSave(updated);
  }

  async function handleConfirmDelete(id: string) {
    const updated = bridges.filter((b) => b.id !== id);
    await onSave(updated);
    setPendingDelete(null);
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100">Bridges</h2>
        <Button onClick={onNew}>New bridge</Button>
      </div>
      <p className="text-xs text-slate-500">
        Bridges run on this machine globally; they relay audio between any nets you&apos;re a member
        of. You must be a member of both nets. Bridges are not per-server — they apply across all
        servers.
      </p>

      {bridges.length === 0 && (
        <p className="py-4 text-sm text-slate-500">
          No bridges configured. Use &ldquo;New bridge&rdquo; to set one up.
        </p>
      )}

      <ul className="space-y-2">
        {bridges.map((bridge) => {
          const statuses = runnerStatuses.get(bridge.id);
          const forwardStatus = statuses?.forward ?? "stopped";
          const reverseStatus = statuses?.reverse ?? null;
          return (
            <li
              key={bridge.id}
              className="rounded border border-slate-700 bg-slate-900 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{bridge.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {bridge.source.matrixRoomId} &rarr; {bridge.target.matrixRoomId}
                  </p>
                  <p className="text-xs text-slate-500">
                    Mode: {bridge.mode}
                    {bridge.bidirectional ? " · bidirectional" : " · one-way"}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="text-slate-500">Forward: </span>
                    <span className={STATUS_LABELS[forwardStatus].cls}>
                      {STATUS_LABELS[forwardStatus].text}
                    </span>
                    {bridge.bidirectional && reverseStatus !== null && (
                      <span className="ml-3">
                        <span className="text-slate-500">Reverse: </span>
                        <span className={STATUS_LABELS[reverseStatus].cls}>
                          {STATUS_LABELS[reverseStatus].text}
                        </span>
                      </span>
                    )}
                  </p>
                  {!bridge.enabled && (
                    <p className="mt-0.5 text-xs text-slate-600">Disabled</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <Button variant="ghost" onClick={() => void handleToggle(bridge)}>
                    {bridge.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="ghost" onClick={() => onEdit(bridge)}>
                    Edit
                  </Button>
                  {pendingDelete === bridge.id ? (
                    <Button
                      variant="ghost"
                      className="border-rose-700 text-rose-400 hover:bg-rose-900/30"
                      onClick={() => void handleConfirmDelete(bridge.id)}
                    >
                      Confirm
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => setPendingDelete(bridge.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
