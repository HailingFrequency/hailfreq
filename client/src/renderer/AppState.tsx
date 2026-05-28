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
    void window.hailfreq.invoke("settings:get").then((s) => {
      if (!s.serverUrl) {
        setScreen({ kind: "first-run" });
      } else if (!s.userId) {
        setScreen({ kind: "login", serverUrl: s.serverUrl });
      } else {
        // Auto-resume path is wired up in Task 11; for now we always go to login.
        setScreen({ kind: "login", serverUrl: s.serverUrl });
      }
    });
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
