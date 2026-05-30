/**
 * Pure helpers for the ⚙ Settings → Star Citizen section's status line.
 * Kept dependency-free so they unit-test in the node environment.
 */

export interface ScWatchStatusInput {
  /** The global Game.log path, or undefined when unset. */
  scInstallPath?: string;
  /** Display names of servers that currently have Ship Link enabled. */
  enabledServerNames: string[];
  /** Whether the main-process tailer is currently active. */
  watching: boolean;
}

export type ScWatchStatusKind = "unset" | "disabled" | "watching" | "not-watching";

/**
 * - unset:        no Game.log path configured.
 * - disabled:     path set, but no server has Ship Link enabled (tailer won't run).
 * - watching:     path set, a server is enabled, tailer is active.
 * - not-watching: path set + enabled but tailer isn't active (e.g. file missing).
 */
export function deriveScWatchStatus(input: ScWatchStatusInput): ScWatchStatusKind {
  if (!input.scInstallPath) return "unset";
  if (input.enabledServerNames.length === 0) return "disabled";
  return input.watching ? "watching" : "not-watching";
}

/** Human-readable age of the last Game.log line, e.g. "3s ago". */
export function formatActivity(lastLineAt: number | null, now: number): string {
  if (lastLineAt === null) return "no activity yet";
  const sec = Math.max(0, Math.floor((now - lastLineAt) / 1000));
  if (sec < 1) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
