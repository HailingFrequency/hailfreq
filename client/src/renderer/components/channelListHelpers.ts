import type { HierarchyNode } from "../matrix/hierarchyTypes";

/**
 * Returns true for node types that are directly selectable as channels
 * (text, voice, circuit). Structural container nodes (net, ship, strike-group)
 * are not selectable — clicking them expands/collapses instead.
 */
export function isSelectableNode(node: HierarchyNode): boolean {
  return node.type === "text" || node.type === "voice" || node.type === "circuit";
}

/**
 * Returns a display icon string for a HierarchyNode.
 * Broadcast flag takes precedence over type-based icons.
 *
 * - isBroadcast → '📢'
 * - text        → '#'
 * - voice       → '🎤'
 * - ship        → '🚢'
 * - all others  → ''
 */
export function nodeIcon(node: HierarchyNode): string {
  if (node.isBroadcast) return "📢";
  if (node.type === "text") return "#";
  if (node.type === "voice") return "🎤";
  if (node.type === "ship") return "🚢";
  return "";
}

/**
 * Toggles the presence of nodeId in the expanded set.
 * Always returns a NEW Set to satisfy the immutability requirement —
 * the original set is never mutated.
 */
export function toggleExpanded(
  expanded: ReadonlySet<string>,
  nodeId: string,
): Set<string> {
  const next = new Set(expanded);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
}
