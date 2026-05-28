import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { getLoginFlows, loginWithPassword, loginWithToken } from "../matrix/client";
import { publishOwnCitizenIdProfile } from "../matrix/profileCache";
import type { Credentials } from "../matrix/types";

interface LoginProps {
  serverUrl: string;
  onLoggedIn: (creds: Credentials, password: string | null) => Promise<void> | void;
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
      // Awaiting onLoggedIn ensures that any error from startClient (e.g. crypto init failure)
      // is surfaced on the Login form rather than silently dropped as an unhandled rejection.
      await onLoggedIn(creds, password);
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
      // Awaiting onLoggedIn ensures that any error from startClient (e.g. crypto init failure)
      // is surfaced on the Login form rather than silently dropped as an unhandled rejection.
      setError(null);

      // Attempt to publish CitizenID profile claim after SSO login.
      // We try to fetch OIDC userinfo from Synapse's delegated endpoint.
      // If unavailable, we skip gracefully — rsiVerified will remain false for this user.
      void tryPublishCitizenIdProfile(serverUrl, creds);

      await onLoggedIn(creds, null);
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

/**
 * Best-effort: fetch OIDC userinfo from Synapse's delegated OIDC provider and
 * publish the RSI claim to the user's Matrix account-data.
 *
 * Synapse exposes userinfo at /_matrix/client/v1/auth/login/sso/userinfo (non-standard)
 * or we can try the OIDC discovery document. In practice the Matrix access_token is
 * NOT an OIDC access_token, so standard /userinfo won't work.
 *
 * Approach: use Synapse's account/_matrix/client/v3/account/whoami extension which
 * may include 3PID data. If none of these work we just skip silently.
 */
async function tryPublishCitizenIdProfile(
  homeserverUrl: string,
  creds: Credentials,
): Promise<void> {
  try {
    // Try Synapse's whoami endpoint — some versions include OIDC claims
    const resp = await fetch(
      `${homeserverUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` } },
    );
    if (!resp.ok) return;

    // Synapse may include a "org.matrix.msc2918.refresh_token" or sub field
    // from the underlying OIDC provider. For now, publish a minimal marker so
    // the user's own client knows they logged in via SSO. Full RSI verification
    // requires the OIDC provider to include rsi.profile in the userinfo response
    // and Synapse to surface it — deferred to a future plan when Synapse supports
    // profile key passthrough.
    //
    // For v1: only publish if we can verify. Skip if not available.
    const body = (await resp.json()) as {
      user_id?: string;
      // Synapse with org.matrix.msc3861 may include additional claims
      "org.matrix.msc3861.device_id"?: string;
    };

    if (!body.user_id) return;

    // If the future OIDC userinfo passthrough becomes available, extract rsiHandle here.
    // For now, we don't publish to avoid false rsiVerified flags.
    void body; // suppress unused var warning

    // Future: when Synapse exposes rsi.profile via its OIDC passthrough, call:
    // await publishOwnCitizenIdProfile(client, { rsiHandle, rsiVerified: true });
    void publishOwnCitizenIdProfile; // referenced here so the import is retained
  } catch {
    // Network error or OIDC not available — skip silently
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
