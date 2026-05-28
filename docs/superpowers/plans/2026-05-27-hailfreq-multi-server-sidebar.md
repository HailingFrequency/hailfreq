# Hailfreq Multi-Server Sidebar Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-style multi-server support to the Hailfreq client. A member can configure multiple Hailfreq servers (e.g., their primary guild + an allied org server) and switch between them via a sidebar of server icons. Each server keeps a fully independent Matrix account with its own encryption keys, Recovery Key, device verification state, and room list. After Plan 3, members can be in multiple guilds simultaneously and switch context with one click.

**Architecture:** Extend Plan 2's single-server AppState into a multi-server AppState. Settings storage grows from a single `serverUrl` + `userId` to an array of `ServerEntry` records with an `activeServerId`. Token storage moves from one `credentials.enc` file to one-per-server: `credentials/<serverId>.enc`. Each server maintains its own `ClientHandle` running its own `MatrixClient` with `startClient()` invoked at boot. The sidebar UI is a vertical strip of server icons on the left edge; the rest of the window shows the active server's content (which today is just the placeholder Home screen — Plan 4 fills it with the tactical UI).

**Tech Stack:** Same as Plan 2 (Electron 42 + React 18 + TypeScript 5 + Vite + matrix-js-sdk 35 + Tailwind). No new heavy dependencies.

**Scope reference:** Implements §2.1 (multi-server in v1), §7.5 (multi-server sidebar) of the Hailfreq design spec. Does NOT implement OS-level notifications, system tray, federation, or tactical-radio voice features.

**Repo location:** All changes go under `client/`. Existing files in `client/src/main/store.ts`, `client/src/main/tokens.ts`, `client/src/shared/ipc.ts`, `client/src/renderer/AppState.tsx`, and all screens in `client/src/renderer/screens/` will be modified.

