import { useState } from "react";
import type { ServerEntry } from "@shared/types";
import { ServerIcon } from "./ServerIcon";
import { ServerContextMenu } from "./ServerContextMenu";

export interface SidebarServerItem {
  entry: ServerEntry;
  unreadCount: number;
  transmitting: boolean;
}

interface SidebarProps {
  servers: SidebarServerItem[];
  activeServerId: string;
  onSelect: (serverId: string) => void;
  onAddClicked: () => void;
  onRemoveServer: (serverId: string) => Promise<void>;
  onRenameServer: (serverId: string, newLabel: string) => Promise<void>;
}

export function Sidebar({ servers, activeServerId, onSelect, onAddClicked, onRemoveServer, onRenameServer }: SidebarProps) {
  const [contextMenuFor, setContextMenuFor] = useState<ServerEntry | null>(null);

  return (
    <>
      <aside className="flex w-20 flex-col items-center gap-3 border-r border-slate-800 bg-slate-950 py-4">
        {servers.map(({ entry, unreadCount, transmitting }) => (
          <ServerIcon
            key={entry.id}
            server={entry}
            active={entry.id === activeServerId}
            onClick={() => onSelect(entry.id)}
            onContextMenu={() => setContextMenuFor(entry)}
            unreadCount={unreadCount}
            transmitting={transmitting}
          />
        ))}
        <button
          onClick={onAddClicked}
          title="Add server"
          className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl font-light text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-400"
        >
          +
        </button>
      </aside>
      {contextMenuFor && (
        <ServerContextMenu
          server={contextMenuFor}
          onClose={() => setContextMenuFor(null)}
          onRemove={() => onRemoveServer(contextMenuFor.id)}
          onRename={(newLabel) => onRenameServer(contextMenuFor.id, newLabel)}
        />
      )}
    </>
  );
}
