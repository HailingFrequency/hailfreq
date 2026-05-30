import { useMemo, useState } from "react";
import type { NetSummary } from "../matrix/nets";
import type { RosterMember } from "../matrix/roster";

interface AdminRosterProps {
  roster: RosterMember[];
  nets: NetSummary[];
  filterNetId: string | null;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
}

export function AdminRoster({
  roster,
  nets,
  filterNetId,
  selectedUserId,
  onSelect,
}: AdminRosterProps) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const netLookup = useMemo(() => {
    const m = new Map<string, NetSummary>();
    nets.forEach((n) => m.set(n.matrixRoomId, n));
    return m;
  }, [nets]);

  const filtered = useMemo(() => {
    let list = roster;
    if (filterNetId && !showAll) {
      list = list.filter((m) => m.joinedNets.has(filterNetId));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q),
      );
    }
    return list;
  }, [roster, filterNetId, showAll, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <input
          type="text"
          placeholder="Filter operators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
        />
        {filterNetId && (
          <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            All
          </label>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No operators match.</p>
        )}
        {filtered.map((m) => {
          const selected = m.userId === selectedUserId;
          const memberNets = Array.from(m.joinedNets)
            .map((id) => netLookup.get(id))
            .filter((n): n is NetSummary => n !== undefined);
          const isAdmin = Array.from(m.perNetPowerLevel.values()).some((pl) => pl >= 100);
          const isSquadLead =
            !isAdmin &&
            Array.from(m.perNetPowerLevel.values()).some((pl) => pl >= 75 && pl < 100);

          return (
            <button
              key={m.userId}
              onClick={() => onSelect(m.userId)}
              className={`grid w-full grid-cols-[16px_1fr_auto] items-center gap-3 border-b border-slate-800 px-3 py-2 text-left text-sm transition-colors ${
                selected ? "bg-brand-500/10" : "hover:bg-slate-800/50"
              }`}
            >
              {/* Presence dot */}
              <span
                className={`h-2 w-2 rounded-full ${
                  m.presence === "online"
                    ? "bg-emerald-400"
                    : m.presence === "unavailable"
                      ? "bg-amber-400"
                      : "bg-slate-600"
                }`}
              />

              {/* Name + badges */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-slate-100">{m.displayName}</span>
                  {m.rsiVerified && (
                    <span
                      className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                      title="Self-reported via CitizenID account-data; not server-verified"
                    >
                      RSI?
                    </span>
                  )}
                  {isAdmin && (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      ADMIN
                    </span>
                  )}
                  {isSquadLead && (
                    <span className="rounded bg-brand-900/40 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                      SQUAD LEAD
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">{m.userId}</div>
              </div>

              {/* Net color tags (max 3 + overflow count) */}
              <div className="flex flex-wrap items-center justify-end gap-1">
                {memberNets.slice(0, 3).map((net) => (
                  <span
                    key={net.matrixRoomId}
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: `${net.properties.color}30`,
                      color: net.properties.color,
                    }}
                  >
                    {net.properties.name}
                  </span>
                ))}
                {memberNets.length > 3 && (
                  <span className="text-[10px] text-slate-500">
                    +{memberNets.length - 3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
