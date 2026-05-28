import { app, ipcMain } from "electron";
import { settings } from "./store";
import { saveCredentials, loadCredentials, clearCredentials } from "./tokens";
import type { Settings } from "../shared/types";
import type { StoredCredentials } from "../shared/ipc";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  ipcMain.handle("settings:get", (): Settings => settings.store);
  ipcMain.handle("settings:set", (_event, partial: Partial<Settings>): Settings => {
    for (const [key, value] of Object.entries(partial)) {
      settings.set(key as keyof Settings, value as never);
    }
    return settings.store;
  });

  ipcMain.handle("tokens:save", (_event, creds: StoredCredentials) => saveCredentials(creds));
  ipcMain.handle("tokens:load", () => loadCredentials());
  ipcMain.handle("tokens:clear", () => clearCredentials());
}
