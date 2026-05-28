import type { ServerEntry } from "@shared/types";

interface ServerIconProps {
  server: ServerEntry;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function ServerIcon({ server, active, onClick, onContextMenu }: ServerIconProps) {
  const initial = (server.label.trim()[0] ?? server.serverUrl[0] ?? "?").toUpperCase();
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(e);
      }}
      title={`${server.label} — ${server.serverUrl}`}
      className={`relative flex h-12 w-12 items-center justify-center rounded-lg text-base font-semibold transition-all ${
        active
          ? "bg-brand-500 text-slate-900 ring-2 ring-brand-400 ring-offset-2 ring-offset-slate-950"
          : "bg-slate-800 text-slate-200 hover:bg-slate-700 hover:rounded-xl"
      }`}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-brand-400" />
      )}
      {initial}
    </button>
  );
}
