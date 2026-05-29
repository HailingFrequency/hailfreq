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
  onNativeHotkey: (
    cb: (e: { id: string; accelerator: string; direction: "down" | "up" }) => void,
  ) => {
    const downHandler = (_e: unknown, p: { id: string; accelerator: string }) =>
      cb({ ...p, direction: "down" });
    const upHandler = (_e: unknown, p: { id: string; accelerator: string }) =>
      cb({ ...p, direction: "up" });
    ipcRenderer.on("nativeHotkey:down", downHandler);
    ipcRenderer.on("nativeHotkey:up", upHandler);
    return () => {
      ipcRenderer.off("nativeHotkey:down", downHandler);
      ipcRenderer.off("nativeHotkey:up", upHandler);
    };
  },
  onNotifyClicked: (cb: (payload: { serverId?: string }) => void) => {
    const handler = (_e: unknown, payload: { serverId?: string }) => cb(payload);
    ipcRenderer.on("notify:clicked", handler);
    return () => ipcRenderer.off("notify:clicked", handler);
  },
  onScLogLine: (cb: (payload: { line: string }) => void) => {
    const handler = (_e: unknown, payload: { line: string }) => cb(payload);
    ipcRenderer.on("sc:logLine", handler);
    return () => ipcRenderer.off("sc:logLine", handler);
  },
};

contextBridge.exposeInMainWorld("hailfreq", api);

declare global {
  interface Window {
    hailfreq: typeof api;
  }
}
