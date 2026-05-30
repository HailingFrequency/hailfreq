import { shell } from "electron";
import http from "node:http";
import { URL } from "node:url";

interface OidcStartParams {
  homeserverUrl: string;     // Synapse base URL, e.g., https://radio.guild.com
  idpId: string;             // e.g., "citizenid" — the identity provider ID returned by /_matrix/client/v3/login
}

interface OidcResult {
  loginToken: string;        // Matrix `m.login.token` returned at the end of the SSO flow
}

/**
 * Run the SSO flow:
 *   1. Spin up a loopback HTTP listener on a random port.
 *   2. Open the user's default browser at the Synapse SSO redirect endpoint.
 *   3. Wait for the redirect that contains `?loginToken=...`.
 *   4. Resolve with the token; the renderer then calls m.login.token to finalize.
 */
export async function runSsoFlow(params: OidcStartParams): Promise<OidcResult> {
  // H1: validate the homeserver URL scheme before it flows into shell.openExternal.
  // `new URL()` accepts file://, ftp://, etc.; only http(s) is a legitimate
  // homeserver, and we must never hand an arbitrary-scheme URI to the OS opener.
  const hs = new URL(params.homeserverUrl);
  if (hs.protocol !== "https:" && hs.protocol !== "http:") {
    throw new Error(`Refusing SSO: homeserverUrl must be http(s), got '${hs.protocol}'`);
  }

  const { port, server, settled } = await startLoopbackListener();
  const redirectUrl = `http://127.0.0.1:${port}/callback`;

  // Build Synapse SSO redirect URL — Synapse handles the OIDC dance internally;
  // we just need to send the user to /sso/redirect with our local redirect_url.
  const ssoUrl = new URL(
    `/_matrix/client/v3/login/sso/redirect/${encodeURIComponent(params.idpId)}`,
    params.homeserverUrl,
  );
  ssoUrl.searchParams.set("redirectUrl", redirectUrl);

  await shell.openExternal(ssoUrl.toString());

  try {
    const result = await settled;
    return result;
  } finally {
    server.close();
  }
}

async function startLoopbackListener(): Promise<{
  port: number;
  server: http.Server;
  settled: Promise<OidcResult>;
}> {
  return new Promise((resolveOuter, rejectOuter) => {
    const server = http.createServer();
    let settle: ((r: OidcResult) => void) | null = null;
    let reject: ((e: Error) => void) | null = null;
    const settled = new Promise<OidcResult>((res, rej) => {
      settle = res;
      reject = rej;
    });
    // Safety: time out after 5 minutes
    const timeout = setTimeout(() => {
      reject?.(new Error("SSO timed out (5 minutes)"));
      server.close();
    }, 5 * 60_000);

    let responded = false;
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      // L5: once we've accepted the first valid callback, reject any further
      // requests to this ephemeral loopback port rather than serving the
      // success page again (first-caller-wins is already enforced by the
      // single-resolve promise; this makes the intent explicit).
      if (responded || url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const loginToken = url.searchParams.get("loginToken");
      if (!loginToken) {
        res.statusCode = 400;
        res.end("missing loginToken");
        reject?.(new Error("No loginToken in SSO callback"));
        return;
      }
      responded = true;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html");
      res.end(SSO_SUCCESS_HTML);
      clearTimeout(timeout);
      settle?.({ loginToken });
    });

    server.on("error", (err) => rejectOuter(err));

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        resolveOuter({ port: addr.port, server, settled });
      } else {
        rejectOuter(new Error("Could not bind loopback listener"));
      }
    });
  });
}

const SSO_SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{color:#22d3ee}</style></head>
<body><div><h1>Signed in to Hailfreq</h1>
<p>You can close this tab and return to the app.</p></div></body></html>`;
