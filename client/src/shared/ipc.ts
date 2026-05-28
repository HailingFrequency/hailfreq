import type { Settings } from "./types";

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
  "settings:set": { args: [Partial<Settings>]; result: Settings };
  "tokens:save": { args: [StoredCredentials]; result: void };
  "tokens:load": { args: []; result: StoredCredentials | null };
  "tokens:clear": { args: []; result: void };
}

export type IpcChannelName = keyof IpcChannels;
