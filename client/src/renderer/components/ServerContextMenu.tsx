import type { ServerEntry } from "@shared/types";
import { useState } from "react";
import { Button } from "./Button";
import { Input } from "./Input";

interface Props {
  server: ServerEntry;
  onClose: () => void;
  onRemove: () => Promise<void>;
  onRename: (newLabel: string) => Promise<void>;
  onToggleNotifications?: (enabled: boolean) => Promise<void>;
}

type MenuState = "initial" | "renaming" | "confirming";

export function ServerContextMenu({ server, onClose, onRemove, onRename, onToggleNotifications }: Props) {
  const [menuState, setMenuState] = useState<MenuState>("initial");
  const [renameInput, setRenameInput] = useState(server.label);
  const [busy, setBusy] = useState(false);
  const [renameError, setRenameError] = useState<string>("");

  // Treat undefined as enabled (default true)
  const notificationsEnabled = server.notificationsEnabled ?? true;

  async function handleRemove() {
    setBusy(true);
    try {
      await onRemove();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameSubmit() {
    // Validate input
    const trimmedLabel = renameInput.trim();
    if (!trimmedLabel) {
      setRenameError("Server name cannot be empty");
      return;
    }

    setBusy(true);
    try {
      await onRename(trimmedLabel);
      onClose();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Failed to rename server");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleNotifications() {
    if (!onToggleNotifications) return;
    setBusy(true);
    try {
      await onToggleNotifications(!notificationsEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        {menuState === "renaming" ? (
          <>
            <h2 className="text-lg font-semibold text-brand-400">Rename server</h2>
            <div className="mt-4">
              <Input
                label="Server name"
                value={renameInput}
                onChange={(e) => {
                  setRenameInput(e.target.value);
                  setRenameError("");
                }}
                error={renameError}
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="mt-4 flex gap-3">
              <Button onClick={handleRenameSubmit} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setMenuState("initial")} disabled={busy}>Cancel</Button>
            </div>
          </>
        ) : menuState === "confirming" ? (
          <>
            <h2 className="text-lg font-semibold text-brand-400">Remove this server?</h2>
            <p className="mt-2 text-sm text-slate-300">
              You'll be signed out of <strong>{server.label}</strong>. Your encryption keys
              for this server will be cleared from this device.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              If you re-add this server later, you'll need your Recovery Key or another
              signed-in device to decrypt encrypted message history.
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={handleRemove} disabled={busy}>
                {busy ? "Removing…" : "Yes, remove"}
              </Button>
              <Button variant="ghost" onClick={() => setMenuState("initial")} disabled={busy}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-brand-400">{server.label}</h2>
            <p className="mt-1 text-xs text-slate-500">{server.serverUrl}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="ghost" onClick={() => setMenuState("renaming")}>
                Rename…
              </Button>
              {onToggleNotifications && (
                <Button
                  variant="ghost"
                  onClick={handleToggleNotifications}
                  disabled={busy}
                  title={notificationsEnabled ? "Disable OS notifications for this server" : "Enable OS notifications for this server"}
                >
                  Notifications: {notificationsEnabled ? "On" : "Off"}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setMenuState("confirming")}>
                Remove from Hailfreq…
              </Button>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
