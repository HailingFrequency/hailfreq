import { createClient, MatrixClient } from "matrix-js-sdk";
import type { ISSOFlow } from "matrix-js-sdk/lib/@types/auth";
import type { Credentials } from "./types";

export interface ClientHandle {
  client: MatrixClient;
  shutdown(): Promise<void>;
}

/**
 * Create and start a matrix-js-sdk client from cached credentials.
 * Caller is responsible for calling `shutdown()` on logout / unmount.
 */
export async function startClient(creds: Credentials): Promise<ClientHandle> {
  const client = createClient({
    baseUrl: creds.homeserverUrl,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
  });

  await client.initRustCrypto();
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
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = await tmp.login("m.login.password", {
    identifier: { type: "m.id.user", user: username },
    password,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl,
  };
}

/**
 * SSO token login (after OIDC flow completes). Returns a Credentials bundle the caller can persist.
 */
export async function loginWithToken(
  homeserverUrl: string,
  loginToken: string,
): Promise<Credentials> {
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = await tmp.login("m.login.token", {
    token: loginToken,
    initial_device_display_name: "Hailfreq Desktop",
  });
  return {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
    homeserverUrl,
  };
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
  const tmp = createClient({ baseUrl: homeserverUrl });
  const resp = await tmp.loginFlows();
  const sso = resp.flows.find((f): f is ISSOFlow => f.type === "m.login.sso");
  return {
    supportsLocalPassword: resp.flows.some((f) => f.type === "m.login.password"),
    supportsOidcSso: !!sso,
    ssoIdentityProviders: sso?.identity_providers ?? [],
  };
}