**Out of scope:**
- OS-level desktop notifications (visible in-app unread badges only)
- System tray icon
- Multi-server voice (Plan 4 will handle voice with the active-server-only model initially)
- CitizenID OAuth client registration per server (each server already manages its own CitizenID integrator config — see Plan 1's `docs/citizenid-setup.md`)
- Cross-server search

---

## Task 1: Data model — ServerEntry + multi-server settings type

**Files:**
- Modify: `client/src/shared/types.ts` (extend Settings type)

The shape change:

**Before (Plan 2):**
```ts
interface Settings {
  serverUrl: string;
  userId: string;
  lastLoginMethod: "" | "citizenid" | "local";
  ui: { theme: "dark" };
}
```

**After (Plan 3):**
```ts
interface ServerEntry {
  id: string;                              // UUID generated when server is added
  label: string;                           // Display name, e.g., "Stokowski's Star Patrol"
  serverUrl: string;
  userId: string;                          // Empty until logged in
  lastLoginMethod: "" | "citizenid" | "local";
  lastSyncedMs: number;                    // For sidebar unread display (Plan 3 v2 — start with 0)
}

interface Settings {
  servers: ServerEntry[];
  activeServerId: string;                  // Empty if no servers configured
  ui: { theme: "dark" };
}
```

- [ ] **Step 1: Update `client/src/shared/types.ts`**

Replace the `Settings` interface with the new multi-server shape. Add the `ServerEntry` interface. Keep them adjacent and well-commented.

```ts
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
}

export interface Settings {
  /** All configured servers. May be empty (first-run). */
  servers: ServerEntry[];
  /** ID of the currently-active (foregrounded) server. Empty when no servers exist. */
  activeServerId: string;
  /** UI preferences. */
  ui: { theme: "dark" };
}
```

- [ ] **Step 2: Verify type-only change compiles**

```bash
cd /home/shreen/code/tactical-radio/client
npx tsc -b 2>&1 | tail -10
# Expect: many errors because everything still references the old Settings shape.
# That's OK — subsequent tasks fix those callers one at a time.
```

- [ ] **Step 3: Commit the type change**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts
git commit -m "client: extend Settings type for multi-server (breaks build intentionally)"
```

(It's normal and expected for this commit to leave the project not-compiling. Tasks 2 and 3 restore the build.)

---

## Task 2: Migration — old single-server settings → new multi-server settings

**Files:**
- Modify: `client/src/main/store.ts` (add migration logic + new defaults)

`electron-store` supports migrations. On first launch after the rename, detect old-shape settings (presence of `serverUrl` at top level), convert to a single ServerEntry, and clear the old keys.

- [ ] **Step 1: Update `client/src/main/store.ts`**

```ts
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

export const settings = new Store<Settings>({
  name: "settings",
  defaults,
  // electron-store applies migrations top-down based on app version. Since we
  // didn't version the original schema, do the migration in beforeEachMigration.
  beforeEachMigration: (store) => {
    const raw = store.store as unknown as Settings & LegacyV1Settings;
    // Legacy detection: old shape had top-level serverUrl
    if (typeof raw.serverUrl === "string" && raw.serverUrl !== "" && !Array.isArray(raw.servers)) {
      const entry: ServerEntry = {
        id: randomUUID(),
        label: deriveLabel(raw.serverUrl),
        serverUrl: raw.serverUrl,
        userId: raw.userId ?? "",
        lastLoginMethod: raw.lastLoginMethod ?? "",
        lastSyncedMs: 0,
      };
      // Replace the entire store atomically with the new shape
      store.clear();
      store.set("servers", [entry]);
      store.set("activeServerId", entry.id);
      store.set("ui", raw.ui?.theme ? { theme: raw.ui.theme } : { theme: "dark" });
    }
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
```

- [ ] **Step 2: Verify the migration logic**

Quick smoke test by manipulating a fake store in a Node REPL or vitest. Actually, the easier verification path is to update tests in Task 19 to cover this. For now just confirm the file compiles.

```bash
cd /home/shreen/code/tactical-radio/client
npx tsc -b 2>&1 | grep -E "store.ts" | tail -5
# Expect: no errors specific to store.ts
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/store.ts
git commit -m "client: store migration from single-server to multi-server schema"
```

---

## Task 3: IPC channels — settings + server-management

**Files:**
- Modify: `client/src/shared/ipc.ts` (extend channels)
- Modify: `client/src/main/ipc.ts` (register new handlers)
- Modify: `client/src/main/store.ts` (add server-management helpers)

The renderer needs IPC to: list servers, add a server, remove a server, switch active server, update a server's metadata after login.

- [ ] **Step 1: Add helpers to `client/src/main/store.ts`**

Append (so the file exports both the raw `settings` store and the management helpers):

```ts
export function addServer(label: string, serverUrl: string): ServerEntry {
  const id = randomUUID();
  const entry: ServerEntry = {
    id,
    label,
    serverUrl,
    userId: "",
    lastLoginMethod: "",
    lastSyncedMs: 0,
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
```

- [ ] **Step 2: Extend `client/src/shared/ipc.ts`**

Replace the existing `settings:get` and `settings:set` channels with the new shape, and add server-management channels:

```ts
import type { Settings, ServerEntry } from "./types";
// (other existing imports preserved)

export interface IpcChannels {
  // ...existing channels...
  "settings:get": { args: []; result: Settings };
  // settings:set is REMOVED — replaced by typed server-management channels below.
  // (Renderer can still write ui prefs via a separate `settings:setUi` channel.)
  "settings:setUi": { args: [Settings["ui"]]; result: Settings };
  "servers:add": { args: [{ label: string; serverUrl: string }]; result: ServerEntry };
  "servers:remove": { args: [{ serverId: string }]; result: void };
  "servers:setActive": { args: [{ serverId: string }]; result: void };
  "servers:update": { args: [{ serverId: string; patch: Partial<ServerEntry> }]; result: ServerEntry };
  // ...rest of channels...
}
```

**Important:** removing `settings:set` is a breaking change. Renderer callers (in screens/Login.tsx, screens/FirstRun.tsx, screens/AppState.tsx) currently call `settings:set` with partial updates. They'll need to be migrated to the new typed channels in subsequent tasks. For now, accept that the build breaks at those callers.

- [ ] **Step 3: Update `client/src/main/ipc.ts`**

Replace the `settings:set` handler with the new ones:

```ts
import { settings, addServer, removeServer, setActiveServer, updateServer } from "./store";

// inside registerIpcHandlers, remove the old "settings:set" handler and add:

ipcMain.handle("settings:setUi", (_event, ui: Settings["ui"]): Settings => {
  settings.set("ui", ui);
  return settings.store;
});

ipcMain.handle("servers:add", (_event, args: { label: string; serverUrl: string }) =>
  addServer(args.label, args.serverUrl),
);
ipcMain.handle("servers:remove", (_event, args: { serverId: string }) =>
  removeServer(args.serverId),
);
ipcMain.handle("servers:setActive", (_event, args: { serverId: string }) =>
  setActiveServer(args.serverId),
);
ipcMain.handle("servers:update", (_event, args: { serverId: string; patch: Partial<ServerEntry> }) =>
  updateServer(args.serverId, args.patch),
);
```

- [ ] **Step 4: Verify the main process compiles**

```bash
cd /home/shreen/code/tactical-radio/client
npx tsc -p tsconfig.node.json --noEmit 2>&1 | tail -10
# Expect: clean. The renderer side is still broken (Task 4+ fix that).
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/store.ts client/src/main/ipc.ts client/src/shared/ipc.ts
git commit -m "client: typed IPC channels for server management"
```

---

## Task 4: Token storage — keyed by server ID

**Files:**
- Modify: `client/src/main/tokens.ts` (one file per server)
- Modify: `client/src/shared/ipc.ts` (channel signatures take serverId)
- Modify: `client/src/main/ipc.ts` (route to per-server token funcs)

- [ ] **Step 1: Update `client/src/main/tokens.ts`**

Replace the single-file model with a per-server-ID model. Files live at `userData/credentials/<serverId>.enc` (or `.json` in HAILFREQ_TEST=1 mode).

```ts
import { safeStorage, app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";

interface StoredCredentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

function credentialsDir(): string {
  return path.join(app.getPath("userData"), "credentials");
}

function encryptedPath(serverId: string): string {
  return path.join(credentialsDir(), `${serverId}.enc`);
}

function plaintextPath(serverId: string): string {
  return path.join(credentialsDir(), `${serverId}.json`);
}

function isTestMode(): boolean {
  return process.env.HAILFREQ_TEST === "1";
}

export async function saveCredentials(serverId: string, creds: StoredCredentials): Promise<void> {
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
  if (isTestMode() && !safeStorage.isEncryptionAvailable()) {
    await fs.writeFile(plaintextPath(serverId), JSON.stringify(creds), { mode: 0o600 });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable; refusing to store tokens unencrypted.");
  }
  const buf = safeStorage.encryptString(JSON.stringify(creds));
  await fs.writeFile(encryptedPath(serverId), buf, { mode: 0o600 });
}

export async function loadCredentials(serverId: string): Promise<StoredCredentials | null> {
  // Try encrypted first
  try {
    const buf = await fs.readFile(encryptedPath(serverId));
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredCredentials;
  } catch (err) {
    if (!isNoEnt(err)) throw err;
  }
  // Fallback to plaintext (test mode)
  if (isTestMode()) {
    try {
      const json = await fs.readFile(plaintextPath(serverId), "utf8");
      return JSON.parse(json) as StoredCredentials;
    } catch (err) {
      if (!isNoEnt(err)) throw err;
    }
  }
  return null;
}

export async function clearCredentials(serverId: string): Promise<void> {
  await fs.rm(encryptedPath(serverId), { force: true });
  await fs.rm(plaintextPath(serverId), { force: true });
}

function isNoEnt(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
```

- [ ] **Step 2: Update `client/src/shared/ipc.ts`** — token channels now take serverId

```ts
"tokens:save": { args: [{ serverId: string; credentials: StoredCredentials }]; result: void };
"tokens:load": { args: [{ serverId: string }]; result: StoredCredentials | null };
"tokens:clear": { args: [{ serverId: string }]; result: void };
```

- [ ] **Step 3: Update `client/src/main/ipc.ts`** — handlers thread serverId

```ts
ipcMain.handle("tokens:save", (_event, args: { serverId: string; credentials: StoredCredentials }) =>
  saveCredentials(args.serverId, args.credentials),
);
ipcMain.handle("tokens:load", (_event, args: { serverId: string }) => loadCredentials(args.serverId));
ipcMain.handle("tokens:clear", (_event, args: { serverId: string }) => clearCredentials(args.serverId));
```

- [ ] **Step 4: Migration of existing token file**

For a single existing user upgrading from Plan 2, the old single `credentials.enc` file exists at `userData/credentials.enc`. The migration in store.ts (Task 2) creates a single ServerEntry with a new ID. We need to move the token file to match.

Add a one-time migration helper to `client/src/main/tokens.ts`:

```ts
/**
 * Move a legacy single-credentials.enc file into the new per-server location.
 * Idempotent: no-op if the legacy file doesn't exist.
 */
export async function migrateLegacyCredentials(newServerId: string): Promise<void> {
  const legacyPath = path.join(app.getPath("userData"), "credentials.enc");
  try {
    await fs.access(legacyPath);
  } catch {
    return; // No legacy file
  }
  await fs.mkdir(credentialsDir(), { recursive: true, mode: 0o700 });
  await fs.rename(legacyPath, encryptedPath(newServerId));
}
```

Call this from main/index.ts right after `app.whenReady()`, before window creation, BUT only when migration triggers (i.e., when `settings.servers` has exactly one entry with a fresh UUID and a legacy credentials.enc exists).

Add to `client/src/main/index.ts`:

```ts
import { settings } from "./store";
import { migrateLegacyCredentials } from "./tokens";

app.whenReady().then(async () => {
  registerIpcHandlers();
  // If migration just ran (single server with no token file yet), move the legacy token
  const servers = settings.get("servers");
  if (servers.length === 1) {
    await migrateLegacyCredentials(servers[0].id);
  }
  mainWindow = createMainWindow();
  // ... rest of existing logic
});
```

- [ ] **Step 5: Verify build of main process**

```bash
cd /home/shreen/code/tactical-radio/client
npx tsc -p tsconfig.node.json --noEmit 2>&1 | tail -5
# Expect: clean
```

- [ ] **Step 6: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/tokens.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/main/index.ts
git commit -m "client: per-server token storage with legacy credentials migration"
```

---

## Task 5: AppState — multi-client management

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (substantial refactor)

This is the central task. AppState moves from "manages one client + one route" to "manages a Map<serverId, ServerInstance> + a current active server".

A `ServerInstance` represents a single server in its lifecycle. It has:
- The `ServerEntry` from settings
- An optional `ClientHandle` (after login + crypto bootstrap)
- A per-server screen state: `loading | login | encryption-setup | restore-from-recovery | home`

The application-level screen is determined by the active server's screen state. When no servers are configured: show first-run-style "add your first server" screen.

- [ ] **Step 1: Rewrite `client/src/renderer/AppState.tsx`**

This is a substantial rewrite. The new top-level structure:

```tsx
import { useEffect, useState } from "react";
import type { Settings, ServerEntry } from "@shared/types";
import type { ClientHandle } from "./matrix/client";
import { startClient } from "./matrix/client";
import { Sidebar } from "./components/Sidebar";
import { AddServer } from "./screens/AddServer";
import { Login } from "./screens/Login";
import { EncryptionSetup } from "./screens/EncryptionSetup";
import { RestoreFromRecoveryKey } from "./screens/RestoreFromRecoveryKey";
import { Home } from "./screens/Home";

interface ServerInstance {
  entry: ServerEntry;
  handle?: ClientHandle;
  screen:
    | { kind: "login" }
    | { kind: "encryption-setup"; password: string | null }
    | { kind: "restore-from-recovery" }
    | { kind: "home" }
    | { kind: "error"; message: string };
}

interface AppLevelState {
  servers: Map<string, ServerInstance>;
  activeServerId: string;     // "" when no servers
  globalScreen:
    | { kind: "loading" }
    | { kind: "no-servers" }            // shows AddServer in standalone mode
    | { kind: "active" }                // shows sidebar + active server's content
    | { kind: "adding-server" };        // shows sidebar + AddServer overlay
}

export function AppState() {
  const [state, setState] = useState<AppLevelState>({
    servers: new Map(),
    activeServerId: "",
    globalScreen: { kind: "loading" },
  });

  // Boot: load settings, initialize a ServerInstance per configured server,
  // attempt auto-resume for each (validate stored token via /whoami; if valid,
  // start the client and route that server to "home"; if not, route to "login").
  useEffect(() => {
    void (async () => {
      const settings = await window.hailfreq.invoke("settings:get");
      const servers = new Map<string, ServerInstance>();
      for (const entry of settings.servers) {
        const instance = await initServer(entry);
        servers.set(entry.id, instance);
      }
      const activeServerId = settings.activeServerId || settings.servers[0]?.id || "";
      const globalScreen: AppLevelState["globalScreen"] =
        settings.servers.length === 0 ? { kind: "no-servers" } : { kind: "active" };
      setState({ servers, activeServerId, globalScreen });
    })();
    return () => {
      // shutdown all clients on app unmount (rare — Electron usually quits the whole process)
      setState((s) => {
        s.servers.forEach((srv) => srv.handle?.shutdown().catch(() => undefined));
        return s;
      });
    };
  }, []);

  // ... handlers for switching active server, adding a server, removing, login, encryption, etc.

  return renderAppLevelState(state, setState);
}

/**
 * Probe stored credentials and start the client if valid; otherwise route to login.
 */
async function initServer(entry: ServerEntry): Promise<ServerInstance> {
  const stored = await window.hailfreq.invoke("tokens:load", { serverId: entry.id });
  if (stored && stored.userId === entry.userId) {
    try {
      const ok = await validateAccessToken(stored.homeserverUrl, stored.accessToken);
      if (ok) {
        const handle = await startClient({
          userId: stored.userId,
          accessToken: stored.accessToken,
          deviceId: stored.deviceId,
          homeserverUrl: stored.homeserverUrl,
        });
        return { entry, handle, screen: { kind: "home" } };
      }
    } catch (err) {
      // Token expired or homeserver unreachable
      await window.hailfreq.invoke("tokens:clear", { serverId: entry.id });
    }
  }
  return { entry, screen: { kind: "login" } };
}

async function validateAccessToken(homeserverUrl: string, accessToken: string): Promise<boolean> {
  try {
    const r = await fetch(`${homeserverUrl}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return r.ok;
  } catch {
    return false;
  }
}

function renderAppLevelState(state: AppLevelState, setState: React.Dispatch<...>): JSX.Element {
  if (state.globalScreen.kind === "loading") {
    return <Centered>Loading…</Centered>;
  }
  if (state.globalScreen.kind === "no-servers") {
    return (
      <AddServer
        onAdded={async (entry) => {
          // Inserted; transition to active server with that entry
          const instance = await initServer(entry);
          setState((s) => ({
            ...s,
            servers: new Map(s.servers).set(entry.id, instance),
            activeServerId: entry.id,
            globalScreen: { kind: "active" },
          }));
        }}
        cancellable={false}
      />
    );
  }
  // Active or adding-server: sidebar + main content
  const active = state.servers.get(state.activeServerId);
  return (
    <div className="flex h-full">
      <Sidebar
        servers={Array.from(state.servers.values()).map((s) => s.entry)}
        activeServerId={state.activeServerId}
        onSelect={(id) => setState((s) => ({ ...s, activeServerId: id, globalScreen: { kind: "active" } }))}
        onAddClicked={() => setState((s) => ({ ...s, globalScreen: { kind: "adding-server" } }))}
      />
      <div className="flex-1">
        {state.globalScreen.kind === "adding-server" ? (
          <AddServer
            onAdded={async (entry) => {
              const instance = await initServer(entry);
              setState((s) => ({
                ...s,
                servers: new Map(s.servers).set(entry.id, instance),
                activeServerId: entry.id,
                globalScreen: { kind: "active" },
              }));
            }}
            onCancel={() => setState((s) => ({ ...s, globalScreen: { kind: "active" } }))}
            cancellable={true}
          />
        ) : (
          renderActiveServerScreen(active!, state, setState)
        )}
      </div>
    </div>
  );
}

function renderActiveServerScreen(
  active: ServerInstance,
  state: AppLevelState,
  setState: React.Dispatch<...>,
): JSX.Element {
  // Mirrors Plan 2's per-screen routing, but scoped to the active server's instance state
  switch (active.screen.kind) {
    case "login":
      return (
        <Login
          serverUrl={active.entry.serverUrl}
          onLoggedIn={async (creds, password) => {
            await window.hailfreq.invoke("tokens:save", { serverId: active.entry.id, credentials: creds });
            await window.hailfreq.invoke("servers:update", {
              serverId: active.entry.id,
              patch: { userId: creds.userId, lastLoginMethod: password ? "local" : "citizenid" },
            });
            const handle = await startClient(creds);
            setState((s) => updateServer(s, active.entry.id, {
              handle,
              screen: { kind: "encryption-setup", password },
            }));
          }}
        />
      );
    case "encryption-setup":
      return (
        <EncryptionSetup
          client={active.handle!.client}
          password={active.screen.password}
          onDone={() => setState((s) => updateServer(s, active.entry.id, { screen: { kind: "home" } }))}
          onNeedsExistingRecovery={() =>
            setState((s) => updateServer(s, active.entry.id, { screen: { kind: "restore-from-recovery" } }))
          }
        />
      );
    case "restore-from-recovery":
      return (
        <RestoreFromRecoveryKey
          client={active.handle!.client}
          onRestored={() => setState((s) => updateServer(s, active.entry.id, { screen: { kind: "home" } }))}
        />
      );
    case "home":
      return (
        <Home
          client={active.handle!.client}
          onLogout={async () => {
            await active.handle?.shutdown();
            await window.hailfreq.invoke("tokens:clear", { serverId: active.entry.id });
            await window.hailfreq.invoke("servers:update", {
              serverId: active.entry.id,
              patch: { userId: "", lastLoginMethod: "" },
            });
            setState((s) => updateServer(s, active.entry.id, { handle: undefined, screen: { kind: "login" } }));
          }}
        />
      );
    case "error":
      return <Centered>{active.screen.message}</Centered>;
  }
}

function updateServer(
  state: AppLevelState,
  serverId: string,
  patch: Partial<ServerInstance>,
): AppLevelState {
  const existing = state.servers.get(serverId);
  if (!existing) return state;
  const next = new Map(state.servers);
  next.set(serverId, { ...existing, ...patch });
  return { ...state, servers: next };
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center"><p className="text-sm text-slate-400">{children}</p></div>;
}
```

(Above is illustrative — the implementer will need to fill in types, fix the React.Dispatch signature, and wire the SAS verification subscription per server.)

- [ ] **Step 2: Stub the new screens not yet created**

`AddServer` (Task 6) and `Sidebar` (Task 7) don't exist yet. To keep build passing during this task, create temporary stubs that export empty components, then implement them properly in the next two tasks.

```tsx
// client/src/renderer/screens/AddServer.tsx (stub)
import type { ServerEntry } from "@shared/types";
interface Props { onAdded: (e: ServerEntry) => void; onCancel?: () => void; cancellable: boolean; }
export function AddServer(_props: Props) { return <div>AddServer (Task 6)</div>; }

// client/src/renderer/components/Sidebar.tsx (stub)
import type { ServerEntry } from "@shared/types";
interface Props { servers: ServerEntry[]; activeServerId: string; onSelect: (id: string) => void; onAddClicked: () => void; }
export function Sidebar(_props: Props) { return <div className="w-16 border-r border-slate-800">Sidebar (Task 7)</div>; }
```

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -10
# Expect: success (after fixing any straggler type issues)
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx client/src/renderer/screens/AddServer.tsx client/src/renderer/components/Sidebar.tsx
git commit -m "client: multi-server AppState with per-server lifecycle management"
```

---

## Task 6: AddServer screen

**Files:**
- Replace stub: `client/src/renderer/screens/AddServer.tsx`

This screen combines first-run flavor (server URL + probe + label) into a single form. Used both as the no-servers initial screen AND as the add-another-server overlay.

- [ ] **Step 1: Write `client/src/renderer/screens/AddServer.tsx`**

```tsx
import { useState } from "react";
import type { ServerEntry } from "@shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { normalizeUrl } from "./firstRunUtils";

interface AddServerProps {
  onAdded: (entry: ServerEntry) => void;
  onCancel?: () => void;
  cancellable: boolean;
}

async function probeHomeserver(url: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${url}/_matrix/client/versions`, { method: "GET" });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const body = await r.json();
    if (!Array.isArray(body?.versions)) return { ok: false, reason: "not a Matrix homeserver" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unreachable" };
  }
}

function deriveLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host.split(".");
    const root = parts.length >= 2 ? parts[parts.length - 2] : host;
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return url;
  }
}

export function AddServer({ onAdded, onCancel, cancellable }: AddServerProps) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const normalized = normalizeUrl(url);
      const probe = await probeHomeserver(normalized);
      if (!probe.ok) throw new Error(`Could not reach Matrix homeserver at ${normalized}: ${probe.reason}`);
      const finalLabel = label.trim() || deriveLabel(normalized);
      const entry = await window.hailfreq.invoke("servers:add", {
        label: finalLabel,
        serverUrl: normalized,
      });
      onAdded(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">
          {cancellable ? "Add a server" : "Welcome to Hailfreq"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your guild's Hailfreq server address.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Server URL"
          placeholder="radio.your-guild.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (!labelTouched) setLabel(deriveLabel(normalizeUrl(e.target.value || "x")));
          }}
          autoFocus
          required
        />
        <Input
          label="Display label"
          placeholder="My Guild"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
          hint="Shown in the server sidebar."
          error={error || undefined}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={!url.trim() || busy}>
            {busy ? "Checking…" : "Add server"}
          </Button>
          {cancellable && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/AddServer.tsx
git commit -m "client: AddServer screen with URL probe + display label"
```

---

## Task 7: Sidebar component

**Files:**
- Replace stub: `client/src/renderer/components/Sidebar.tsx`
- Create: `client/src/renderer/components/ServerIcon.tsx`

Discord-style vertical strip of icons on the left. Each icon is a round button with the server's initial (first letter of label). Active server has a brand-colored bar on the left and full-opacity icon; inactive servers are dimmed.

- [ ] **Step 1: Write `client/src/renderer/components/ServerIcon.tsx`**

```tsx
import type { ServerEntry } from "@shared/types";

interface ServerIconProps {
  server: ServerEntry;
  active: boolean;
  onClick: () => void;
}

export function ServerIcon({ server, active, onClick }: ServerIconProps) {
  const initial = (server.label.trim()[0] ?? server.serverUrl[0] ?? "?").toUpperCase();
  return (
    <button
      onClick={onClick}
      title={`${server.label} — ${server.serverUrl}`}
      className={`relative flex h-12 w-12 items-center justify-center rounded-lg text-base font-semibold transition-all ${
        active
          ? "bg-brand-500 text-slate-900 ring-2 ring-brand-400 ring-offset-2 ring-offset-slate-950"
          : "bg-slate-800 text-slate-200 hover:bg-slate-700 hover:rounded-xl"
      }`}
    >
      {active && (
        <span className="absolute -left-3 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-brand-400" />
      )}
      {initial}
    </button>
  );
}
```

- [ ] **Step 2: Write `client/src/renderer/components/Sidebar.tsx`**

```tsx
import type { ServerEntry } from "@shared/types";
import { ServerIcon } from "./ServerIcon";

interface SidebarProps {
  servers: ServerEntry[];
  activeServerId: string;
  onSelect: (serverId: string) => void;
  onAddClicked: () => void;
}

export function Sidebar({ servers, activeServerId, onSelect, onAddClicked }: SidebarProps) {
  return (
    <aside className="flex w-20 flex-col items-center gap-3 border-r border-slate-800 bg-slate-950 py-4">
      {servers.map((server) => (
        <ServerIcon
          key={server.id}
          server={server}
          active={server.id === activeServerId}
          onClick={() => onSelect(server.id)}
        />
      ))}
      <button
        onClick={onAddClicked}
        title="Add server"
        className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-700 text-2xl font-light text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-400"
      >
        +
      </button>
    </aside>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/Sidebar.tsx client/src/renderer/components/ServerIcon.tsx
git commit -m "client: Sidebar + ServerIcon for Discord-style server switcher"
```

---

## Task 8: Remove-server flow

**Files:**
- Create: `client/src/renderer/components/ServerContextMenu.tsx`
- Modify: `client/src/renderer/components/Sidebar.tsx` (right-click → menu)

Right-click a server icon → opens a menu with "Remove from Hailfreq" (with confirmation). On remove: shutdown the client, clear tokens, remove from settings.

- [ ] **Step 1: Write `client/src/renderer/components/ServerContextMenu.tsx`**

```tsx
import type { ServerEntry } from "@shared/types";
import { useState } from "react";
import { Button } from "./Button";

interface Props {
  server: ServerEntry;
  onClose: () => void;
  onRemove: () => Promise<void>;
}

export function ServerContextMenu({ server, onClose, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    setBusy(true);
    try {
      await onRemove();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <>
            <h2 className="text-lg font-semibold text-brand-400">Remove this server?</h2>
            <p className="mt-2 text-sm text-slate-300">
              You'll be signed out of <strong>{server.label}</strong>. Your encryption keys
              for this server will be cleared from this device.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              If you re-add this server later, you'll need your Recovery Key or another
              signed-in device to decrypt encrypted message history.
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={handleRemove} disabled={busy}>
                {busy ? "Removing…" : "Yes, remove"}
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-brand-400">{server.label}</h2>
            <p className="mt-1 text-xs text-slate-500">{server.serverUrl}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Remove from Hailfreq…
              </Button>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire right-click in Sidebar**

Update `client/src/renderer/components/Sidebar.tsx` to track which server has its context menu open. Pass `onRequestContextMenu` to ServerIcon; ServerIcon adds an `onContextMenu` handler that calls it.

```tsx
import { useState } from "react";
import type { ServerEntry } from "@shared/types";
import { ServerIcon } from "./ServerIcon";
import { ServerContextMenu } from "./ServerContextMenu";

interface SidebarProps {
  servers: ServerEntry[];
  activeServerId: string;
  onSelect: (serverId: string) => void;
  onAddClicked: () => void;
  onRemoveServer: (serverId: string) => Promise<void>;
}

export function Sidebar(props: SidebarProps) {
  const [contextMenuFor, setContextMenuFor] = useState<ServerEntry | null>(null);
  // ... existing rendering, but wire onContextMenu on each ServerIcon to setContextMenuFor(server)
  return (
    <>
      <aside className="...">
        {/* ...existing icons + add button, with onContextMenu wired */}
      </aside>
      {contextMenuFor && (
        <ServerContextMenu
          server={contextMenuFor}
          onClose={() => setContextMenuFor(null)}
          onRemove={() => props.onRemoveServer(contextMenuFor.id)}
        />
      )}
    </>
  );
}
```

Update `ServerIcon` to accept `onContextMenu` and wire it to the `<button>`'s onContextMenu handler.

- [ ] **Step 3: Wire `onRemoveServer` in AppState**

```tsx
async function handleRemoveServer(serverId: string) {
  const instance = state.servers.get(serverId);
  if (!instance) return;
  await instance.handle?.shutdown();
  await window.hailfreq.invoke("tokens:clear", { serverId });
  await window.hailfreq.invoke("servers:remove", { serverId });
  // Update local state
  setState((s) => {
    const next = new Map(s.servers);
    next.delete(serverId);
    const newActiveId = s.activeServerId === serverId
      ? (next.values().next().value?.entry.id ?? "")
      : s.activeServerId;
    return {
      ...s,
      servers: next,
      activeServerId: newActiveId,
      globalScreen: next.size === 0 ? { kind: "no-servers" } : { kind: "active" },
    };
  });
}
```

- [ ] **Step 4: Build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/Sidebar.tsx client/src/renderer/components/ServerIcon.tsx client/src/renderer/components/ServerContextMenu.tsx client/src/renderer/AppState.tsx
git commit -m "client: remove-server flow via right-click context menu"
```

---

## Task 9: Login + Encryption + Restore — per-server adaptation

**Files:**
- Modify: `client/src/renderer/screens/Login.tsx`
- Modify: `client/src/renderer/screens/EncryptionSetup.tsx`
- Modify: `client/src/renderer/screens/RestoreFromRecoveryKey.tsx`
- Modify: `client/src/renderer/screens/Home.tsx`

These screens are already mostly per-server-agnostic — they take a `serverUrl` or `client` prop and operate on that. The main change is that they no longer directly call `tokens:save` / `settings:set` — those are now handled in AppState's `onLoggedIn` callback which knows the active server's ID. Login.tsx's `handleLocalSubmit` and `handleCitizenIdLogin` should call back to the parent with `(creds, password)` and let AppState route both to per-server token storage AND the encryption flow.

**This task is mostly verifying nothing in Plan 2's screens broke from the IPC channel signature changes.** Specifically:

- `Login.tsx`: previously called `window.hailfreq.invoke("tokens:save", creds)` (single-arg) and `window.hailfreq.invoke("settings:set", { userId, lastLoginMethod })`. With the channel signature changes in Task 4, these calls won't typecheck.

  Two options:
  (a) Update Login.tsx to call `tokens:save` with `{ serverId, credentials }` — but Login doesn't know its serverId. Pass it as a prop.
  (b) Move both calls OUT of Login.tsx and into AppState's `onLoggedIn` handler. This is cleaner since AppState already knows the active server.

  **Pick option (b).** Strip Login.tsx of the IPC calls; it just calls `onLoggedIn(creds, password)`. AppState's handler does the persist + server update.

- `EncryptionSetup.tsx`, `RestoreFromRecoveryKey.tsx`, `Home.tsx`: don't call those IPC channels directly, so they don't need changes for this purpose. But verify all callers.

- [ ] **Step 1: Strip token+settings IPC from `Login.tsx`**

Remove the `window.hailfreq.invoke("tokens:save", ...)` and `window.hailfreq.invoke("settings:set", ...)` calls from both `handleLocalSubmit` and `handleCitizenIdLogin`. Just call `onLoggedIn(creds, password)` (or `onLoggedIn(creds, null)` for CitizenID).

- [ ] **Step 2: Confirm AppState performs the persist**

AppState's `onLoggedIn` handler in the per-server `login` case already does:
```tsx
await window.hailfreq.invoke("tokens:save", { serverId: active.entry.id, credentials: creds });
await window.hailfreq.invoke("servers:update", {
  serverId: active.entry.id,
  patch: { userId: creds.userId, lastLoginMethod: password ? "local" : "citizenid" },
});
```

Verify that's in place from Task 5. If not, add it.

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
# Expect: success
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/
git commit -m "client: move token+settings persistence from Login to AppState (per-server)"
```

---

## Task 10: SAS device verification per server

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (subscribe per server)

In Plan 2, SAS verification subscription was set up only when the active server was on the Home screen. With multi-server, each signed-in server can receive verification requests. We need to subscribe **per server** that's currently signed in, and show the verification UI when an incoming request arrives — even if the user isn't currently looking at that server.

- [ ] **Step 1: Add per-server verification subscription**

Inside AppState, add a useEffect keyed on `state.servers` (or a derived list of signed-in clients) that subscribes to each ClientHandle's verification events. When an incoming request arrives, the UI should:
- If the user is currently on the affected server: show EmojiVerification full-screen
- If the user is on a different server: switch the active server to the affected one, then show the verification

```tsx
useEffect(() => {
  const unsubs: Array<() => void> = [];
  state.servers.forEach((instance, serverId) => {
    if (!instance.handle) return;
    const unsub = subscribeToVerificationRequests(instance.handle.client, (incoming) => {
      // Bring this server's verification request into focus
      setState((s) => ({
        ...s,
        activeServerId: serverId,
        globalScreen: { kind: "active" },
        // Stash the incoming request in the per-server instance state:
        servers: new Map(s.servers).set(serverId, {
          ...instance,
          pendingVerification: incoming,
        }),
      }));
    });
    unsubs.push(unsub);
  });
  return () => unsubs.forEach((u) => u());
}, [state.servers]);
```

(Update `ServerInstance` to include `pendingVerification?: IncomingVerification`. Add rendering logic in `renderActiveServerScreen` that, when `pendingVerification` is non-null, shows EmojiVerification as a fullscreen overlay.)

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/AppState.tsx
git commit -m "client: per-server SAS verification subscription with auto-focus"
```

---

## Task 11: Logout updates label freshness

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (already done in Task 5 — verify)

When a user logs out of a server, the server entry stays in settings (the user might want to log back in). The Home onLogout handler from Plan 2 clears tokens + userId; in Plan 3 that's per-server. Verify Task 5's logout flow is still correct.

- [ ] **Step 1: Verify the existing logout handler**

In AppState's `renderActiveServerScreen` → `home` case, the onLogout handler should:
- `await active.handle?.shutdown()`
- `await window.hailfreq.invoke("tokens:clear", { serverId: active.entry.id })`
- `await window.hailfreq.invoke("servers:update", { serverId, patch: { userId: "", lastLoginMethod: "" } })`
- Transition that server's screen back to `login` (NOT remove the server)

Confirm this is what's there from Task 5. If anything's missing, add it.

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: (Possibly empty) commit**

If you made any adjustments, commit with: `git commit -m "client: ensure logout preserves server entry for re-login"`. Otherwise skip.

---

## Task 12: Notifications — basic in-app unread badges

**Files:**
- Modify: `client/src/renderer/components/ServerIcon.tsx` (show unread badge)
- Modify: `client/src/renderer/AppState.tsx` (track per-server unread counts)

For each signed-in server, listen for `Room.timeline` events. If a new message arrives in a room while the server isn't the active server (or the user is on a different page in that server), increment a per-server unread counter. Show as a small red badge on the server icon.

- [ ] **Step 1: Add per-server unread state**

In `ServerInstance`, add `unreadCount: number` (default 0). Add a useEffect per signed-in server that subscribes to `RoomEvent.Timeline` (or `ClientEvent.Room` for new messages) and increments unread for non-active servers:

```tsx
useEffect(() => {
  const unsubs: Array<() => void> = [];
  state.servers.forEach((instance, serverId) => {
    if (!instance.handle) return;
    const handler = (event: MatrixEvent, room: Room | undefined) => {
      if (!room || event.getSender() === instance.handle!.client.getUserId()) return;
      if (event.getType() !== "m.room.message" && event.getType() !== "m.room.encrypted") return;
      if (serverId === state.activeServerId) return; // user is looking at this server
      setState((s) => {
        const inst = s.servers.get(serverId);
        if (!inst) return s;
        const next = new Map(s.servers);
        next.set(serverId, { ...inst, unreadCount: inst.unreadCount + 1 });
        return { ...s, servers: next };
      });
    };
    instance.handle.client.on(RoomEvent.Timeline as any, handler);
    unsubs.push(() => instance.handle!.client.off(RoomEvent.Timeline as any, handler));
  });
  return () => unsubs.forEach((u) => u());
}, [state.servers, state.activeServerId]);
```

(Import `RoomEvent` from matrix-js-sdk. Note the `as any` is to bypass the typed-event-emitter generic, similar to Home.tsx's usage.)

- [ ] **Step 2: Reset unread when switching to a server**

In the `onSelect` Sidebar callback inside AppState, reset that server's unread count to 0:

```tsx
onSelect={(id) => setState((s) => {
  const inst = s.servers.get(id);
  const servers = new Map(s.servers);
  if (inst) servers.set(id, { ...inst, unreadCount: 0 });
  return { ...s, servers, activeServerId: id, globalScreen: { kind: "active" } };
})}
```

- [ ] **Step 3: Show badge on ServerIcon**

Update `ServerIcon` to accept `unreadCount?: number` prop. When > 0, render a small red badge in the top-right corner.

```tsx
{props.unreadCount && props.unreadCount > 0 ? (
  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-xs font-semibold text-white">
    {props.unreadCount > 99 ? "99+" : props.unreadCount}
  </span>
) : null}
```

Update the Sidebar component to thread `unreadCount` from each server's instance state.

- [ ] **Step 4: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/ServerIcon.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/AppState.tsx
git commit -m "client: per-server unread badges in sidebar"
```

---

## Task 13: Tooltip + label edit

**Files:**
- Modify: `client/src/renderer/components/ServerContextMenu.tsx` (add "Rename" option)

Add a "Rename" option to the server context menu so users can change a server's display label.

- [ ] **Step 1: Add rename UI in ServerContextMenu**

State: `renaming` boolean, `newLabel` string. When clicked "Rename", show an Input + Save/Cancel buttons. On Save, call `servers:update` with the new label.

(Sketch the implementation — straightforward modification of the existing modal.)

- [ ] **Step 2: Wire the rename callback through Sidebar → AppState**

AppState gets an `onRenameServer(serverId, newLabel)` handler that calls `servers:update` and updates local state.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -3
git add client/src/renderer/components/ServerContextMenu.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/AppState.tsx
git commit -m "client: rename server label via context menu"
```

---

## Task 14: Drag-to-reorder (optional polish)

**Files:**
- Modify: `client/src/renderer/components/Sidebar.tsx` (HTML5 drag-and-drop)
- Modify: `client/src/main/store.ts` (add reorderServers helper)
- Modify: `client/src/shared/ipc.ts` + `client/src/main/ipc.ts` (add `servers:reorder` channel)

Users with multiple servers want to control the sidebar order. Use HTML5 native drag-and-drop on the ServerIcon buttons.

This task is **optional polish** — feel free to skip and defer to v1.5 if you want to keep Plan 3 lean. If skipping, mark Task 14 as completed without changes and note that in the implementation summary.

- [ ] **Step 1: Add `reorderServers` to store.ts** (if doing this task)

```ts
export function reorderServers(newOrder: string[]): void {
  const servers = settings.get("servers");
  const byId = new Map(servers.map((s) => [s.id, s]));
  const reordered = newOrder.map((id) => byId.get(id)).filter((s): s is ServerEntry => !!s);
  // Append any servers that were missed (defensive)
  for (const s of servers) {
    if (!newOrder.includes(s.id)) reordered.push(s);
  }
  settings.set("servers", reordered);
}
```

- [ ] **Step 2: Add IPC channel + handler**

```ts
"servers:reorder": { args: [{ orderedIds: string[] }]; result: void };
```

- [ ] **Step 3: Wire HTML5 drag-and-drop in Sidebar**

```tsx
// ServerIcon receives draggable=true + onDragStart sets dataTransfer with the serverId
// Sidebar's container has onDragOver + onDrop that computes the new order and calls servers:reorder
```

- [ ] **Step 4: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -3
git add ...
git commit -m "client: drag-to-reorder server sidebar"
```

---

## Task 15: Vitest unit tests for store migration

**Files:**
- Create: `client/tests/unit/storeMigration.test.ts`

The settings migration logic (legacy single-server → multi-server) is critical and not exercised by E2E. Unit-test it directly.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// electron-store is hard to test in a Node environment — for unit testing we
// extract the pure migration function from store.ts. Refactor store.ts to
// export `migrateLegacyShape(rawStore: unknown): Settings` and have the
// `beforeEachMigration` callback call it.

import { migrateLegacyShape } from "@/main/store";
import type { Settings } from "@shared/types";

describe("migrateLegacyShape", () => {
  it("converts a legacy single-server store to multi-server", () => {
    const legacy = {
      serverUrl: "https://radio.example.com",
      userId: "@alice:example.com",
      lastLoginMethod: "local",
      ui: { theme: "dark" },
    };
    const migrated = migrateLegacyShape(legacy);
    expect(migrated.servers).toHaveLength(1);
    expect(migrated.servers[0].serverUrl).toBe("https://radio.example.com");
    expect(migrated.servers[0].userId).toBe("@alice:example.com");
    expect(migrated.servers[0].lastLoginMethod).toBe("local");
    expect(migrated.servers[0].label).toBe("Example");
    expect(migrated.activeServerId).toBe(migrated.servers[0].id);
    expect(migrated.ui.theme).toBe("dark");
  });

  it("leaves an already-migrated store alone", () => {
    const current: Settings = {
      servers: [{
        id: "abc",
        label: "Test",
        serverUrl: "https://x.com",
        userId: "@u:x",
        lastLoginMethod: "citizenid",
        lastSyncedMs: 0,
      }],
      activeServerId: "abc",
      ui: { theme: "dark" },
    };
    const migrated = migrateLegacyShape(current);
    expect(migrated).toEqual(current);
  });

  it("handles a totally fresh store (defaults)", () => {
    const empty = {};
    const migrated = migrateLegacyShape(empty);
    expect(migrated.servers).toEqual([]);
    expect(migrated.activeServerId).toBe("");
    expect(migrated.ui.theme).toBe("dark");
  });
});
```

(The implementer will need to refactor store.ts to extract a pure `migrateLegacyShape` function that the `beforeEachMigration` callback delegates to. This makes the migration testable in isolation.)

- [ ] **Step 2: Run tests**

```bash
cd /home/shreen/code/tactical-radio/client
npx vitest run 2>&1 | tail -10
# Expect: previous 5 tests + 3 new migration tests all pass
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/storeMigration.test.ts client/src/main/store.ts
git commit -m "client: unit tests for legacy-to-multi-server settings migration"
```

---

## Task 16: Playwright E2E — two-server scenario

**Files:**
- Modify: `client/tests/e2e/helpers/synapse.ts` (support starting TWO independent Synapse instances)
- Create: `client/tests/e2e/multi-server.spec.ts`

Spin up two Synapse instances on different ports (8008 and 8009) via two separate compose overrides. Each gets its own provisioned user. The test:

1. Launches Hailfreq, completes first-run on server A.
2. Logs in to server A, completes encryption setup.
3. Clicks the "+ Add server" button in the sidebar.
4. Adds server B (different URL, label).
5. Logs in to server B, completes encryption setup.
6. Verifies the sidebar shows both servers.
7. Clicks server A's icon — verifies the Home screen shows server A's user.
8. Clicks server B's icon — verifies the Home screen shows server B's user.
9. Right-clicks server A and removes it.
10. Verifies only server B is left.

This is the most important test in Plan 3. It validates that the entire multi-server lifecycle works end-to-end.

- [ ] **Step 1: Extend `synapse.ts` helper to support N instances**

The current helper assumes a single Synapse. Generalize to support multiple by accepting an "instance name" + port that pre-overrides the compose project name. Each instance gets its own `compose.override.yml` and its own podman compose project (using `--project-name`).

```ts
export async function startSynapseInstance(
  name: string,           // e.g., "alpha" or "beta"
  hostPort: number,       // e.g., 8008 or 8009
): Promise<SynapseInstance> {
  // Use `podman compose --project-name hailfreq-${name}` for full isolation
  // ...same setup as before, but parameterized
}

export interface SynapseInstance {
  url: string;
  sharedSecret: string;
  username: string;
  password: string;
  cleanup: () => Promise<void>;
}
```

The implementer should isolate the data volume per instance: `--project-name hailfreq-alpha` creates volumes `hailfreq-alpha_postgres_data` and `hailfreq-alpha_synapse_data`, which don't collide with `hailfreq-beta`'s.

- [ ] **Step 2: Write `client/tests/e2e/multi-server.spec.ts`**

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { startSynapseInstance } from "./helpers/synapse";

test("two-server: add, switch, remove", async () => {
  const alpha = await startSynapseInstance("alpha", 8008);
  const beta = await startSynapseInstance("beta", 8009);
  try {
    const app = await electron.launch({ args: ["."], cwd: "<absolute client/ path>", env: { HAILFREQ_TEST: "1" } });
    const win = await app.firstWindow();

    // First-run with server A
    await win.getByText("Welcome to Hailfreq").waitFor();
    await win.getByLabel("Server URL").fill(alpha.url);
    await win.getByRole("button", { name: "Add server" }).click();

    // Login + encryption for server A
    await loginAndSetupEncryption(win, alpha);

    // Add server B
    await win.getByTitle("Add server").click();
    await win.getByLabel("Server URL").fill(beta.url);
    await win.getByRole("button", { name: "Add server" }).click();
    await loginAndSetupEncryption(win, beta);

    // Verify both server icons appear in sidebar
    // (Use getByTitle with the label/URL pattern from ServerIcon.tsx)
    await expect(win.getByTitle(/alpha/i)).toBeVisible();
    await expect(win.getByTitle(/beta/i)).toBeVisible();

    // Switch back to server A by clicking its icon, verify Home shows server A's user
    await win.getByTitle(/alpha/i).click();
    await expect(win.getByText(new RegExp(alpha.username))).toBeVisible();

    // Right-click server A, choose Remove, confirm
    await win.getByTitle(/alpha/i).click({ button: "right" });
    await win.getByRole("button", { name: /remove from hailfreq/i }).click();
    await win.getByRole("button", { name: /yes, remove/i }).click();

    // Verify only server B remains
    await expect(win.getByTitle(/alpha/i)).not.toBeVisible();
    await expect(win.getByText(new RegExp(beta.username))).toBeVisible();

    await app.close();
  } finally {
    await alpha.cleanup();
    await beta.cleanup();
  }
});

async function loginAndSetupEncryption(win: any, instance: { username: string; password: string }): Promise<void> {
  // Username + password
  await win.getByLabel("Username").fill(instance.username);
  await win.getByLabel("Password").fill(instance.password);
  await win.getByRole("button", { name: "Sign in" }).click();
  // Encryption setup — wait for Recovery Key screen
  await win.getByText("Save your Recovery Key").waitFor({ timeout: 30_000 });
  await win.getByLabel(/saved my Recovery Key/i).check();
  await win.getByRole("button", { name: /continue to hailfreq/i }).click();
  // Home shell
  await win.getByText(/Signed in as/).waitFor();
}
```

- [ ] **Step 3: Run the E2E**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build
npx playwright test multi-server 2>&1 | tail -20
# Expect: passes. Allow ~60-90s — two Synapse cold starts.
```

If the test fails at a specific step, debug that step. Don't fake a pass.

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/e2e/helpers/synapse.ts client/tests/e2e/multi-server.spec.ts
git commit -m "client: e2e two-server test for add/switch/remove flow"
```

---

## Task 17: Single-server E2E still passes

**Files:**
- Modify: `client/tests/e2e/firstrun.spec.ts` (adapt to new sidebar UI)

The existing Plan 2 E2E test (`firstrun.spec.ts`) needs minor adaptation:
- The "Welcome to Hailfreq" screen now appears in AddServer when no servers are configured (per Task 6). Same text, should still work.
- The Home screen rendering hasn't changed materially, but it's now wrapped in a Sidebar layout. The Home text assertions should still match.

Adjust the test if needed and confirm it still passes.

- [ ] **Step 1: Adapt and re-run**

```bash
cd /home/shreen/code/tactical-radio/client
npx playwright test firstrun 2>&1 | tail -10
# Expect: passes after minor selector adjustments if needed
```

- [ ] **Step 2: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/e2e/firstrun.spec.ts
git commit -m "client: adapt single-server e2e for multi-server-shell layout"
```

---

## Task 18: Rebuild installers

**Files:**
- (No new files)

After all the changes, rebuild Linux + Windows installers to confirm they still work.

- [ ] **Step 1: Linux**

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -10
ls -lh release/Hailfreq-*x86_64.AppImage
chmod +x release/Hailfreq-*x86_64.AppImage
timeout 5 ./release/Hailfreq-*x86_64.AppImage 2>&1 | head -5 || true
# Expect: AppImage built and starts without immediate crash
```

- [ ] **Step 2: Windows**

```bash
npm run dist:windows 2>&1 | tail -10
ls -lh release/Hailfreq-*-x64.exe
# Expect: .exe built (we can't smoke-test from Linux)
```

- [ ] **Step 3: Note the version in the report** — no commit needed unless artifacts have moved.

---

## Task 19: Update README

**Files:**
- Modify: `client/README.md`

Add a multi-server bullet to the "what the client does" list.

- [ ] **Step 1: Update `client/README.md`**

Insert in the feature list (after "Auto-resume on relaunch"):

```markdown
- Discord-style multi-server sidebar — be in multiple guilds simultaneously, switch with one click
- Per-server encryption isolation (each server has its own Recovery Key)
- In-app unread badges from inactive servers
```

- [ ] **Step 2: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md
git commit -m "docs(client): note multi-server features in README"
```

---

## Task 20: Update spec's "Open Questions" section

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-hailfreq-design.md`

Close out the spec's notes about multi-server now that Plan 3 has answers.

- [ ] **Step 1: Add a note to §7.5 in the spec**

After the existing multi-server description, add:

```markdown
**Implementation status:** Shipped in Plan 3. See `docs/superpowers/plans/2026-05-27-hailfreq-multi-server-sidebar.md`.
```

- [ ] **Step 2: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add docs/superpowers/specs/
git commit -m "docs(spec): mark §7.5 multi-server as implemented in Plan 3"
```

---

## Done

After Task 20, the deliverable is:

- A Hailfreq client that supports multiple Hailfreq servers simultaneously
- Discord-style sidebar with per-server icons, unread badges, drag-to-reorder (if Task 14 implemented), context menu for rename/remove
- Per-server encryption isolation (each server has its own Recovery Key, cross-signing keys, device verification state)
- Smooth migration from any Plan-2-era single-server install
- Unit tests for the migration logic
- Two E2E tests passing: single-server (regression check) + two-server (multi-server scenario)
- Linux AppImage + Windows nsis builds verified

**Next plans:**

- **Plan 4:** Multi-net voice engine (the headline tactical-radio feature) — LiveKit integration, multi-room subscriptions, PTT with global hotkeys, priority ducking
- **Plan 5:** Admin / Squad-Leader board UI

Note that Plan 4's voice work will operate on the *active* server initially. Whether voice extends to passive monitoring of other servers' nets is a v1.5+ design question (related to Net Bridges from spec §5.6).
