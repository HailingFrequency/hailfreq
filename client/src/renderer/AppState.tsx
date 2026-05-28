import { useEffect, useState, type ReactNode, useCallback } from "react";
import type { ServerEntry } from "@shared/types";
import type { StoredCredentials } from "@shared/ipc";
import type { ClientHandle } from "./matrix/client";
import { startClient } from "./matrix/client";
import { Sidebar } from "./components/Sidebar";
import { AddServer } from "./screens/AddServer";
import { Login } from "./screens/Login";
import { EncryptionSetup } from "./screens/EncryptionSetup";
import { RestoreFromRecoveryKey } from "./screens/RestoreFromRecoveryKey";
import { Home } from "./screens/Home";
import type { Credentials } from "./matrix/types";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

interface ServerInstance {
  entry: ServerEntry;
  handle?: ClientHandle;
  screen:
    | { kind: "loading" }
    | { kind: "login" }
    | { kind: "encryption-setup"; password: string | null }
    | { kind: "restore-from-recovery" }
    | { kind: "home" }
    | { kind: "error"; message: string };
}

interface AppLevelState {
  servers: Map<string, ServerInstance>;
  /** Empty string when no servers exist. */
  activeServerId: string;
  globalScreen:
    | { kind: "loading" }
    | { kind: "no-servers" }
    | { kind: "active" }
    | { kind: "adding-server" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Immutably update a single ServerInstance inside AppLevelState. */
function patchServer(
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

/**
 * Probe stored credentials and start the Matrix client if valid.
 * Routes to "home" on success, "login" on failure/expiry.
 */
async function initServer(entry: ServerEntry): Promise<ServerInstance> {
  const stored = await window.hailfreq.invoke("tokens:load", { serverId: entry.id });
  if (stored) {
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
    } catch {
      // Token expired, homeserver unreachable, or crypto init failed — fall through to login
    }
    // Clear stale/invalid credentials
    await window.hailfreq.invoke("tokens:clear", { serverId: entry.id });
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

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function AppState() {
  const [state, setState] = useState<AppLevelState>({
    servers: new Map(),
    activeServerId: "",
    globalScreen: { kind: "loading" },
  });

  // Boot: load settings, initialise one ServerInstance per configured server.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const settings = await window.hailfreq.invoke("settings:get");
      if (cancelled) return;

      const servers = new Map<string, ServerInstance>();
      for (const entry of settings.servers) {
        const instance = await initServer(entry);
        if (cancelled) return;
        servers.set(entry.id, instance);
      }

      const activeServerId =
        settings.activeServerId || settings.servers[0]?.id || "";

      const globalScreen: AppLevelState["globalScreen"] =
        settings.servers.length === 0 ? { kind: "no-servers" } : { kind: "active" };

      setState({ servers, activeServerId, globalScreen });
    })();

    // Best-effort shutdown of all ClientHandles when the component unmounts.
    return () => {
      cancelled = true;
      setState((s) => {
        s.servers.forEach((srv) => {
          void srv.handle?.shutdown().catch(() => undefined);
        });
        return s;
      });
    };
  }, []);

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  /** Called by AddServer screen after a new ServerEntry has been persisted. */
  const handleServerAdded = useCallback(async (entry: ServerEntry) => {
    const instance = await initServer(entry);
    setState((s) => ({
      ...s,
      servers: new Map(s.servers).set(entry.id, instance),
      activeServerId: entry.id,
      globalScreen: { kind: "active" },
    }));
  }, []);

  const handleSelectServer = useCallback((id: string) => {
    setState((s) => ({ ...s, activeServerId: id, globalScreen: { kind: "active" } }));
  }, []);

  const handleAddClicked = useCallback(() => {
    setState((s) => ({ ...s, globalScreen: { kind: "adding-server" } }));
  }, []);

  const handleCancelAdd = useCallback(() => {
    setState((s) => ({ ...s, globalScreen: { kind: "active" } }));
  }, []);

  /**
   * onLoggedIn: owns token + server-metadata persistence (option b from the plan).
   * Login.tsx just calls this with raw creds; AppState handles IPC side effects.
   */
  const makeLoginHandler = useCallback(
    (serverId: string) =>
      async (creds: Credentials, password: string | null) => {
        const storedCreds: StoredCredentials = {
          userId: creds.userId,
          accessToken: creds.accessToken,
          deviceId: creds.deviceId,
          homeserverUrl: creds.homeserverUrl,
        };

        await window.hailfreq.invoke("tokens:save", {
          serverId,
          credentials: storedCreds,
        });
        await window.hailfreq.invoke("servers:update", {
          serverId,
          patch: {
            userId: creds.userId,
            lastLoginMethod: password !== null ? "local" : "citizenid",
          },
        });

        const handle = await startClient(creds);

        setState((s) =>
          patchServer(s, serverId, {
            handle,
            entry: {
              ...s.servers.get(serverId)!.entry,
              userId: creds.userId,
              lastLoginMethod: password !== null ? "local" : "citizenid",
            },
            screen: { kind: "encryption-setup", password },
          }),
        );
      },
    [],
  );

  const makeEncryptionDoneHandler = useCallback(
    (serverId: string) => () => {
      setState((s) => patchServer(s, serverId, { screen: { kind: "home" } }));
    },
    [],
  );

