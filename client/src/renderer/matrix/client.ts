import { AutoDiscovery, AutoDiscoveryAction, createClient, MatrixClient } from "matrix-js-sdk";
import type { ISSOFlow } from "matrix-js-sdk/lib/@types/auth";
import type { Credentials } from "./types";

export interface ClientHandle {
  client: MatrixClient;
  shutdown(): Promise<void>;
}

/**
 * Resolve a user-typed server URL to the actual Matrix homeserver base URL
 * via the .well-known/matrix/client delegation mechanism.
 *
 * States handled:
 *   SUCCESS    — well-known present and valid; use the delegated base_url.
 *   IGNORE     — no well-known found (e.g. local dev); fall back to the typed URL.
 *   PROMPT     — partial/ambiguous well-known; fall back to the typed URL.
 *   FAIL_PROMPT — delegation failed but client may still try; fall back to typed URL.
 *   FAIL_ERROR  — delegation definitively failed; throw so the caller surfaces the error.
 */
export async function resolveHomeserverUrl(serverUrl: string): Promise<string> {
  const domain = serverUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const discovery = await AutoDiscovery.findClientConfig(domain);
  const hs = discovery["m.homeserver"];
  const state = hs?.state;

  if (state === AutoDiscovery.SUCCESS && hs.base_url) {
    return hs.base_url;
  } else if (
    state === AutoDiscoveryAction.IGNORE ||
    state === AutoDiscovery.PROMPT ||
    state === AutoDiscovery.FAIL_PROMPT
  ) {
    // No usable well-known — connect directly to the typed URL.
    return `https://${domain}`;
  } else {
    // FAIL_ERROR or unexpected state.
    throw new Error(
      `Matrix well-known discovery failed for ${domain}: ${state ?? "unknown"} (${hs?.error ?? "no detail"})`,
    );
  }
}

/**
 * Create and start a matrix-js-sdk client from cached credentials.
 * Caller is responsible for calling `shutdown()` on logout / unmount.
 */
export async function startClient(creds: Credentials): Promise<ClientHandle> {
  // Provide cryptoCallbacks at construction time so both `client.cryptoCallbacks`
  // and the internal `ServerSideSecretStorageImpl` share the same object reference.
  // We start with a no-op getSecretStorageKey (returns null = no existing key).
  // The restore-from-recovery-key flow will replace this callback when needed.
  const cryptoCallbacks = {
    getSecretStorageKey: async () => null as null,
  };

  const client = createClient({
    baseUrl: creds.homeserverUrl,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
    cryptoCallbacks,
  });

  // Each server's MatrixClient needs its own isolated crypto store.
  // The matrix-js-sdk rust crypto backend uses a fixed IDB prefix ("matrix-js-sdk")
  // for ALL clients in the same renderer process, meaning clients would share
  // and conflict with each other's crypto state.
  //
  // Workaround: disable IndexedDB persistence entirely (useIndexedDB: false).
  // Each client then uses a fresh in-memory store. Sessions are not persisted
  // across app restarts, so users must complete encryption setup on each launch.
  //
  // TODO: Replace this with a per-server storePrefix when matrix-js-sdk exposes
  // that option at the public API level (tracked upstream).
  await client.initRustCrypto({ useIndexedDB: false });
  await client.startClient({ initialSyncLimit: 10 });

  return {
    client,
    async shutdown() {
      client.stopClient();
      await client.logout(true).catch(() => undefined);
    },
  };
}

/**
 * Local-account password login. Returns a Credentials bundle the caller can persist.
 */
export async function loginWithPassword(
  homeserverUrl: string,
  username: string,
  password: string,
): Promise<Credentials> {
  const resolvedUrl = await resolveHomeserverUrl(homeserverUrl);
  const tmp = createClient({ baseUrl: resolvedUrl });
  const resp = await tmp.login("m.login.password", {
    identifier: { type: "m.id.user", user: username },
    password,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl: resolvedUrl,
  };
}

/**
 * SSO token login (after OIDC flow completes). Returns a Credentials bundle the caller can persist.
 */
export async function loginWithToken(
  homeserverUrl: string,
  loginToken: string,
): Promise<Credentials> {
  const resolvedUrl = await resolveHomeserverUrl(homeserverUrl);
  const tmp = createClient({ baseUrl: resolvedUrl });
  const resp = await tmp.login("m.login.token", {
    token: loginToken,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl: resolvedUrl,
  };
}

/**
 * Change the local-account password for a signed-in client. Uses Matrix
 * user-interactive auth: the current password is submitted inline as an
 * m.login.password stage, so the user re-confirms it. logoutDevices=false
 * keeps other sessions signed in.
 */
export async function changePassword(
  client: MatrixClient,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await client.setPassword(
    { type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password: currentPassword },
    newPassword,
    false,
  );
}

/**
 * Probe the homeserver for the list of supported login flows.
 * Used by the login screen to decide whether to show the CitizenID button
 * (only if `m.login.sso` with `org.matrix.msc3824.delegated_oidc_compatibility`
 * or just any `m.login.sso` is offered).
 */
export async function getLoginFlows(homeserverUrl: string): Promise<{
  supportsLocalPassword: boolean;
  supportsOidcSso: boolean;
  ssoIdentityProviders: { id: string; name: string; brand?: string }[];
}> {
  const resolvedUrl = await resolveHomeserverUrl(homeserverUrl);
  const tmp = createClient({ baseUrl: resolvedUrl });
  const resp = await tmp.loginFlows();
  const sso = resp.flows.find((f): f is ISSOFlow => f.type === "m.login.sso");
  return {
    supportsLocalPassword: resp.flows.some((f) => f.type === "m.login.password"),
    supportsOidcSso: !!sso,
    ssoIdentityProviders: sso?.identity_providers ?? [],
  };
}
