import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { searchUsers, type UserSearchResult } from "../matrix/userSearch";
import { inviteToNet } from "../matrix/memberActions";
import { Button } from "./Button";

interface UserSearchDialogProps {
  client: MatrixClient;
  /** The net to invite the selected user into. */
  targetNetId: string;
  /** Human-readable name of the net (shown in the dialog title). */
  targetNetName: string;
  onClose: () => void;
}

export function UserSearchDialog({
  client,
  targetNetId,
  targetNetName,
  onClose,
}: UserSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search — fires ~300ms after the user stops typing
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const found = await searchUsers(client, query.trim());
        setResults(found);
      } catch {
        setError("Search failed");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [client, query]);

  async function handleInvite(user: UserSearchResult) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await inviteToNet(client, targetNetId, user.userId);
      setSuccess(`Invited ${user.displayName}`);
      setResults([]);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold text-brand-400">
          Invite to {targetNetName}
        </h2>
        <p className="mb-4 text-xs text-slate-500">
          Search by display name or Matrix user ID.
        </p>

        <input
          type="text"
          autoFocus
          placeholder="Search users…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
        />

        {/* Results list */}
        <div className="mt-2 max-h-60 overflow-auto rounded border border-slate-800">
          {searching && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">
              Searching…
            </p>
          )}
          {!searching && query.trim() && results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-500">
              No users found.
            </p>
          )}
          {results.map((user) => (
            <button
              key={user.userId}
              disabled={busy}
              onClick={() => handleInvite(user)}
              className="flex w-full flex-col border-b border-slate-800 px-3 py-2 text-left last:border-b-0 hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-sm text-slate-100">{user.displayName}</span>
              <span className="text-xs text-slate-500">{user.userId}</span>
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-2 text-xs text-rose-300">{error}</p>
        )}
        {success && (
          <p className="mt-2 text-xs text-emerald-300">{success}</p>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
