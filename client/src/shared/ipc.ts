import type { Settings, ServerEntry } from "./types";

export interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

// Source of truth for all IPC channels. Add new channels here.
export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
  "settings:get": { args: []; result: Settings };
  "settings:setUi": { args: [Settings["ui"]]; result: Settings };
  "servers:add": { args: [{ label: string; serverUrl: string }]; result: ServerEntry };
  "servers:remove": { args: [{ serverId: string }]; result: void };
  "servers:setActive": { args: [{ serverId: string }]; result: void };
  "servers:update": { args: [{ serverId: string; patch: Partial<ServerEntry> }]; result: ServerEntry };
  "tokens:save": { args: [StoredCredentials]; result: void };
  "tokens:load": { args: []; result: StoredCredentials | null };
  "tokens:clear": { args: []; result: void };
  "oidc:startSsoFlow": {
    args: [{ homeserverUrl: string; idpId: string }];
    result: { loginToken: string };
  };
}

export type IpcChannelName = keyof IpcChannels;
