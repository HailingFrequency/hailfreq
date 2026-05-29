import type { Settings, ServerEntry, FocusedAppPttSettings } from "./types";

export interface ChirpSummary {
  id: string;
  name: string;
  source: "builtin" | "custom";
}

export interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

export type ScInstallSource =
  | "registry"
  | "default-windows"
  | "wine-lutris"
  | "wine-default"
  | "bottles"
  | "steam-proton"
  | "manual";

export interface ScInstallCandidate {
  /** Absolute path to a Game.log file that exists. */
  gameLogPath: string;
  /** Which branch this is (LIVE / PTU / EPTU). */
  branch: string;
  /** Source hint for UI. */
  source: ScInstallSource;
}

export interface FocusedAppInfo {
  processName: string | null;
  title: string | null;
  isWayland: boolean;
}

export interface DesktopCaptureSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  kind: "screen" | "window";
}

// Source of truth for all IPC channels. Add new channels here.
export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
  "settings:get": { args: []; result: Settings };
  "settings:setUi": { args: [Settings["ui"]]; result: Settings };
  "settings:setScInstallPath": { args: [{ path: string | undefined }]; result: void };
  "servers:add": { args: [{ label: string; serverUrl: string }]; result: ServerEntry };
  "servers:remove": { args: [{ serverId: string }]; result: void };
  "servers:setActive": { args: [{ serverId: string }]; result: void };
  "servers:update": { args: [{ serverId: string; patch: Partial<ServerEntry> }]; result: ServerEntry };
  "servers:reorder": { args: [{ orderedIds: string[] }]; result: void };
  "notify:show": { args: [{ title: string; body: string; serverId?: string }]; result: void };
  "app:windowFocused": { args: []; result: boolean };
  "tokens:save": { args: [{ serverId: string; credentials: StoredCredentials }]; result: void };
  "tokens:load": { args: [{ serverId: string }]; result: StoredCredentials | null };
  "tokens:clear": { args: [{ serverId: string }]; result: void };
  "oidc:startSsoFlow": {
    args: [{ homeserverUrl: string; idpId: string }];
    result: { loginToken: string };
  };
  "hotkeys:register": {
    args: [{ accelerator: string; metadata: unknown }];
    result: { id: string } | { error: string };
  };
  "hotkeys:unregister": { args: [{ id: string }]; result: void };
  "hotkeys:list": { args: []; result: Array<{ id: string; accelerator: string; metadata: unknown }> };
  "nativeHotkey:registerHold": {
    args: [{ accelerator: string; metadata: unknown }];
    result: { id: string } | { error: string };
  };
  "nativeHotkey:unregisterHold": { args: [{ id: string }]; result: void };
  "chirps:list": { args: []; result: ChirpSummary[] };
  "chirps:read": { args: [{ id: string }]; result: Uint8Array };
  "chirps:openFolder": { args: []; result: string };
  "sc:findInstall": { args: []; result: ScInstallCandidate[] };
  "sc:validatePath": { args: [{ path: string }]; result: boolean };
  "sc:pickGameLog": { args: []; result: string | null };
  "sc:startWatch": { args: [{ gameLogPath: string }]; result: void };
  "sc:stopWatch": { args: []; result: void };
  "focus:get": { args: []; result: FocusedAppInfo };
  "settings:setFocusedAppPtt": { args: [{ focusedAppPtt: FocusedAppPttSettings }]; result: void };
  "share:listSources": { args: []; result: DesktopCaptureSource[] };
}

export type IpcChannelName = keyof IpcChannels;
