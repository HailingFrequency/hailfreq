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

/**
 * Pure migration function: converts legacy single-server shape to multi-server shape.
 * Exported for testing (Task 15).
 */
export function migrateLegacyShape(raw: unknown): Settings {
  const typed = raw as unknown as Settings & LegacyV1Settings;

  // Legacy detection: old shape had top-level serverUrl
  if (typeof typed.serverUrl === "string" && typed.serverUrl !== "" && !Array.isArray(typed.servers)) {
    const entry: ServerEntry = {
      id: randomUUID(),
      label: deriveLabel(typed.serverUrl),
      serverUrl: typed.serverUrl,
      userId: typed.userId ?? "",
      lastLoginMethod: typed.lastLoginMethod ?? "",
      lastSyncedMs: 0,
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
  // electron-store applies migrations top-down based on app version. Since we
  // didn't version the original schema, do the migration in beforeEachMigration.
  beforeEachMigration: (store) => {
    const migrated = migrateLegacyShape(store.store);
    // Replace the entire store atomically with the migrated shape
    store.clear();
    store.set("servers", migrated.servers);
    store.set("activeServerId", migrated.activeServerId);
    store.set("ui", migrated.ui);
  },
});

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
