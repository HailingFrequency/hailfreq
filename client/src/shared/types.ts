import type { IpcChannelName, IpcChannels } from "./ipc";

declare global {
  interface Window {
    hailfreq: {
      invoke: <K extends IpcChannelName>(
        channel: K,
        ...args: IpcChannels[K]["args"]
      ) => Promise<IpcChannels[K]["result"]>;
    };
  }
}

export {};
