import { app, ipcMain } from "electron";
import { settings, addServer, removeServer, setActiveServer, updateServer } from "./store";
import { saveCredentials, loadCredentials, clearCredentials, migrateLegacyCredentials } from "./tokens";
import { runSsoFlow } from "./oidc";
import { registerHotkey, unregisterHotkey, listHotkeys } from "./globalHotkeys";
import type { Settings, ServerEntry } from "../shared/types";
import type { StoredCredentials } from "../shared/ipc";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  ipcMain.handle("settings:get", (): Settings => settings.store);
  ipcMain.handle("settings:setUi", (_event, ui: Settings["ui"]): Settings => {
    settings.set("ui", ui);
    return settings.store;
  });

  ipcMain.handle("servers:add", (_event, args: { label: string; serverUrl: string }): ServerEntry =>
    addServer(args.label, args.serverUrl),
  );
  ipcMain.handle("servers:remove", (_event, args: { serverId: string }): void => {
    removeServer(args.serverId);
  });
  ipcMain.handle("servers:setActive", (_event, args: { serverId: string }): void => {
    setActiveServer(args.serverId);
  });
  ipcMain.handle(
    "servers:update",
    (_event, args: { serverId: string; patch: Partial<ServerEntry> }): ServerEntry =>
      updateServer(args.serverId, args.patch),
  );

  ipcMain.handle("tokens:save", (_event, args: { serverId: string; credentials: StoredCredentials }) =>
    saveCredentials(args.serverId, args.credentials),
  );
  ipcMain.handle("tokens:load", (_event, args: { serverId: string }) => loadCredentials(args.serverId));
  ipcMain.handle("tokens:clear", (_event, args: { serverId: string }) => clearCredentials(args.serverId));

  ipcMain.handle("oidc:startSsoFlow", (_event, params: { homeserverUrl: string; idpId: string }) =>
    runSsoFlow(params),
  );

  ipcMain.handle("hotkeys:register", (_event, args: { accelerator: string; metadata: unknown }) =>
    registerHotkey(args.accelerator, args.metadata),
  );
  ipcMain.handle("hotkeys:unregister", (_event, args: { id: string }) => unregisterHotkey(args.id));
  ipcMain.handle("hotkeys:list", () => listHotkeys());
}
