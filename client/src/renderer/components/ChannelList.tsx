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
  return (
    <ul role="tree" className="list-none m-0 p-0">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedIds.has(node.id);
        const isSelected = selectedChannelId === node.id;
        const selectable = isSelectableNode(node);
        const icon = nodeIcon(node);

        // Indent: 12 px per depth level, matches the dense sidebar aesthetic
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

        function handleKeyDown(e: React.KeyboardEvent) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleRowClick();
          }
          // Arrow keys for tree navigation are intentionally left to the
          // browser / consumer — this component stays thin.
        }

        return (
          <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
            <button
              type="button"
              className={[
                "flex w-full items-center gap-1.5 rounded py-1 text-left text-sm transition-colors",
                isSelected
                  ? "bg-brand-500/20 text-brand-50"
                  : "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
              ].join(" ")}
              style={{ paddingLeft }}
              onClick={handleRowClick}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              aria-selected={selectable ? isSelected : undefined}
            >
              {/* Expand/collapse arrow — only shown when node has children */}
              {hasChildren ? (
                <span
                  role="button"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                  className="shrink-0 text-slate-500 hover:text-slate-300 select-none w-3 text-center"
                  onClick={handleArrowClick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleExpand(node.id);
                    }
                  }}
                  tabIndex={-1}
                >
                  {isExpanded ? "▼" : "▶"}
                </span>
              ) : (
                <span className="shrink-0 w-3" aria-hidden="true" />
              )}

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
      })}
    </ul>
  );
}
