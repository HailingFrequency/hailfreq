import type { HierarchyNode } from "../matrix/hierarchyTypes";
import { isSelectableNode, nodeIcon } from "./channelListHelpers";

export interface ChannelListProps {
  nodes: HierarchyNode[];
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
  /**
   * Optional handler to add a text channel to a net/ship node. When provided, a
   * "+ Channel" button appears on hover for net/ship rows. When undefined, no
   * button is shown (preserves backwards compat for OperationsSidebar).
   */
  onAddChannel?: (netId: string) => void;
  /**
   * Connected participants per net room ID: netId → [matrixUserId, ...].
   * When provided, voice channel rows render participant names below them,
   * matching Discord's sidebar UX.
   */
  voiceParticipants?: ReadonlyMap<string, readonly string[]>;
  /**
   * Active speakers per net room ID: netId → Set<matrixUserId>.
   * Used to show a speaking indicator next to participant names.
   */
  activeSpeakers?: ReadonlyMap<string, ReadonlySet<string>>;
  /** The local Matrix user ID — used to label the local participant as "you". */
  localUserId?: string;
  /** Display name resolver: matrixUserId → human-readable name. */
  resolveDisplayName?: (userId: string) => string;
  /** Called when user left-clicks a voice channel — joins immediately. Net room ID passed (node.netId ?? node.id). */
  onVoiceChannelClick?: (netRoomId: string) => void;
  /** Called when user right-clicks a voice channel. Passes net room ID + pointer position for context menu. */
  onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void;
  /** Net room ID of the currently connected channel — used to style the connected row. */
  connectedVoiceRoomId?: string;
  /** Indentation depth — incremented on each recursive call. Defaults to 0. */
  depth?: number;
}

// ---------------------------------------------------------------------------
// ChannelListRow — one row in the tree, extracted to avoid re-creating handlers
// on every render of the parent map().
// ---------------------------------------------------------------------------

interface ChannelListRowProps {
  node: HierarchyNode;
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onAddChannel?: (netId: string) => void;
  voiceParticipants?: ReadonlyMap<string, readonly string[]>;
  activeSpeakers?: ReadonlyMap<string, ReadonlySet<string>>;
  localUserId?: string;
  resolveDisplayName?: (userId: string) => string;
  onVoiceChannelClick?: (netRoomId: string) => void;
  onVoiceChannelRightClick?: (netRoomId: string, x: number, y: number) => void;
  connectedVoiceRoomId?: string;
  depth: number;
}

