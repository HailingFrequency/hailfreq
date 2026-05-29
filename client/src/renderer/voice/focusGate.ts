import type { FocusedAppInfo } from "@shared/ipc";

export interface FocusGateInput {
  focus: FocusedAppInfo;
  allowlist: string[];
}

/**
 * Decide whether the global PTT key press should be dispatched, given the
 * current OS-level focused window and the user's configured allowlist.
 *
 * Fail-open semantics:
 *   - Wayland (no focus data available) → pass
 *   - focus probe returned no data       → pass
 *   - allowlist empty                    → pass (gate effectively disabled)
 *
 * Match semantics:
 *   - Case-insensitive substring match against (processName + " " + title)
 *   - Empty / whitespace-only allowlist entries are ignored
 */
export function shouldGatePass({ focus, allowlist }: FocusGateInput): boolean {
  if (focus.isWayland) return true;
  if (focus.processName === null && focus.title === null) return true;

  // Gate is disabled only when the allowlist array itself is empty (not configured).
  // An allowlist with only blank entries is still "configured" — but nothing can match.
  if (allowlist.length === 0) return true;

  const cleanedAllowlist = allowlist.map((e) => e.trim()).filter((e) => e.length > 0);

  // Normalize by stripping whitespace so "StarCitizen" matches "Star Citizen".
  const haystack = `${focus.processName ?? ""} ${focus.title ?? ""}`
    .toLowerCase()
    .replace(/\s+/g, "");
  return cleanedAllowlist.some((entry) =>
    haystack.includes(entry.toLowerCase().replace(/\s+/g, "")),
  );
}
