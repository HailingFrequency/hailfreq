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
  /**
   * Per-net outbound chirp ID (played locally when the user starts PTT).
   * Defaults to "builtin:click" when absent.
   */
  outboundChirps: Record<string, string>;
  /**
   * Per-net inbound chirp ID (played when a remote participant starts transmitting,
   * debounced at 2 s). Defaults to "builtin:classic-two-tone" when absent.
   */
  inboundChirps: Record<string, string>;
}

export type BridgeMode = "smart" | "always-on" | "ptt-relay";

export interface BridgeEndpoint {
  serverId: string;            // ServerEntry.id
  matrixRoomId: string;        // The net's Matrix room id
}

export interface BridgeConfig {
  id: string;                  // crypto.randomUUID()
  name: string;                // display name, e.g., "Anvil → Aegis Allies"
  source: BridgeEndpoint;
  target: BridgeEndpoint;
  mode: BridgeMode;
  /** VAD threshold for smart mode, 0..1 (audio RMS). Ignored for other modes. */
  smartThreshold: number;
  enabled: boolean;
  /** Direction: bidirectional means relay both ways with separate engine instances. */
  bidirectional: boolean;
  createdMs: number;
}

/** Global focused-app PTT filter settings. */
export interface FocusedAppPttSettings {
  enabled: boolean;
  /** Case-insensitive substring matches against (processName + " " + title). */
  allowlistEntries: string[];
}

/** Per-server Star Citizen integration settings. */
export interface ScIntegrationSettings {
  /** Opt in to watching the SC Game.log for this server. Default: false. */
  enabled: boolean;
  /** RSI handles to auto-invite without confirmation prompt. */
  autoInviteAllowlist: string[];
  /** Auto-close ship-net on detected ship destruction. Default: true. */
  autoCloseOnDestruction: boolean;
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
  /**
   * Whether OS desktop notifications are enabled for this server.
   * Defaults to true when absent (treat undefined as true via ?? true).
   */
  notificationsEnabled?: boolean;
  /**
   * Star Citizen integration settings for this server.
   * Absent on stores created before this field was added — consumers
   * default to { enabled: false, ... } when reading via ?? operator.
   */
  scIntegration?: ScIntegrationSettings;
}

export interface Settings {
  /** All configured servers. May be empty (first-run). */
  servers: ServerEntry[];
  /** ID of the currently-active (foregrounded) server. Empty when no servers exist. */
  activeServerId: string;
  /** UI preferences. */
  ui: { theme: "dark" };
  /**
   * Absolute path to the Star Citizen Game.log file selected by the user.
   * Omitted on first run; set via the SC integration settings UI.
   * Machine-global (one SC install per machine).
   */
  scInstallPath?: string;
  /**
   * Global focused-app PTT filter. When enabled, PTT only activates while the
   * foreground window matches an entry in allowlistEntries.
   * Machine-global (PTT keybind is a global hotkey).
   */
  focusedAppPtt?: FocusedAppPttSettings;
  /**
   * Configured net bridges. Each bridge relays audio between two nets (typically
   * cross-server). Absent on stores created before this field was added — consumers
   * default to [] when reading via ?? operator.
   */
  bridges?: BridgeConfig[];
  /**
   * Whether the first-run audio device wizard has been completed or skipped.
   * False on fresh install; set to true after the wizard finishes.
   */
  audioSetupComplete?: boolean;
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
      onNotifyClicked: (cb: (payload: { serverId?: string }) => void) => () => void;
      onScLogLine: (cb: (payload: { line: string }) => void) => () => void;
      onScTailerReplaced: (cb: (payload: { oldPath: string; newPath: string }) => void) => () => void;
    };
  }
}

export {};
