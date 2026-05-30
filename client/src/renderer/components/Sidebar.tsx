import { useRef, useState } from "react";
import type { ScIntegrationSettings, FocusedAppPttSettings } from "@shared/types";
import type { ServerEntry } from "@shared/types";
import { ServerIcon } from "./ServerIcon";
import { ServerContextMenu } from "./ServerContextMenu";
import { ScIntegrationSettings as ScIntegrationSettingsPanel } from "../screens/ScIntegrationSettings";
import { SettingsMenu } from "../screens/SettingsMenu";

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
  onToggleNotifications?: (serverId: string, enabled: boolean) => Promise<void>;
  onSaveScIntegration?: (
    serverId: string,
    patch: { scIntegration: ScIntegrationSettings; scInstallPath: string | undefined },
  ) => Promise<void>;
  onSaveFocusedAppPtt?: (value: FocusedAppPttSettings) => Promise<void>;
  onReorder?: (orderedIds: string[]) => void;
  /** Global Game.log path (passed through from AppState for the SC panel). */
  scInstallPath?: string;
  /** Global focused-app PTT settings (passed through from AppState). */
  focusedAppPtt?: FocusedAppPttSettings;
  /** Currently selected audio input device (passed through from AppState). */
  inputDeviceId?: string;
  /** Currently selected audio output device (passed through from AppState). */
  outputDeviceId?: string;
  onChangeAudioDevices?: (d: { inputDeviceId?: string; outputDeviceId?: string }) => void;
}

export function Sidebar({
  servers,
  activeServerId,
  onSelect,
  onAddClicked,
  onRemoveServer,
  onRenameServer,
  onToggleNotifications,
  onSaveScIntegration,
  onSaveFocusedAppPtt,
  onReorder,
  scInstallPath,
  focusedAppPtt,
  inputDeviceId,
  outputDeviceId,
  onChangeAudioDevices,
}: SidebarProps) {
  const [contextMenuFor, setContextMenuFor] = useState<ServerEntry | null>(null);
  const [scIntegrationFor, setScIntegrationFor] = useState<ServerEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Track the server being dragged over for drop-target highlighting
  const dragOverIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, targetId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdRef.current !== targetId) {
      dragOverIdRef.current = targetId;
      setDragOverId(targetId);
    }
  }

  function handleDragLeave() {
    dragOverIdRef.current = null;
    setDragOverId(null);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, targetId: string) {
    e.preventDefault();
    dragOverIdRef.current = null;
    setDragOverId(null);

    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetId) return;

    const currentOrder = servers.map((s) => s.entry.id);
    const fromIdx = currentOrder.indexOf(draggedId);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Build new order: remove dragged item, insert before target
    const newOrder = [...currentOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedId);

    onReorder?.(newOrder);
  }

  function handleSidebarDragLeave(e: React.DragEvent<HTMLElement>) {
    // Only clear if leaving the sidebar entirely (not just crossing between children)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      dragOverIdRef.current = null;
      setDragOverId(null);
    }
  }

  return (
    <>
      <aside
        className="flex w-20 flex-col items-center gap-3 border-r border-slate-800 bg-slate-950 py-4"
        onDragLeave={handleSidebarDragLeave}
      >
        {servers.map(({ entry, unreadCount, transmitting }) => (
          <div
            key={entry.id}
            onDragOver={(e) => handleDragOver(e, entry.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, entry.id)}
            className={`rounded-lg transition-all ${dragOverId === entry.id ? "ring-2 ring-brand-400 ring-offset-1 ring-offset-slate-950" : ""}`}
          >
            <ServerIcon
              server={entry}
              active={entry.id === activeServerId}
              onClick={() => onSelect(entry.id)}
              onContextMenu={() => setContextMenuFor(entry)}
              unreadCount={unreadCount}
              transmitting={transmitting}
            />
          </div>
        ))}
        <button
          onClick={onAddClicked}
          title="Add server"
          className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl font-light text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-400"
        >
          +
        </button>
        {onSaveFocusedAppPtt && (
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="mt-auto flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.53 1.53 0 01-2.29.95c-1.37-.84-2.94.73-2.1 2.1.62 1.02.05 2.34-1.1 2.58-1.56.38-1.56 2.6 0 2.98a1.53 1.53 0 01.95 2.29c-.84 1.37.73 2.94 2.1 2.1a1.53 1.53 0 012.29.95c.38 1.56 2.6 1.56 2.98 0a1.53 1.53 0 012.29-.95c1.37.84 2.94-.73 2.1-2.1a1.53 1.53 0 01.95-2.29c1.56-.38 1.56-2.6 0-2.98a1.53 1.53 0 01-.95-2.29c.84-1.37-.73-2.94-2.1-2.1a1.53 1.53 0 01-2.29-.95zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </aside>
      {contextMenuFor && (
        <ServerContextMenu
          server={contextMenuFor}
          onClose={() => setContextMenuFor(null)}
          onRemove={() => onRemoveServer(contextMenuFor.id)}
          onRename={(newLabel) => onRenameServer(contextMenuFor.id, newLabel)}
          onToggleNotifications={
            onToggleNotifications
              ? (enabled) => onToggleNotifications(contextMenuFor.id, enabled)
              : undefined
          }
          onOpenScIntegration={
            onSaveScIntegration
              ? () => {
                  setScIntegrationFor(contextMenuFor);
                  setContextMenuFor(null);
                }
              : undefined
          }
        />
      )}
      {scIntegrationFor && onSaveScIntegration && (
        <ScIntegrationSettingsPanel
          serverId={scIntegrationFor.id}
          scIntegration={scIntegrationFor.scIntegration}
          scInstallPath={scInstallPath}
          onSave={(patch) => onSaveScIntegration(scIntegrationFor.id, patch)}
          onClose={() => setScIntegrationFor(null)}
        />
      )}
      {settingsOpen && onSaveFocusedAppPtt && (
        <SettingsMenu
          inputDeviceId={inputDeviceId}
          outputDeviceId={outputDeviceId}
          onChangeAudioDevices={onChangeAudioDevices ?? (() => {})}
          focusedAppPtt={focusedAppPtt}
          onSaveFocusedAppPtt={onSaveFocusedAppPtt}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
