import { useEffect, useState, type ReactNode } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { FirstRun } from "./screens/FirstRun";
import { Login } from "./screens/Login";
import { EncryptionSetup } from "./screens/EncryptionSetup";
import { RestoreFromRecoveryKey } from "./screens/RestoreFromRecoveryKey";
import type { Credentials } from "./matrix/types";
import { EmojiVerification } from "./components/EmojiVerification";
import { subscribeToVerificationRequests } from "./matrix/verification";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";

type Screen =
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "login"; serverUrl: string }
  | {
      kind: "encryption-setup";
      client: MatrixClient;
      password: string | null;
      creds: Credentials;
    }
  | {
      kind: "restore-from-recovery";
      client: MatrixClient;
      creds: Credentials;
    }
  | { kind: "home"; serverUrl: string; userId: string; creds: Credentials; client: MatrixClient };

export function AppState() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    void (async () => {
      const s = await window.hailfreq.invoke("settings:get");
      if (!s.serverUrl) {
        setScreen({ kind: "first-run" });
        return;
      }
      const stored = await window.hailfreq.invoke("tokens:load");
      if (stored && stored.userId === s.userId) {
        // Validate token by hitting /_matrix/client/v3/account/whoami
        const ok = await validateAccessToken(stored.homeserverUrl, stored.accessToken);
        if (ok) {
          const { startClient } = await import("./matrix/client");
          const handle = await startClient(stored);
          setScreen({ kind: "home", serverUrl: s.serverUrl, userId: stored.userId, creds: stored, client: handle.client });
          return;
        }
        // Token rejected — clear and force login
        await window.hailfreq.invoke("tokens:clear");
        await window.hailfreq.invoke("settings:set", { userId: "" });
      }
      setScreen({ kind: "login", serverUrl: s.serverUrl });
    })();
  }, []);

  switch (screen.kind) {
    case "loading":
      return <CenteredMessage>Loading…</CenteredMessage>;

    case "first-run":
      return <FirstRun onConfigured={(url) => setScreen({ kind: "login", serverUrl: url })} />;

    case "login":
      return (
        <Login
          serverUrl={screen.serverUrl}
          onLoggedIn={async (creds, password) => {
            const { startClient } = await import("./matrix/client");
            const handle = await startClient(creds);
            setScreen({
              kind: "encryption-setup",
              client: handle.client,
              password,
              creds,
            });
          }}
        />
      );

    case "encryption-setup":
      return (
        <EncryptionSetup
          client={screen.client}
          password={screen.password}
          onDone={() =>
            setScreen({
              kind: "home",
              serverUrl: screen.creds.homeserverUrl,
              userId: screen.creds.userId,
              creds: screen.creds,
              client: screen.client,
            })
          }
          onNeedsExistingRecovery={() =>
            setScreen({
              kind: "restore-from-recovery",
              client: screen.client,
              creds: screen.creds,
            })
          }
        />
      );

    case "restore-from-recovery":
      return (
        <RestoreFromRecoveryKey
          client={screen.client}
          onRestored={() =>
            setScreen({
              kind: "home",
              serverUrl: screen.creds.homeserverUrl,
              userId: screen.creds.userId,
              creds: screen.creds,
              client: screen.client,
            })
          }
        />
      );

    case "home":
      return <HomeShell client={screen.client} userId={screen.userId} />;
  }
}

interface HomeShellProps {
  client: MatrixClient;
  userId: string;
}

function HomeShell({ client, userId }: HomeShellProps) {
  const [pendingVerification, setPendingVerification] =
    useState<VerificationRequest | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToVerificationRequests(client, (request) => {
      setPendingVerification(request);
    });
    return unsubscribe;
  }, [client]);

  return (
    <>
      <CenteredMessage>Logged in as {userId} (Home shell — Task 20)</CenteredMessage>
      {pendingVerification !== null && (
        <EmojiVerification
          request={pendingVerification}
          onDone={() => setPendingVerification(null)}
        />
      )}
    </>
  );
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
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
