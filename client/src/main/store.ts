import Store from "electron-store";
import { randomUUID } from "node:crypto";
import type { Settings, ServerEntry } from "../shared/types";

const defaults: Settings = {
  servers: [],
  activeServerId: "",
  ui: { theme: "dark" },
};

interface LegacyV1Settings {
  serverUrl?: string;
  userId?: string;
  lastLoginMethod?: "" | "citizenid" | "local";
  ui?: { theme?: "dark" };
}

function deriveLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    // "radio.stokowski.space" -> "Stokowski"
    const parts = host.split(".");
    const root = parts.length >= 2 ? parts[parts.length - 2] : host;
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return url;
  }
}

/**
 * Pure migration function: converts legacy single-server shape to multi-server shape.
 * Exported for testing (Task 15).
 */
export function migrateLegacyShape(raw: unknown): Settings {
  const typed = raw as unknown as Settings & LegacyV1Settings;

  // Legacy detection: old shape had top-level serverUrl.
  // `servers` may be [] because conf merges defaults before we read the raw store,
  // so we also trigger when servers is an empty array alongside a non-empty serverUrl.
  const hasLegacyUrl = typeof typed.serverUrl === "string" && typed.serverUrl !== "";
  const hasNoServers = !Array.isArray(typed.servers) || typed.servers.length === 0;
  if (hasLegacyUrl && hasNoServers) {
    const entry: ServerEntry = {
      id: randomUUID(),
      label: deriveLabel(typed.serverUrl),
      serverUrl: typed.serverUrl,
      userId: typed.userId ?? "",
      lastLoginMethod: typed.lastLoginMethod ?? "",
      lastSyncedMs: 0,
      voicePrefs: {
        volumes: {},
        keybinds: {},
        pttModes: {},
        voiceThresholds: {},
        monitored: [],
        outboundChirps: {},
        inboundChirps: {},
      },
    };
    return {
      servers: [entry],
      activeServerId: entry.id,
      ui: typed.ui?.theme ? { theme: typed.ui.theme } : { theme: "dark" },
    };
  }

  // Already multi-server shape or empty: pass through
  return {
    servers: Array.isArray(typed.servers) ? typed.servers : [],
    activeServerId: typeof typed.activeServerId === "string" ? typed.activeServerId : "",
    ui: typed.ui ? { theme: typed.ui.theme ?? "dark" } : { theme: "dark" },
  };
}

export const settings = new Store<Settings>({
  name: "settings",
  defaults,
});

// Run legacy migration synchronously on first import. Idempotent — calling
// migrateLegacyShape on a current-shape store is a no-op.
{
  const current = settings.store as unknown;
  const migrated = migrateLegacyShape(current);
  // Only write back if the migration actually changed something
  const changed = JSON.stringify(current) !== JSON.stringify(migrated);
  if (changed) {
    settings.clear();
    settings.set("servers", migrated.servers);
    settings.set("activeServerId", migrated.activeServerId);
    settings.set("ui", migrated.ui);
  }
}

export function addServer(label: string, serverUrl: string): ServerEntry {
  const id = randomUUID();
  const entry: ServerEntry = {
    id,
    label,
    serverUrl,
    userId: "",
    lastLoginMethod: "",
    lastSyncedMs: 0,
    voicePrefs: {
      volumes: {},
      keybinds: {},
      pttModes: {},
      voiceThresholds: {},
      monitored: [],
      outboundChirps: {},
      inboundChirps: {},
    },
  };
  const servers = settings.get("servers");
  settings.set("servers", [...servers, entry]);
  if (!settings.get("activeServerId")) {
    settings.set("activeServerId", id);
  }
  return entry;
}

export function removeServer(serverId: string): void {
  const servers = settings.get("servers").filter((s) => s.id !== serverId);
  settings.set("servers", servers);
  if (settings.get("activeServerId") === serverId) {
    settings.set("activeServerId", servers[0]?.id ?? "");
  }
}

export function setActiveServer(serverId: string): void {
  const servers = settings.get("servers");
  if (!servers.some((s) => s.id === serverId)) {
    throw new Error(`Unknown server: ${serverId}`);
  }
  settings.set("activeServerId", serverId);
}

export function updateServer(serverId: string, patch: Partial<ServerEntry>): ServerEntry {
  const servers = settings.get("servers");
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx < 0) throw new Error(`Unknown server: ${serverId}`);
  const updated: ServerEntry = { ...servers[idx], ...patch, id: servers[idx].id };
  const next = [...servers];
  next[idx] = updated;
  settings.set("servers", next);
  return updated;
}