function ChannelListRow({
  node,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  onAddChannel,
  voiceParticipants,
  activeSpeakers,
  localUserId,
  resolveDisplayName,
  onVoiceChannelClick,
  onVoiceChannelRightClick,
  connectedVoiceRoomId,
  depth,
}: ChannelListRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedChannelId === node.id;
  const selectable = isSelectableNode(node);
  const icon = nodeIcon(node);

  // The net room ID for voice nodes (parent Space ID for child voice channels,
  // or the node's own ID for backwards-compat private_chat nets).
  const voiceNetId = node.type === "voice" ? (node.netId ?? node.id) : null;
  const isConnected = voiceNetId !== null && voiceNetId === connectedVoiceRoomId;

  function handleVoiceContextMenu(e: React.MouseEvent) {
    if (!voiceNetId || !onVoiceChannelRightClick) return;
    e.preventDefault();
    onVoiceChannelRightClick(voiceNetId, e.clientX, e.clientY);
  }

  // "+ Channel" affordance: only for net/ship structural nodes, and only when
  // the caller wired up an onAddChannel handler.
  const canAddChannel =
    onAddChannel !== undefined && (node.type === "net" || node.type === "ship");

  // Indent: 12 px base + 16 px per depth level, matches the dense sidebar aesthetic
  const paddingLeft = 12 + depth * 16;

  function handleRowClick() {
    if (node.type === "voice" && onVoiceChannelClick && voiceNetId) {
      onVoiceChannelClick(voiceNetId);
      return;
    }
    if (selectable) {
      onSelectChannel(node.id);
    } else {
      onToggleExpand(node.id);
      // Auto-select the voice child only when NOT in click-to-join mode
      // (i.e., when onVoiceChannelClick is not provided — Operations mode).
      if (!onVoiceChannelClick && !isExpanded && node.children.length > 0) {
        const voiceChild = node.children.find((c) => c.type === "voice");
        if (voiceChild) onSelectChannel(voiceChild.id);
      }
    }
  }

  function handleArrowClick(e: React.MouseEvent) {
    e.stopPropagation();
    onToggleExpand(node.id);
  }

  function handleArrowKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggleExpand(node.id);
    }
  }

  function handleAddChannelClick(e: React.MouseEvent) {
    e.stopPropagation();
    onAddChannel?.(node.id);
  }

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      {/*
       * Flex row: arrow button (expand/collapse) sits as a sibling to the
       * content button so we never nest an interactive element inside another.
       */}
      <div
        className="group flex w-full items-center"
        style={{ paddingLeft }}
      >
        {/* Expand/collapse arrow — only shown when node has children */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? "Collapse" : "Expand"}
            className="shrink-0 text-slate-500 hover:text-slate-300 select-none w-5 h-full text-center bg-transparent border-0 p-0 cursor-pointer"
            onClick={handleArrowClick}
            onKeyDown={handleArrowKeyDown}
            tabIndex={-1}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="shrink-0 w-5" aria-hidden="true" />
        )}

        {/* Row content button — selects or toggles depending on node type */}
        <button
          type="button"
          className={[
            "flex flex-1 items-center gap-1.5 rounded py-1 text-left text-sm transition-colors min-w-0",
            isSelected
              ? "bg-brand-500/20 text-brand-50"
              : isConnected
              ? "border border-brand-500/30 bg-brand-500/10 text-brand-50"
              : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
          ].join(" ")}
          onClick={handleRowClick}
          onContextMenu={handleVoiceContextMenu}
          tabIndex={0}
          aria-selected={selectable ? isSelected : undefined}
        >
          {/* Node type icon */}
          {icon && (
            <span className="shrink-0 text-slate-400 select-none" aria-hidden="true">
              {icon}
            </span>
          )}

          {/* Node name */}
          <span className="truncate flex-1 font-medium">
            {node.name}
          </span>

          {/* Live dot — shown while connected to this voice channel */}
          {isConnected && (
            <span
              className="shrink-0 h-2 w-2 animate-pulse rounded-full bg-brand-400"
              aria-label="Connected"
            />
          )}

          {/* Priority badge — only shown for broadcast nodes */}
          {node.isBroadcast && node.priority !== undefined && (
            <span
              className="shrink-0 ml-1 rounded px-1 py-0.5 text-xs font-semibold bg-amber-700/30 text-amber-300"
              title={`Priority ${node.priority}`}
            >
              P{node.priority}
            </span>
          )}
        </button>

        {/* "+ Channel" button — net/ship rows only, revealed on hover */}
        {canAddChannel && (
          <button
            type="button"
            onClick={handleAddChannelClick}
            aria-label={`Add channel to ${node.name}`}
            title={`Add channel to ${node.name}`}
            className="shrink-0 ml-1 mr-2 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-500 opacity-0 transition-all hover:bg-brand-500/20 hover:text-brand-300 focus:opacity-100 group-hover:opacity-100 group-hover:text-brand-400"
          >
            ＋ Channel
          </button>
        )}
      </div>

      {/* Recursive children — only rendered when expanded */}
      {hasChildren && isExpanded && (
        <ChannelList
          nodes={node.children}
          selectedChannelId={selectedChannelId}
          expandedIds={expandedIds}
          onSelectChannel={onSelectChannel}
          onToggleExpand={onToggleExpand}
          onAddChannel={onAddChannel}
          voiceParticipants={voiceParticipants}
          activeSpeakers={activeSpeakers}
          localUserId={localUserId}
          resolveDisplayName={resolveDisplayName}
          onVoiceChannelClick={onVoiceChannelClick}
          onVoiceChannelRightClick={onVoiceChannelRightClick}
          connectedVoiceRoomId={connectedVoiceRoomId}
          depth={depth + 1}
        />
      )}

      {/* Discord-style: connected participants listed under an expanded voice channel */}
      {node.type === "voice" && isExpanded === false && (() => {
        const netId = node.netId ?? node.id.replace(/#voice$/, "");
        const participants = voiceParticipants?.get(netId);
        if (!participants || participants.length === 0) return null;
        const speakers = activeSpeakers?.get(netId) ?? new Set<string>();
        const participantIndent = paddingLeft + 20;
        return (
          <ul className="list-none m-0 p-0">
            {participants.map((userId) => {
              const isSelf = userId === localUserId;
              const isSpeaking = speakers.has(userId);
              const displayName = resolveDisplayName?.(userId) ?? userId.split(":")[0].replace("@", "");
              return (
                <li key={userId}>
                  <div
                    className="flex items-center gap-1.5 py-0.5 text-xs"
                    style={{ paddingLeft: participantIndent }}
                  >
                    <span className={isSpeaking ? "text-green-400" : "text-slate-500"} aria-hidden="true">
                      {isSpeaking ? "🔊" : "🎤"}
                    </span>
                    <span className={isSelf ? "font-semibold text-brand-300" : "text-slate-400"}>
                      {displayName}{isSelf ? " (you)" : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        );
      })()}
    </li>
  );
}

// ---------------------------------------------------------------------------
// ChannelList — recursive tree renderer
// ---------------------------------------------------------------------------

/**
 * Recursive presentational component that renders a HierarchyNode tree as a
 * list of channel rows with expand/collapse support.
 *
 * - Selectable nodes (text / voice / circuit): clicking the row calls onSelectChannel.
 * - Structural nodes (net / ship / strike-group): clicking the row calls onToggleExpand.
 * - The expand arrow (▼ / ▶) always calls onToggleExpand when a node has children.
 * - Selected row is highlighted with a brand-tinted background.
 * - Depth-based left padding gives visual indentation for nested nodes.
 *
 * This component is intentionally thin — all logic lives in channelListHelpers.ts
 * so it can be unit-tested without a DOM environment.
 */
export function ChannelList({
  nodes,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  onAddChannel,
  voiceParticipants,
  activeSpeakers,
  localUserId,
  resolveDisplayName,
  onVoiceChannelClick,
  onVoiceChannelRightClick,
  connectedVoiceRoomId,
  depth = 0,
}: ChannelListProps) {
  const listRole = depth === 0 ? "tree" : "group";

  return (
    <ul role={listRole} className="list-none m-0 p-0">
      {nodes.map((node) => (
        <ChannelListRow
          key={node.id}
          node={node}
          selectedChannelId={selectedChannelId}
          expandedIds={expandedIds}
          onSelectChannel={onSelectChannel}
          onToggleExpand={onToggleExpand}
          onAddChannel={onAddChannel}
          voiceParticipants={voiceParticipants}
          activeSpeakers={activeSpeakers}
          localUserId={localUserId}
          resolveDisplayName={resolveDisplayName}
          onVoiceChannelClick={onVoiceChannelClick}
          onVoiceChannelRightClick={onVoiceChannelRightClick}
          connectedVoiceRoomId={connectedVoiceRoomId}
          depth={depth}
        />
      ))}
    </ul>
  );
}
