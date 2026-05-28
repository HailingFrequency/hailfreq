// Source of truth for all IPC channels. Add new channels here.
export interface IpcChannels {
  "app:version": { args: []; result: string };
  "app:platform": { args: []; result: NodeJS.Platform };
}

export type IpcChannelName = keyof IpcChannels;