  const makeNeedsExistingRecoveryHandler = useCallback(
    (serverId: string) => () => {
      setState((s) =>
        patchServer(s, serverId, { screen: { kind: "restore-from-recovery" } }),
      );
    },
    [],
  );

  const makeRestoredHandler = useCallback(
    (serverId: string) => () => {
      setState((s) => patchServer(s, serverId, { screen: { kind: "home" } }));
    },
    [],
  );

  const makeLogoutHandler = useCallback(
    (serverId: string, handle: ClientHandle | undefined) =>
      async () => {
        await handle?.shutdown();
        await window.hailfreq.invoke("tokens:clear", { serverId });
        await window.hailfreq.invoke("servers:update", {
          serverId,
          patch: { userId: "", lastLoginMethod: "" },
        });
        setState((s) =>
          patchServer(s, serverId, {
            handle: undefined,
            entry: {
              ...s.servers.get(serverId)!.entry,
              userId: "",
              lastLoginMethod: "",
            },
            screen: { kind: "login" },
          }),
        );
      },
    [],
  );

  const handleRemoveServer = useCallback(
    async (serverId: string) => {
      const instance = state.servers.get(serverId);
      if (!instance) return;

      // Shutdown the client, clear tokens, and call servers:remove
      await instance.handle?.shutdown();
      await window.hailfreq.invoke("tokens:clear", { serverId });
      await window.hailfreq.invoke("servers:remove", { serverId });

      // Update local state: remove server from map
      setState((s) => {
        const next = new Map(s.servers);
        next.delete(serverId);

        // Reassign activeServerId if we just removed the active server
        let newActiveId = s.activeServerId;
        if (s.activeServerId === serverId) {
          const remaining = Array.from(next.values());
          newActiveId = remaining[0]?.entry.id ?? "";
        }

        // Transition to no-servers if the map is now empty
        const newGlobalScreen: AppLevelState["globalScreen"] =
          next.size === 0 ? { kind: "no-servers" } : { kind: "active" };

        return {
          ...s,
          servers: next,
          activeServerId: newActiveId,
          globalScreen: newGlobalScreen,
        };
      });
    },
    [state.servers],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const { globalScreen } = state;

  if (globalScreen.kind === "loading") {
    return <Centered>Loading…</Centered>;
  }

  if (globalScreen.kind === "no-servers") {
    return (
      <AddServer
        onAdded={handleServerAdded}
        cancellable={false}
      />
    );
  }

  // "active" | "adding-server" — sidebar is always visible here
  const activeInstance = state.servers.get(state.activeServerId);

  return (
    <div className="flex h-full">
      <Sidebar
        servers={Array.from(state.servers.values()).map((s) => s.entry)}
        activeServerId={state.activeServerId}
        onSelect={handleSelectServer}
        onAddClicked={handleAddClicked}
        onRemoveServer={handleRemoveServer}
      />
      <div className="flex-1 overflow-hidden">
        {globalScreen.kind === "adding-server" ? (
          <AddServer
            onAdded={handleServerAdded}
            onCancel={handleCancelAdd}
            cancellable={true}
          />
        ) : activeInstance ? (
          <ActiveServerView
            instance={activeInstance}
            onLoggedIn={makeLoginHandler(activeInstance.entry.id)}
            onEncryptionDone={makeEncryptionDoneHandler(activeInstance.entry.id)}
            onNeedsExistingRecovery={makeNeedsExistingRecoveryHandler(activeInstance.entry.id)}
            onRestored={makeRestoredHandler(activeInstance.entry.id)}
            onLogout={makeLogoutHandler(activeInstance.entry.id, activeInstance.handle)}
          />
        ) : (
          <Centered>No server selected.</Centered>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-server screen router
// ---------------------------------------------------------------------------

interface ActiveServerViewProps {
  instance: ServerInstance;
  onLoggedIn: (creds: Credentials, password: string | null) => Promise<void>;
  onEncryptionDone: () => void;
  onNeedsExistingRecovery: () => void;
  onRestored: () => void;
  onLogout: () => Promise<void>;
}

function ActiveServerView({
  instance,
  onLoggedIn,
  onEncryptionDone,
  onNeedsExistingRecovery,
  onRestored,
  onLogout,
}: ActiveServerViewProps) {
  const { screen, entry, handle } = instance;

  switch (screen.kind) {
    case "loading":
      return <Centered>Loading…</Centered>;

    case "login":
      return (
        <Login
          serverUrl={entry.serverUrl}
          onLoggedIn={onLoggedIn}
        />
      );

    case "encryption-setup":
      return (
        <EncryptionSetup
          client={handle!.client}
          password={screen.password}
          onDone={onEncryptionDone}
          onNeedsExistingRecovery={onNeedsExistingRecovery}
        />
      );

    case "restore-from-recovery":
      return (
        <RestoreFromRecoveryKey
          client={handle!.client}
          onRestored={onRestored}
        />
      );

    case "home":
      return (
        <Home
          client={handle!.client}
          onLogout={onLogout}
        />
      );

    case "error":
      return <Centered>{screen.message}</Centered>;
  }
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
