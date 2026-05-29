import { useEffect, useMemo, useRef, useState, type ReactNode, useCallback } from "react";
import type { ServerEntry } from "@shared/types";
import type { StoredCredentials } from "@shared/ipc";
import type { ClientHandle } from "./matrix/client";
import { startClient } from "./matrix/client";
import { subscribeToVerificationRequests, availableMethods } from "./matrix/verification";
import type { VerificationMethodChoice } from "./matrix/verification";
import { RoomEvent } from "matrix-js-sdk";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import type { IRoomTimelineData } from "matrix-js-sdk/lib/models/event-timeline-set";
import { Sidebar } from "./components/Sidebar";
import { EmojiVerification } from "./components/EmojiVerification";
import { QrVerification } from "./components/QrVerification";
import type { QrMode } from "./components/QrVerification";
import { AddServer } from "./screens/AddServer";
import { Login } from "./screens/Login";
import { EncryptionSetup } from "./screens/EncryptionSetup";
import { RestoreFromRecoveryKey } from "./screens/RestoreFromRecoveryKey";
import { Home } from "./screens/Home";
import type { Credentials } from "./matrix/types";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";
import type { CrewBoardingToastEntry } from "./components/CrewBoardingToast";

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
    | { kind: "home" };
  /** Non-null when an incoming verification request is waiting to be handled. */
  pendingVerification?: VerificationRequest;
  /**
   * Which verification method the user has chosen.
   * - undefined: not yet chosen (show picker if multiple methods available)
   * - "sas": emoji comparison via EmojiVerification
   * - "qr-show" | "qr-scan": QR code via QrVerification
   */
  chosenVerificationMethod?: VerificationMethodChoice;
  /** Unread message count for this server while it is not the active server. */
  unreadCount: number;
  /**
   * Pending crew-boarding toasts for this server (max 3 at a time).
   * Produced by ScIntegration (Task 11); consumed and dismissed by Home.
   */
  crewBoardingToasts: CrewBoardingToastEntry[];
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
  /** The net ID currently being PTT'd on the active server (if any). */
  transmittingNet: string | null;
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
        return { entry, handle, screen: { kind: "home" }, unreadCount: 0, crewBoardingToasts: [] };
      }
    } catch {
      // Token expired, homeserver unreachable, or crypto init failed — fall through to login
    }
    // Clear stale/invalid credentials
    await window.hailfreq.invoke("tokens:clear", { serverId: entry.id });
  }
  return { entry, screen: { kind: "login" }, unreadCount: 0, crewBoardingToasts: [] };
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
    transmittingNet: null,
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

      setState({ servers, activeServerId, globalScreen, transmittingNet: null });
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
  // Per-server verification subscriptions
  // -------------------------------------------------------------------------

  /**
   * Derive a stable list of [serverId, MatrixClient] pairs for signed-in servers.
   * Keying the effect on this avoids re-subscribing on every unrelated state change —
   * the effect only re-runs when the set of signed-in clients actually changes.
   */
  const signedInClients = useMemo(
    () =>
      Array.from(state.servers.entries())
        .filter(([, instance]) => instance.handle != null)
        .map(([serverId, instance]) => [serverId, instance.handle!.client] as const),
    // We intentionally depend only on the Map reference itself; a new Map is
    // created by patchServer / immutable helpers whenever the set of clients
    // changes (login, logout, server add/remove), so this is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.servers],
  );

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    for (const [serverId, client] of signedInClients) {
      const unsub = subscribeToVerificationRequests(client, (request) => {
        // Use functional setState to avoid stale closures — always operate on
        // the latest state snapshot, not the one captured at subscription time.
        setState((prev) => {
          const existing = prev.servers.get(serverId);
          if (!existing) return prev;
          const next = new Map(prev.servers);
          next.set(serverId, { ...existing, pendingVerification: request });
          return {
            ...prev,
            servers: next,
            // Auto-switch the active view to the server receiving the request
            activeServerId: serverId,
            globalScreen: { kind: "active" },
          };
        });
      });
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [signedInClients]);

  // -------------------------------------------------------------------------
  // Per-server unread badge subscriptions + OS notifications
  // -------------------------------------------------------------------------

  // Per-server notification debounce: track last-notified timestamp per server
  const lastNotifiedRef = useRef<Map<string, number>>(new Map());
  const NOTIFY_DEBOUNCE_MS = 5000;

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    for (const [serverId, client] of signedInClients) {
      const localUserId = client.getUserId();

      const handler = (
        event: MatrixEvent,
        _room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        _removed: boolean,
        data: IRoomTimelineData,
      ): void => {
        // Only count live, forward events (not history pagination)
        if (toStartOfTimeline) return;
        if (!data.liveEvent) return;

        const eventType = event.getType();
        if (eventType !== "m.room.message" && eventType !== "m.room.encrypted") return;

        // Skip messages sent by the local user
        if (localUserId && event.getSender() === localUserId) return;

        setState((prev) => {
          // Increment unread if this server is not active
          if (prev.activeServerId !== serverId) {
            const existing = prev.servers.get(serverId);
            if (!existing) return prev;
            const next = new Map(prev.servers);
            next.set(serverId, { ...existing, unreadCount: existing.unreadCount + 1 });
            return { ...prev, servers: next };
          }
          return prev;
        });

        // OS notification: fire when this server is not active OR window not focused,
        // gated on per-server notificationsEnabled and debounce.
        setState((prev) => {
          const existing = prev.servers.get(serverId);
          if (!existing) return prev;

          // Per-server notifications toggle (default true)
          const notifEnabled = existing.entry.notificationsEnabled ?? true;
          if (!notifEnabled) return prev;

          // Only notify if server is not active or window not focused
          const isActiveServer = prev.activeServerId === serverId;
          const windowFocused = document.hasFocus();
          if (isActiveServer && windowFocused) return prev;

          // Debounce: cap at 1 notification per server per 5 seconds
          const now = Date.now();
          const lastTime = lastNotifiedRef.current.get(serverId) ?? 0;
          if (now - lastTime < NOTIFY_DEBOUNCE_MS) return prev;
          lastNotifiedRef.current.set(serverId, now);

          const serverLabel = existing.entry.label || existing.entry.serverUrl;
          void window.hailfreq
            .invoke("notify:show", { title: serverLabel, body: "New message", serverId })
            .catch((err: unknown) => {
              console.error("notify:show failed:", err);
            });

          return prev;
        });
      };

      client.on(RoomEvent.Timeline, handler);
      unsubs.push(() => client.off(RoomEvent.Timeline, handler));
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [signedInClients]);

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
    // Fire-and-forget: persist the active server so it survives relaunch.
    void window.hailfreq.invoke("servers:setActive", { serverId: id }).catch((err: unknown) => {
      console.error("servers:setActive failed:", err);
    });
    setState((s) => {
      const existing = s.servers.get(id);
      const servers =
        existing && existing.unreadCount !== 0
          ? new Map(s.servers).set(id, { ...existing, unreadCount: 0 })
          : s.servers;
      return { ...s, servers, activeServerId: id, globalScreen: { kind: "active" } };
    });
  }, []);

  // Subscribe to notify:clicked to switch active server when notification is clicked
  useEffect(() => {
    const unsub = window.hailfreq.onNotifyClicked((payload: { serverId?: string }) => {
      if (!payload.serverId) return;
      handleSelectServer(payload.serverId);
    });
    return unsub;
  }, [handleSelectServer]);

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

  const makeVerificationDoneHandler = useCallback(
    (serverId: string) => (_verified?: boolean) => {
      setState((s) =>
        patchServer(s, serverId, {
          pendingVerification: undefined,
          chosenVerificationMethod: undefined,
        }),
      );
    },
    [],
  );

  const makeVerificationMethodChosenHandler = useCallback(
    (serverId: string) => (method: VerificationMethodChoice) => {
      setState((s) => patchServer(s, serverId, { chosenVerificationMethod: method }));
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

  const handleRenameServer = useCallback(
    async (serverId: string, newLabel: string) => {
      const instance = state.servers.get(serverId);
      if (!instance) return;

      // Update persistent store via IPC
      await window.hailfreq.invoke("servers:update", {
        serverId,
        patch: { label: newLabel },
      });

      // Update local state
      setState((s) =>
        patchServer(s, serverId, {
          entry: {
            ...s.servers.get(serverId)!.entry,
            label: newLabel,
          },
        }),
      );
    },
    [state.servers],
  );

  const handleTransmittingChange = useCallback((net: string | null) => {
    setState((s) => ({ ...s, transmittingNet: net }));
  }, []);

  /**
   * Dismiss a single crew-boarding toast by id for a given server.
   * Called by Home when the user picks Invite / Always-invite / Ignore,
   * or when the auto-dismiss timer fires.
   * Task 11 will add the producer side (pushing toasts into this queue).
   */
  const makeDismissCrewBoardingToast = useCallback(
    (serverId: string) => (toastId: string) => {
      setState((s) => {
        const existing = s.servers.get(serverId);
        if (!existing) return s;
        return patchServer(s, serverId, {
          crewBoardingToasts: existing.crewBoardingToasts.filter((t) => t.id !== toastId),
        });
      });
    },
    [],
  );

  const handleReorder = useCallback((orderedIds: string[]) => {
    // Persist new order to store
    void window.hailfreq.invoke("servers:reorder", { orderedIds }).catch((err: unknown) => {
      console.error("servers:reorder failed:", err);
    });
    // Update local state: rebuild Map in the new order
    setState((s) => {
      const next = new Map<string, ServerInstance>();
      for (const id of orderedIds) {
        const instance = s.servers.get(id);
        if (instance) next.set(id, instance);
      }
      // Append any servers not in orderedIds (safety net)
      for (const [id, instance] of s.servers) {
        if (!next.has(id)) next.set(id, instance);
      }
      return { ...s, servers: next };
    });
  }, []);

  const handleToggleNotifications = useCallback(
    async (serverId: string, enabled: boolean) => {
      await window.hailfreq.invoke("servers:update", {
        serverId,
        patch: { notificationsEnabled: enabled },
      });
      setState((s) => {
        const existing = s.servers.get(serverId);
        if (!existing) return s;
        return patchServer(s, serverId, {
          entry: { ...existing.entry, notificationsEnabled: enabled },
        });
      });
    },
    [],
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
        servers={Array.from(state.servers.values()).map((s) => ({
          entry: s.entry,
          unreadCount: s.unreadCount,
          transmitting: state.activeServerId === s.entry.id && state.transmittingNet !== null,
        }))}
        activeServerId={state.activeServerId}
        onSelect={handleSelectServer}
        onAddClicked={handleAddClicked}
        onRemoveServer={handleRemoveServer}
        onRenameServer={handleRenameServer}
        onToggleNotifications={handleToggleNotifications}
        onReorder={handleReorder}
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
            onVerificationDone={makeVerificationDoneHandler(activeInstance.entry.id)}
            onVerificationMethodChosen={makeVerificationMethodChosenHandler(activeInstance.entry.id)}
            onTransmittingChange={handleTransmittingChange}
            onDismissCrewBoardingToast={makeDismissCrewBoardingToast(activeInstance.entry.id)}
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
  onVerificationDone: (verified?: boolean) => void;
  onVerificationMethodChosen: (method: VerificationMethodChoice) => void;
  onTransmittingChange: (net: string | null) => void;
  onDismissCrewBoardingToast: (toastId: string) => void;
}

function ActiveServerView({
  instance,
  onLoggedIn,
  onEncryptionDone,
  onNeedsExistingRecovery,
  onRestored,
  onLogout,
  onVerificationDone,
  onVerificationMethodChosen,
  onTransmittingChange,
  onDismissCrewBoardingToast,
}: ActiveServerViewProps) {
  const { screen, entry, handle, pendingVerification, chosenVerificationMethod, crewBoardingToasts } = instance;

  // Expose the Matrix ClientHandle for Plan 6+ E2E tests when running under HAILFREQ_TEST=1.
  // Mirrors the window.__voiceEngine pattern in NetListPanel.
  useEffect(() => {
    if (process.env.HAILFREQ_TEST === "1") {
      (window as any).__matrixHandle = handle;
    }
    return () => {
      if (process.env.HAILFREQ_TEST === "1") {
        delete (window as any).__matrixHandle;
      }
    };
  }, [handle]);

  // If an incoming verification request is pending, render the verification overlay
  // regardless of which screen the server is on (it will be on "home" for
  // signed-in servers, but be defensive).
  if (pendingVerification != null) {
    const methods = availableMethods(pendingVerification);

    // If only SAS is available (or no QR methods), route directly to EmojiVerification.
    const hasQr = methods.includes("qr-show") || methods.includes("qr-scan");

    // If a method has already been chosen, route to the appropriate component.
    if (chosenVerificationMethod === "sas" || (!hasQr && methods.includes("sas"))) {
      return (
        <EmojiVerification
          request={pendingVerification}
          onDone={onVerificationDone}
        />
      );
    }

    if (chosenVerificationMethod === "qr-show" || chosenVerificationMethod === "qr-scan") {
      return (
        <QrVerification
          request={pendingVerification}
          mode={chosenVerificationMethod as QrMode}
          onDone={onVerificationDone}
        />
      );
    }

    // No method chosen yet + QR is available → show the picker.
    if (hasQr) {
      return (
        <VerificationMethodPicker
          methods={methods}
          request={pendingVerification}
          onChoose={onVerificationMethodChosen}
          onCancel={() => onVerificationDone(false)}
        />
      );
    }

    // Fallback: no methods at all or SAS only with no prior choice.
    return (
      <EmojiVerification
        request={pendingVerification}
        onDone={onVerificationDone}
      />
    );
  }

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
          serverEntry={entry}
          onTransmittingChange={onTransmittingChange}
          crewBoardingToasts={crewBoardingToasts}
          onDismissCrewBoardingToast={onDismissCrewBoardingToast}
        />
      );

  }
}

