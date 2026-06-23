import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { HierarchyNode } from "../matrix/hierarchyTypes";
import { flattenForLounge } from "../matrix/hierarchyFlattener";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ChannelList } from "./ChannelList";
import { CreateChannelDialog } from "./CreateChannelDialog";

export interface LoungeSidebarProps {
  client: MatrixClient;
  nodes: HierarchyNode[];
  availableNets: HierarchyNode[];
  monitoredNetId?: string;
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onJoinNet: (id: string) => void;
  /** Connected participants per net: netId → [matrixUserId, ...] */
  voiceParticipants?: ReadonlyMap<string, readonly string[]>;
  /** Active speakers per net: netId → Set<matrixUserId> */
  activeSpeakers?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Local Matrix user ID — shown as "you" in participant list */
  localUserId?: string;
  /** Display name resolver for participant sub-rows */
  resolveDisplayName?: (userId: string) => string;
  /** Called when a voice channel is left-clicked — passed through to ChannelList. */
  onVoiceChannelClick?: (netRoomId: string) => void;
  /** Called when a voice channel is right-clicked — passed through to ChannelList. */
  onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void;
  /** Net room ID of the currently connected channel — passed through to ChannelList. */
  connectedVoiceRoomId?: string;
}

/** Depth-first search for a node by id across the hierarchy. */
function findNodeById(nodes: HierarchyNode[], id: string): HierarchyNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
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
  client,
  nodes,
  availableNets,
  monitoredNetId,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  onJoinNet,
  voiceParticipants,
  activeSpeakers,
  localUserId,
  resolveDisplayName,
  onVoiceChannelClick,
  onVoiceChannelRightClick,
  connectedVoiceRoomId,
}: LoungeSidebarProps) {
  const [addingChannelToNet, setAddingChannelToNet] = useState<string | null>(null);

  const { ships, yourNets, availableToJoin } = flattenForLounge(
    nodes,
    monitoredNetId,
    availableNets,
  );

  const addingNetNode =
    addingChannelToNet !== null ? findNodeById(nodes, addingChannelToNet) : null;

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
            onAddChannel={(netId) => setAddingChannelToNet(netId)}
            voiceParticipants={voiceParticipants}
            activeSpeakers={activeSpeakers}
            localUserId={localUserId}
            resolveDisplayName={resolveDisplayName}
            onVoiceChannelClick={onVoiceChannelClick}
            onVoiceChannelRightClick={onVoiceChannelRightClick}
            connectedVoiceRoomId={connectedVoiceRoomId}
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
            onAddChannel={(netId) => setAddingChannelToNet(netId)}
            voiceParticipants={voiceParticipants}
            activeSpeakers={activeSpeakers}
            localUserId={localUserId}
            resolveDisplayName={resolveDisplayName}
            onVoiceChannelClick={onVoiceChannelClick}
            onVoiceChannelRightClick={onVoiceChannelRightClick}
            connectedVoiceRoomId={connectedVoiceRoomId}
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

      {/* Create-channel modal — rendered when a net/ship row's "+ Channel" is clicked */}
      {addingChannelToNet !== null && (
        <CreateChannelDialog
          client={client}
          netId={addingChannelToNet}
          netName={addingNetNode?.name ?? "this net"}
          onClose={() => setAddingChannelToNet(null)}
          onCreated={(channelId) => {
            setAddingChannelToNet(null);
            onSelectChannel(channelId);
          }}
        />
      )}
    </div>
  );
}
