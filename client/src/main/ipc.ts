import { app, ipcMain, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { settings, addServer, removeServer, setActiveServer, updateServer, reorderServers } from "./store";
import { saveCredentials, loadCredentials, clearCredentials, migrateLegacyCredentials } from "./tokens";
import { runSsoFlow } from "./oidc";
import { registerHotkey, unregisterHotkey, listHotkeys } from "./globalHotkeys";
import { registerHold, unregisterHold } from "./nativeKeyListener";
import { listChirps, readChirp, openChirpFolder } from "./chirps";
import { findScInstallCandidates, validateGameLogPath } from "./scInstallPath";
import { startWatch, stopWatch } from "./scLogTail";
import { getFocusedApp } from "./windowFocus";
import type { FocusedAppInfo } from "../shared/ipc";
import { showNotification } from "./notifications";
import type { NotifyOptions } from "./notifications";
import type { Settings, ServerEntry, FocusedAppPttSettings } from "../shared/types";
import type { StoredCredentials } from "../shared/ipc";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);

  ipcMain.handle("settings:get", (): Settings => settings.store);
  ipcMain.handle("settings:setUi", (_event, ui: Settings["ui"]): Settings => {
    settings.set("ui", ui);
    return settings.store;
  });
  ipcMain.handle("settings:setScInstallPath", (_event, args: unknown): void => {
    if (args === null || typeof args !== "object" || !("path" in args)) {
      throw new Error("settings:setScInstallPath: args must be { path: string | undefined }");
    }
    const { path: p } = args as { path: unknown };
    if (p === undefined || p === null) {
      settings.delete("scInstallPath" as keyof Settings);
    } else if (typeof p === "string") {
      settings.set("scInstallPath", p);
    } else {
      throw new Error("settings:setScInstallPath: path must be a string or undefined");
    }
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
  ipcMain.handle("servers:reorder", (_event, args: { orderedIds: string[] }): void => {
    reorderServers(args.orderedIds);
  });

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

  ipcMain.handle(
    "nativeHotkey:registerHold",
    (_event, args: { accelerator: string; metadata: unknown }) =>
      registerHold(args.accelerator, args.metadata),
  );
  ipcMain.handle("nativeHotkey:unregisterHold", (_event, args: { id: string }) =>
    unregisterHold(args.id),
  );

  ipcMain.handle("chirps:list", () => listChirps());
  ipcMain.handle("chirps:read", (_e, args: { id: string }) => readChirp(args.id));
  ipcMain.handle("chirps:openFolder", () => openChirpFolder());

  ipcMain.handle("sc:findInstall", () => findScInstallCandidates());
  ipcMain.handle("sc:validatePath", (_event, args: { path: string }) => validateGameLogPath(args.path));
  ipcMain.handle("sc:pickGameLog", async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: "Select Star Citizen Game.log",
      filters: [{ name: "Game.log", extensions: ["log"] }],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    // Validate that the chosen file is actually named Game.log
    if (path.basename(chosen) !== "Game.log") return null;
    return chosen;
  });
  ipcMain.handle("sc:startWatch", async (_event, args: { gameLogPath: string }) => {
    if (typeof args.gameLogPath !== "string") throw new Error("gameLogPath must be a string");
    if (!path.isAbsolute(args.gameLogPath)) throw new Error("gameLogPath must be an absolute path");
    if (path.basename(args.gameLogPath) !== "Game.log") throw new Error("gameLogPath must point to Game.log");
    return startWatch(args.gameLogPath);
  });
  ipcMain.handle("sc:stopWatch", () => stopWatch());

  ipcMain.handle("notify:show", (_event, opts: NotifyOptions): void => {
    showNotification(opts, () => BrowserWindow.getAllWindows()[0] ?? null);
  });

  ipcMain.handle("app:windowFocused", (): boolean => {
    const win = BrowserWindow.getFocusedWindow();
    return win?.isFocused() ?? false;
  });

  ipcMain.handle("focus:get", (): FocusedAppInfo => {
    return getFocusedApp();
  });

  ipcMain.handle("settings:setFocusedAppPtt", (_event, args: unknown): void => {
    if (args === null || typeof args !== "object" || !("focusedAppPtt" in args)) {
      throw new Error("settings:setFocusedAppPtt: args must be { focusedAppPtt: FocusedAppPttSettings }");
    }
    const { focusedAppPtt } = args as { focusedAppPtt: unknown };
    if (
      focusedAppPtt === null ||
      typeof focusedAppPtt !== "object" ||
      typeof (focusedAppPtt as FocusedAppPttSettings).enabled !== "boolean" ||
      !Array.isArray((focusedAppPtt as FocusedAppPttSettings).allowlistEntries)
    ) {
      throw new Error("settings:setFocusedAppPtt: focusedAppPtt must have boolean enabled + string[] allowlistEntries");
    }
    const list = (focusedAppPtt as FocusedAppPttSettings).allowlistEntries;
    if (!list.every((e) => typeof e === "string")) {
      throw new Error("settings:setFocusedAppPtt: allowlistEntries must contain only strings");
    }
    settings.set("focusedAppPtt", focusedAppPtt as FocusedAppPttSettings);
  });
}
