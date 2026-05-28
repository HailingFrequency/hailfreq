import { app, ipcMain } from "electron";
import { settings } from "./store";
import type { Settings } from "../shared/types";

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
}
