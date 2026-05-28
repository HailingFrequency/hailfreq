import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannelName, IpcChannels } from "../shared/ipc";

const api = {
  invoke: <K extends IpcChannelName>(
    channel: K,
    ...args: IpcChannels[K]["args"]
  ): Promise<IpcChannels[K]["result"]> => ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld("hailfreq", api);

declare global {
  interface Window {
    hailfreq: typeof api;
  }
}
