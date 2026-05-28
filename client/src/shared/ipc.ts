import type { Settings } from "./types";

// Source of truth for all IPC channels. Add new channels here.
export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
  "settings:get": { args: []; result: Settings };
  "settings:set": { args: [Partial<Settings>]; result: Settings };
}

export type IpcChannelName = keyof IpcChannels;
