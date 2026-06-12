import type {
  HierarchyNode,
  LoungeSidebarState,
  OperationSidebarState,
} from "./hierarchyTypes";

/**
 * Organize a flat list of HierarchyNodes into render-ready sidebar state
 * for Lounge mode (Ships | Your Nets | Available to Join).
 *
 * - ships: nodes of type 'ship', sorted alphabetically by name
 * - yourNets: non-broadcast 'net' nodes, sorted by priority descending
 *   (missing priority treated as 0); if monitoredNetId matches one, it is
 *   moved to the front after sorting
 * - availableToJoin: passed through as-is (defaults to [])
 *
 * All transformations are immutable — inputs are never mutated.
 */
export function flattenForLounge(
  nodes: HierarchyNode[],
  monitoredNetId?: string,
  availableNets: HierarchyNode[] = [],
): LoungeSidebarState {
  const ships = [...nodes.filter((n) => n.type === "ship")].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const sortedNets = [...nodes.filter((n) => n.type === "net" && !n.isBroadcast)].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const yourNets = bubbleMonitoredNet(sortedNets, monitoredNetId);

  return {
    ships,
    yourNets,
    availableToJoin: availableNets,
  };
}

/**
 * Move the node matching monitoredNetId to index 0 without otherwise
 * reordering. Returns the same array reference if no match is found or if
 * the match is already first.
 */
function bubbleMonitoredNet(
  nets: HierarchyNode[],
  monitoredNetId: string | undefined,
): HierarchyNode[] {
  if (!monitoredNetId) return nets;

  const idx = nets.findIndex((n) => n.id === monitoredNetId);
  if (idx <= 0) return nets;

  return [nets[idx], ...nets.slice(0, idx), ...nets.slice(idx + 1)];
}

/**
 * Organize a flat list of HierarchyNodes into render-ready sidebar state
 * for Operations mode (Broadcast Nets → Admirals Net → Strike Groups).
 *
 * - broadcastNets: nodes with isBroadcast === true, sorted by priority descending
 * - admiralsNet: first non-broadcast 'net' node whose lowercased name contains
 *   "admiral"; undefined if none
 * - strikeGroups: nodes of type 'strike-group', input order preserved
 *
 * All transformations are immutable — inputs are never mutated.
 */
export function flattenForOperations(nodes: HierarchyNode[]): OperationSidebarState {
  const broadcastNets = [...nodes.filter((n) => n.type === "net" && n.isBroadcast === true)].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const admiralsNet = nodes.find(
    (n) => n.type === "net" && !n.isBroadcast && n.name.toLowerCase().includes("admiral"),
  );

  const strikeGroups = nodes.filter((n) => n.type === "strike-group");

  return {
    broadcastNets,
    admiralsNet,
    strikeGroups,
  };
}
