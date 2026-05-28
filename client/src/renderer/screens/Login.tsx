import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { getLoginFlows, loginWithPassword, loginWithToken } from "../matrix/client";
import type { Credentials } from "../matrix/types";

interface LoginProps {
  serverUrl: string;
  onLoggedIn: (creds: Credentials, password: string | null) => void;
}

type Flows = {
  supportsLocalPassword: boolean;
  supportsOidcSso: boolean;
  ssoIdentityProviders: { id: string; name: string; brand?: string }[];
};

export function Login({ serverUrl, onLoggedIn }: LoginProps) {
  const [flows, setFlows] = useState<Flows | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLoginFlows(serverUrl)
      .then(setFlows)
      .catch((e) => setError(`Could not contact server: ${e instanceof Error ? e.message : e}`));
  }, [serverUrl]);

  async function handleLocalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const creds = await loginWithPassword(serverUrl, username, password);
      // Persistence (tokens:save, servers:update) is handled by AppState's onLoggedIn callback.
      onLoggedIn(creds, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCitizenIdLogin() {
    setError(null);
    setBusy(true);
    try {
      if (!flows) {
        throw new Error("Login flows not loaded");
      }

      // Find CitizenID IDP, fallback to first IDP
      const idp =
        flows.ssoIdentityProviders.find(
          (p) => p.id.toLowerCase() === "citizenid",
        ) || flows.ssoIdentityProviders[0];

      if (!idp) {
        throw new Error("No OIDC identity providers available");
      }

      setError("Waiting for browser…");

      // Start the SSO flow in main process
      const ssoResult = await window.hailfreq.invoke("oidc:startSsoFlow", {
        homeserverUrl: serverUrl,
        idpId: idp.id,
      });

      // Exchange token for credentials
      const creds = await loginWithToken(serverUrl, ssoResult.loginToken);

      // Persistence (tokens:save, servers:update) is handled by AppState's onLoggedIn callback.
      setError(null);
      onLoggedIn(creds, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CitizenID login failed");
    } finally {
      setBusy(false);
    }
  }

  if (!flows && !error) {
    return <Centered>Loading login options…</Centered>;
  }
  if (error && !flows) {
    return <Centered>{error}</Centered>;
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">{serverUrl}</p>
      </header>

      {/* CitizenID button — wired in Task 13 */}
      {flows?.supportsOidcSso && (
        <Button
          variant="primary"
          disabled={busy}
          onClick={handleCitizenIdLogin}
        >
          {busy ? "Waiting for browser…" : "Sign in with CitizenID"}
        </Button>
      )}

      {flows?.supportsLocalPassword && (
        <form onSubmit={handleLocalSubmit} className="flex flex-col gap-4">
          <Input
            label="Username"
            placeholder="yourname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <Input
            label="Password"
            type="password"
            placeholder="•••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            error={error || undefined}
          />
          <Button type="submit" disabled={!username || !password || busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
