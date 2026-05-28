import { useEffect, useState, type ReactNode } from "react";
import { FirstRun } from "./screens/FirstRun";
import { Login } from "./screens/Login";
import type { Credentials } from "./matrix/types";

type Screen =
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "login"; serverUrl: string }
  | { kind: "home"; serverUrl: string; userId: string; creds: Credentials };

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
          setScreen({ kind: "home", serverUrl: s.serverUrl, userId: stored.userId, creds: stored });
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
          onLoggedIn={(creds) =>
            setScreen({ kind: "home", serverUrl: screen.serverUrl, userId: creds.userId, creds })
          }
        />
      );
    case "home":
      return <CenteredMessage>Logged in as {screen.userId} (Home shell — Task 20)</CenteredMessage>;
  }
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
