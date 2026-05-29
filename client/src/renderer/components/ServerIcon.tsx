import type { ServerEntry } from "@shared/types";

interface ServerIconProps {
  server: ServerEntry;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  unreadCount?: number;
  transmitting?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
}

export function ServerIcon({ server, active, onClick, onContextMenu, unreadCount, transmitting, onDragStart }: ServerIconProps) {
  const initial = (server.label.trim()[0] ?? server.serverUrl[0] ?? "?").toUpperCase();
  const badgeLabel = unreadCount != null && unreadCount > 99 ? "99+" : String(unreadCount ?? 0);
  const showBadge = unreadCount != null && unreadCount > 0;

  return (
    <button
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", server.id);
        onDragStart?.(e);
      }}
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
      } ${transmitting ? "animate-pulse ring-2 ring-brand-300" : ""}`}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-brand-400" />
      )}
      {initial}
      {showBadge && (
        <span className="absolute -right-1 -top-1 flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[0.6rem] font-bold leading-tight text-white">
          {badgeLabel}
        </span>
      )}
    </button>
  );
}