// ---------------------------------------------------------------------------
// Verification method picker
// ---------------------------------------------------------------------------

interface VerificationMethodPickerProps {
  methods: VerificationMethodChoice[];
  request: VerificationRequest;
  onChoose: (method: VerificationMethodChoice) => void;
  onCancel: () => void;
}

function VerificationMethodPicker({
  methods,
  request,
  onChoose,
  onCancel,
}: VerificationMethodPickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">Verify Device</h2>
        <p className="mb-4 text-sm text-slate-400">
          From:{" "}
          <span className="font-mono text-slate-300">
            {request.otherUserId}
            {request.otherDeviceId ? ` / ${request.otherDeviceId}` : ""}
          </span>
        </p>
        <p className="mb-4 text-sm text-slate-300">Choose a verification method:</p>
        <div className="flex flex-col gap-2">
          {methods.includes("sas") && (
            <button
              onClick={() => onChoose("sas")}
              className="rounded-lg bg-slate-700 px-4 py-3 text-left text-sm text-white hover:bg-slate-600"
            >
              <span className="font-semibold">Compare emoji</span>
              <span className="ml-2 text-slate-400">— both devices show matching emoji</span>
            </button>
          )}
          {methods.includes("qr-show") && (
            <button
              onClick={() => onChoose("qr-show")}
              className="rounded-lg bg-slate-700 px-4 py-3 text-left text-sm text-white hover:bg-slate-600"
            >
              <span className="font-semibold">Show QR code</span>
              <span className="ml-2 text-slate-400">— other device scans this QR</span>
            </button>
          )}
          {methods.includes("qr-scan") && (
            <button
              onClick={() => onChoose("qr-scan")}
              className="rounded-lg bg-slate-700 px-4 py-3 text-left text-sm text-white hover:bg-slate-600"
            >
              <span className="font-semibold">Paste QR code</span>
              <span className="ml-2 text-slate-400">— paste the other device&apos;s QR payload</span>
            </button>
          )}
        </div>
        <button
          onClick={onCancel}
          className="mt-4 w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500"
        >
          Cancel
        </button>
      </div>
    </div>
  );
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
