import type { HierarchyNode } from "../matrix/hierarchyTypes";
import type { Operation } from "../matrix/operationTypes";
import { flattenForOperations } from "../matrix/hierarchyFlattener";
import { operationStateBadge } from "./sidebarModeHelpers";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ChannelList } from "./ChannelList";

export interface OperationsSidebarProps {
  operation: Operation | null;
  nodes: HierarchyNode[];
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
  /** When provided, an "＋ Invite crew" button is shown in the operation header card. */
  onInvite?: () => void;
  /** When provided, a "＋ New Operation" button is shown in the empty state. */
  onCreateOperation?: () => void;
}

/**
 * Presentational sidebar for Operations mode.
 *
 * When no operation is selected: empty state message.
 * When an operation is selected:
 *   - Header card with operation name + state badge
 *   - Broadcast Nets section via ChannelList
 *   - Admiral's Net row via ChannelList (if present)
 *   - STRIKE GROUPS section via ChannelList
 *
 * All structural derivation is delegated to flattenForOperations.
 */
export function OperationsSidebar({
  operation,
  nodes,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  onInvite,
  onCreateOperation,
}: OperationsSidebarProps) {
  if (operation === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-slate-400">No operations yet.</p>
        {onCreateOperation && (
          <button
            type="button"
            onClick={onCreateOperation}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 transition-colors"
          >
            ⚡ New Operation
          </button>
        )}
      </div>
    );
  }

  const { broadcastNets, admiralsNet, strikeGroups } = flattenForOperations(nodes);
  const badge = operationStateBadge(operation.state);

  return (
    <div className="flex flex-col gap-1 overflow-y-auto py-2">
      {/* Operation header card */}
      <div className="mx-3 mb-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="truncate text-sm font-semibold text-slate-100" title={operation.name}>
            {operation.name}
          </span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${badge.colorClass}`}
          >
            {badge.label}
          </span>
        </div>
        {onInvite && (
          <button
            type="button"
            onClick={onInvite}
            className="mt-1.5 w-full rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            ＋ Invite crew
          </button>
        )}
      </div>

      {/* Broadcast Nets section */}
      {broadcastNets.length > 0 && (
        <section aria-label="Broadcast Nets">
          <SidebarSectionHeader label="Broadcast Nets" />
          <ChannelList
            nodes={broadcastNets}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
          />
        </section>
      )}

      {/* Admiral's Net (single node, rendered via ChannelList for consistency) */}
      {admiralsNet !== undefined && (
        <section aria-label="Admirals Net">
          <SidebarSectionHeader label="Admirals Net" />
          <ChannelList
            nodes={[admiralsNet]}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
          />
        </section>
      )}

      {/* Strike Groups section */}
      {strikeGroups.length > 0 && (
        <section aria-label="Strike Groups">
          <SidebarSectionHeader label="Strike Groups" />
          <ChannelList
            nodes={strikeGroups}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
          />
        </section>
      )}
    </div>
  );
}
