import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { NetSummary } from "../matrix/nets";
import { CreateNetDialog } from "./CreateNetDialog";
import { NetPropertiesEditor } from "./NetPropertiesEditor";

interface AdminNetListProps {
  client: MatrixClient;
  nets: NetSummary[];
  selectedNetId: string | null;
  onSelect: (matrixRoomId: string | null) => void;
  /** Set of room IDs where the viewer has admin (PL >= 100) rights. */
  adminNetIds: Set<string>;
}

export function AdminNetList({
  client,
  nets,
  selectedNetId,
  onSelect,
  adminNetIds,
}: AdminNetListProps) {
  const [creating, setCreating] = useState(false);
  const [editingNet, setEditingNet] = useState<NetSummary | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Nets
        </span>
        <button
          onClick={() => setCreating(true)}
          title="Create net"
          className="rounded border border-dashed border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-brand-400 hover:text-brand-400"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-auto py-1">
        {nets.map((net) => {
          const selected = net.matrixRoomId === selectedNetId;
          return (
            <button
              key={net.matrixRoomId}
              onClick={() => onSelect(net.matrixRoomId)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                selected
                  ? "bg-brand-500/15 text-brand-50"
                  : "text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: net.properties.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{net.properties.name}</div>
                <div className="text-xs text-slate-500">
                  P{net.properties.priority} · {net.memberCount} members
                </div>
              </div>
              {adminNetIds.has(net.matrixRoomId) && (
                <button
                  type="button"
                  title="Net properties"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingNet(net);
                  }}
                  className="ml-1 shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                >
                  ⚙
                </button>
              )}
            </button>
          );
        })}
        {nets.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-500">No nets found.</p>
        )}
      </div>

      {creating && (
        <CreateNetDialog
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(roomId) => {
            onSelect(roomId);
            setCreating(false);
          }}
        />
      )}

      {editingNet && (
        <NetPropertiesEditor
          client={client}
          net={editingNet}
          onClose={() => setEditingNet(null)}
          onDeleted={() => {
            setEditingNet(null);
            // If the deleted net was selected, clear selection
            if (selectedNetId === editingNet.matrixRoomId) {
              onSelect(null);
            }
          }}
        />
      )}
    </div>
  );
}
