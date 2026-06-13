import { OperationState } from "../matrix/operationTypes";
import type { Operation } from "../matrix/operationTypes";

/**
 * Priority order for operation states in the selector rail.
 * Lower number = shown earlier.
 */
const STATE_ORDER: Record<OperationState, number> = {
  [OperationState.ACTIVE]: 0,
  [OperationState.PLANNING]: 1,
  [OperationState.COMPLETED]: 2,
  [OperationState.ARCHIVED]: 3,
};

/**
 * Sort operations for the mode-tab rail selector:
 * active → planning → completed → archived, then alphabetical within each group.
 *
 * Immutable — input array is never mutated; a new sorted array is always returned.
 */
export function sortOperationsForSelector(ops: Operation[]): Operation[] {
  return [...ops].sort((a, b) => {
    const orderDiff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Returns a display badge descriptor for an operation state.
 * label: uppercase state name (e.g. "ACTIVE")
 * colorClass: Tailwind classes for the badge background + text
 */
export function operationStateBadge(
  state: OperationState,
): { label: string; colorClass: string } {
  switch (state) {
    case OperationState.ACTIVE:
      return { label: "ACTIVE", colorClass: "bg-green-700/30 text-green-300" };
    case OperationState.PLANNING:
      return { label: "PLANNING", colorClass: "bg-amber-700/30 text-amber-300" };
    case OperationState.COMPLETED:
      return { label: "COMPLETED", colorClass: "bg-blue-700/30 text-blue-300" };
    case OperationState.ARCHIVED:
      return { label: "ARCHIVED", colorClass: "bg-gray-700/30 text-gray-400" };
  }
}

/**
 * Abbreviate an operation name for the narrow rail chip.
 * Always returns uppercase. If name fits within maxLen chars, returns as-is
 * (uppercased). Otherwise returns the first maxLen chars (uppercased).
 *
 * @param name   The operation name to abbreviate.
 * @param maxLen Maximum character count (default 6).
 */
export function abbreviateOpName(name: string, maxLen = 6): string {
  const upper = name.toUpperCase();
  if (upper.length <= maxLen) return upper;
  return upper.slice(0, maxLen);
}
