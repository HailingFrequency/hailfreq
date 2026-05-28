import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannelName, IpcChannels } from "../shared/ipc";

const api = {
  invoke: <K extends IpcChannelName>(
    channel: K,
    ...args: IpcChannels[K]["args"]
  ): Promise<IpcChannels[K]["result"]> => ipcRenderer.invoke(channel, ...args),
  onHotkey: (cb: (e: { id: string; accelerator: string }) => void) => {
    const pressedHandler = (_event: unknown, payload: { id: string; accelerator: string }) => cb(payload);
    ipcRenderer.on("hotkey:pressed", pressedHandler);
    return () => ipcRenderer.off("hotkey:pressed", pressedHandler);
  },
};

contextBridge.exposeInMainWorld("hailfreq", api);

declare global {
  interface Window {
    hailfreq: typeof api;
  }
}
