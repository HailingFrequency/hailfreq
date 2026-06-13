import type { HierarchyNode } from "../matrix/hierarchyTypes";
import { flattenForLounge } from "../matrix/hierarchyFlattener";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ChannelList } from "./ChannelList";

export interface LoungeSidebarProps {
  nodes: HierarchyNode[];
  availableNets: HierarchyNode[];
  monitoredNetId?: string;
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onJoinNet: (id: string) => void;
}

/**
 * Presentational sidebar for Lounge mode.
 *
 * Renders three sections:
 *   SHIPS        — ship hierarchy nodes via ChannelList
 *   YOUR NETS    — monitored/joined nets via ChannelList
 *   AVAILABLE TO JOIN — flat list with a "＋ Join" call-to-action button
 *
 * Each section is hidden when empty so the layout stays uncluttered.
 * All data derivation is delegated to flattenForLounge (pure, tested separately).
 */
export function LoungeSidebar({
  nodes,
  availableNets,
  monitoredNetId,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  onJoinNet,
}: LoungeSidebarProps) {
  const { ships, yourNets, availableToJoin } = flattenForLounge(
    nodes,
    monitoredNetId,
    availableNets,
  );

  return (
    <div className="flex flex-col gap-1 overflow-y-auto py-2">
      {/* SHIPS section */}
      {ships.length > 0 && (
        <section aria-label="Ships">
          <SidebarSectionHeader label="Ships" />
          <ChannelList
            nodes={ships}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
          />
        </section>
      )}

      {/* YOUR NETS section */}
      {yourNets.length > 0 && (
        <section aria-label="Your Nets">
          <SidebarSectionHeader label="Your Nets" />
          <ChannelList
            nodes={yourNets}
            selectedChannelId={selectedChannelId}
            expandedIds={expandedIds}
            onSelectChannel={onSelectChannel}
            onToggleExpand={onToggleExpand}
          />
        </section>
      )}

      {/* AVAILABLE TO JOIN section */}
      {availableToJoin.length > 0 && (
        <section aria-label="Available to Join">
          <SidebarSectionHeader label="Available to Join" />
          <ul className="list-none m-0 p-0">
            {availableToJoin.map((net) => (
              <li key={net.id}>
                <div className="flex w-full items-center justify-between gap-2 px-3 py-1">
                  <span className="truncate text-sm font-medium text-slate-300">
                    {net.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onJoinNet(net.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-brand-400 hover:bg-brand-500/20 hover:text-brand-300 transition-colors"
                    title={`Join ${net.name}`}
                  >
                    ＋ Join
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
