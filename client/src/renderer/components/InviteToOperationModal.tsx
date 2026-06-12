import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";
import { searchUsers } from "../matrix/userSearch";
import { inviteToOperation } from "../matrix/operations";
import { filterInvitableMembers } from "./operationFormHelpers";

interface InviteToOperationModalProps {
  client: MatrixClient;
  open: boolean;
  operationId: string;
  operationName: string;
  /**
   * Set of userIds already present in the operation's roster.
   * These members will be shown grayed-out with "✓ Assigned" and cannot be
   * selected. Defaults to an empty set if not provided.
   */
  alreadyInRoster?: ReadonlySet<string>;
  onClose: () => void;
  onInvited: (userIds: string[]) => void;
}

/**
 * Modal for inviting users to an operation.
 *
 * Member sourcing: uses the same Matrix homeserver user-directory search
 * as UserSearchDialog (via searchUsers from matrix/userSearch.ts), with a
 * 300ms debounce. Results are filtered and marked via filterInvitableMembers.
 *
 * Already-in-roster members appear grayed out with "✓ Assigned" and are
 * not clickable. Other users can be toggled into a local selection set
 * ("＋ Add" / "✓ Selected"). The Done button submits the selection via
 * inviteToOperation; partial failures are surfaced in the modal without
 * closing it.
 */
export function InviteToOperationModal({
  client,
  open,
  operationId,
  operationName,
  alreadyInRoster = new Set(),
  onClose,
  onInvited,
}: InviteToOperationModalProps) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { userId: string; displayName: string }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local state when the modal is opened/closed
  useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchResults([]);
      setSelected(new Set());
      setError(null);
    }
  }, [open]);

  // Debounced search — mirrors the pattern in UserSearchDialog
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const found = await searchUsers(client, query.trim());
        setSearchResults(found);
      } catch {
        setError("User search failed. Check your connection and try again.");
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [client, query]);

  if (!open) return null;

  const filteredMembers = filterInvitableMembers(searchResults, "", alreadyInRoster);

  function toggleSelection(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async function handleDone() {
    const userIds = Array.from(selected);
    if (userIds.length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await inviteToOperation(client, operationId, userIds);
      onInvited(userIds);
      onClose();
    } catch (err) {
      // inviteToOperation throws an aggregate error listing failed user IDs.
      // Surface it directly — it's already user-readable.
      setError(
        err instanceof Error
          ? err.message
          : "Some invitations could not be sent. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (!busy) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
    >
      <div
        className="w-[28rem] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold text-brand-400">
          Invite to {operationName}
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Search by display name or Matrix user ID. Already-assigned members are shown greyed out.
        </p>

        <input
          type="text"
          autoFocus
          placeholder="Search users…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60"
        />

        {/* Results list */}
        <div className="mt-2 max-h-60 overflow-auto rounded border border-slate-800">
          {searching && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">Searching…</p>
          )}

          {!searching && query.trim() && filteredMembers.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">No users found.</p>
          )}

          {!searching && !query.trim() && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">
              Type a name or Matrix ID to search.
            </p>
          )}

          {filteredMembers.map((member) => {
            const isSelected = selected.has(member.userId);
            const isAssigned = member.alreadyInvited;

            return (
              <div
                key={member.userId}
                className={`flex w-full items-center justify-between border-b border-slate-800 px-3 py-2 last:border-b-0 ${
                  isAssigned ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-800/60"
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm text-slate-100">{member.displayName}</span>
                  <span className="text-xs text-slate-500">{member.userId}</span>
                </div>

                {isAssigned ? (
                  <span className="ml-3 shrink-0 text-xs text-emerald-400">✓ Assigned</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleSelection(member.userId)}
                    className={`ml-3 shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected
                        ? "bg-brand-500 text-slate-900"
                        : "border border-slate-600 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {isSelected ? "✓ Selected" : "＋ Add"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

        {selected.size > 0 && !error && (
          <p className="mt-2 text-xs text-slate-400">
            {selected.size} user{selected.size !== 1 ? "s" : ""} selected
          </p>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            onClick={handleDone}
            disabled={busy}
          >
            {busy ? "Inviting…" : selected.size > 0 ? `Invite ${selected.size}` : "Done"}
          </Button>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
