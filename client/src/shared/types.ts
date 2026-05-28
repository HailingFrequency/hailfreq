import type { IpcChannelName, IpcChannels } from "./ipc";

/** Per-net voice preferences stored per server entry. Keys are Matrix room IDs. */
export interface NetPreferences {
  /** Per-net volume levels (0.0 – 1.0). */
  volumes: Record<string, number>;
  /** Per-net PTT keybinds (Electron accelerator strings). */
  keybinds: Record<string, string>;
  /** Per-net PTT modes. */
  pttModes: Record<string, "toggle" | "hold" | "voice">;
  /** Per-net voice activation thresholds (dB, typically negative). */
  voiceThresholds: Record<string, number>;
  /** Matrix room IDs of nets the user has opted to monitor. */
  monitored: string[];
}

export interface ServerEntry {
  /** Generated UUID. Stable identity for a configured server. */
  id: string;
  /** Display label shown in the sidebar. Operator can edit. Default: derived from serverUrl. */
  label: string;
  /** Matrix homeserver base URL, e.g., https://radio.your-guild.com */
  serverUrl: string;
  /** Logged-in Matrix user ID. Empty when this server entry exists but hasn't been signed in to. */
  userId: string;
  /** Login method last used for this server. */
  lastLoginMethod: "" | "citizenid" | "local";
  /** Most recent sync timestamp (ms since epoch). Used by sidebar for unread/freshness UI. */
  lastSyncedMs: number;
  /** Persisted per-net voice preferences for this server. */
  voicePrefs?: NetPreferences;
}

export interface Settings {
  /** All configured servers. May be empty (first-run). */
  servers: ServerEntry[];
  /** ID of the currently-active (foregrounded) server. Empty when no servers exist. */
  activeServerId: string;
  /** UI preferences. */
  ui: { theme: "dark" };
}

declare global {
  interface Window {
    hailfreq: {
      invoke: <K extends IpcChannelName>(
        channel: K,
        ...args: IpcChannels[K]["args"]
      ) => Promise<IpcChannels[K]["result"]>;
      onHotkey: (cb: (e: { id: string; accelerator: string }) => void) => () => void;
      onNativeHotkey: (
        cb: (e: { id: string; accelerator: string; direction: "down" | "up" }) => void,
      ) => () => void;
    };
  }
}

export {};
