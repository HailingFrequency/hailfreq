import type { HierarchyNode } from "../matrix/hierarchyTypes";
import { isSelectableNode, nodeIcon } from "./channelListHelpers";

export interface ChannelListProps {
  nodes: HierarchyNode[];
  selectedChannelId: string | null;
  expandedIds: Set<string>;
  onSelectChannel: (id: string) => void;
  onToggleExpand: (id: string) => void;
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
  depth: number;
}

function ChannelListRow({
  node,
  selectedChannelId,
  expandedIds,
  onSelectChannel,
  onToggleExpand,
  depth,
}: ChannelListRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedChannelId === node.id;
  const selectable = isSelectableNode(node);
  const icon = nodeIcon(node);

  // Indent: 12 px base + 16 px per depth level, matches the dense sidebar aesthetic
  const paddingLeft = 12 + depth * 16;

  function handleRowClick() {
    if (selectable) {
      onSelectChannel(node.id);
    } else {
      onToggleExpand(node.id);
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

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      {/*
       * Flex row: arrow button (expand/collapse) sits as a sibling to the
       * content button so we never nest an interactive element inside another.
       */}
      <div
        className="flex w-full items-center"
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
              : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
          ].join(" ")}
          onClick={handleRowClick}
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
      </div>

      {/* Recursive children — only rendered when expanded */}
      {hasChildren && isExpanded && (
        <ChannelList
          nodes={node.children}
          selectedChannelId={selectedChannelId}
          expandedIds={expandedIds}
          onSelectChannel={onSelectChannel}
          onToggleExpand={onToggleExpand}
          depth={depth + 1}
        />
      )}
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
  depth = 0,
}: ChannelListProps) {
  // Only the root list carries role="tree"; nested lists are role="group"
  // per the ARIA tree pattern.
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
          depth={depth}
        />
      ))}
    </ul>
  );
}
