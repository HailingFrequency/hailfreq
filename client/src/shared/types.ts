import type { IpcChannelName, IpcChannels } from "./ipc";

export interface Settings {
  /** Homeserver URL configured during first-run. Empty means first-run not done. */
  serverUrl: string;
  /** Last logged-in Matrix user ID, for auto-resume. Empty when logged out. */
  userId: string;
  /** Which login method was last used: "citizenid" or "local". */
  lastLoginMethod: "" | "citizenid" | "local";
  /** UI preferences. */
  ui: {
    theme: "dark";
  };
}

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
