/**
 * Synapse test fixture for E2E tests.
 *
 * Spins up a local Synapse + Postgres stack using the Plan 1 server kit,
 * publishes Synapse on localhost:8008, and provisions a fresh test user via
 * the Synapse admin registration API.
 *
 * Requirements:
 *   - podman + podman-compose available in PATH
 *   - Server directory at ../../../../server relative to this file
 *   - openssl available for secret generation
 */

import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// __dirname is not available in ES modules; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.resolve(__dirname, "../../../../server");
const SYNAPSE_URL = "http://localhost:8008";

export interface SynapseFixture {
  url: string;
  sharedSecret: string;
  username: string;
  password: string;
  cleanup: () => Promise<void>;
}

/**
 * Set up and start the Synapse test server, provision a user, and return
 * credentials + cleanup function.
 *
 * This bypasses setup.sh to avoid the full livekit/coturn/caddy render chain —
 * we only need Synapse + Postgres for E2E tests.
 */
export async function startSynapse(): Promise<SynapseFixture> {
  // Generate secrets needed for Synapse
  const postgresPassword = crypto.randomBytes(32).toString("hex");
  const sharedSecret = crypto.randomBytes(32).toString("hex");
  const macaroonSecret = crypto.randomBytes(32).toString("hex");
  const formSecret = crypto.randomBytes(32).toString("hex");

  // Write a minimal .env for compose to read
  const envContent = [
    `HAILFREQ_DOMAIN=localhost`,
    `HAILFREQ_ADMIN_EMAIL=test@localhost`,
    `HAILFREQ_PUBLIC_IP=127.0.0.1`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `SYNAPSE_REGISTRATION_SHARED_SECRET=${sharedSecret}`,
    `SYNAPSE_MACAROON_SECRET=${macaroonSecret}`,
    `SYNAPSE_FORM_SECRET=${formSecret}`,
    `LIVEKIT_API_KEY=testkey`,
    `LIVEKIT_API_SECRET=${crypto.randomBytes(32).toString("hex")}`,
    `TURN_SHARED_SECRET=${crypto.randomBytes(32).toString("hex")}`,
    `CITIZENID_CLIENT_ID=`,
    `CITIZENID_CLIENT_SECRET=`,
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(SERVER_DIR, ".env"), envContent);

  // Render homeserver.yaml from template
  const homeserverTemplate = fs.readFileSync(
    path.join(SERVER_DIR, "synapse/homeserver.yaml.template"),
    "utf8",
  );

  const homeserverYaml = homeserverTemplate
    .replace(/\${HAILFREQ_DOMAIN}/g, "localhost")
    .replace(/\${POSTGRES_PASSWORD}/g, postgresPassword)
    .replace(/\${SYNAPSE_REGISTRATION_SHARED_SECRET}/g, sharedSecret)
    .replace(/\${SYNAPSE_MACAROON_SECRET}/g, macaroonSecret)
    .replace(/\${SYNAPSE_FORM_SECRET}/g, formSecret)
    .replace(/\${OIDC_PROVIDERS_BLOCK}/g, "  []")
    // Turn/TURN not needed for E2E
    .replace(/\${HAILFREQ_DOMAIN}:[^\n]*/g, "")
    .replace(/\${TURN_SHARED_SECRET}/g, "placeholder");

  fs.writeFileSync(
    path.join(SERVER_DIR, "synapse/homeserver.yaml"),
    homeserverYaml,
  );

  // Write compose.override.yml to publish Synapse port 8008 on localhost
  const override = [
    "services:",
    "  synapse:",
    "    ports:",
    '      - "127.0.0.1:8008:8008"',
    "  caddy:",
    "    profiles:",
    '      - disabled',
    "  livekit:",
    "    profiles:",
    '      - disabled',
    "  coturn:",
    "    profiles:",
    '      - disabled',
  ].join("\n") + "\n";

  fs.writeFileSync(
    path.join(SERVER_DIR, "compose.override.yml"),
    override,
  );

  // Ensure any previous stack is fully torn down so we start fresh
  try {
    execSync("podman compose down -v --remove-orphans", {
      cwd: SERVER_DIR,
      stdio: "pipe",
    });
  } catch {
    // Ignore errors — stack may not have been running
  }

  // Bring up postgres first, then synapse
  console.log("[synapse-fixture] Starting postgres + synapse via podman compose...");
  execSync("podman compose up -d postgres synapse", {
    cwd: SERVER_DIR,
    stdio: "inherit",
  });

  // Fix rootless-podman uid 991 volume ownership issue.
  // Synapse runs as uid 991 inside the container but the volume directories
  // are created with the host user's uid, causing "permission denied" on first start.
  // We use `podman unshare` to enter the user namespace and chown correctly.
  console.log("[synapse-fixture] Fixing uid 991 volume ownership...");
  try {
    const mountpoint = execSync(
      "podman volume inspect hailfreq_synapse_data --format '{{ .Mountpoint }}'",
      { encoding: "utf8" },
    ).trim();

    if (mountpoint) {
      execSync(`podman unshare chown -R 991:991 ${mountpoint}`, {
        stdio: "inherit",
      });
      console.log("[synapse-fixture] Restarting synapse after ownership fix...");
      execSync("podman compose restart synapse", {
        cwd: SERVER_DIR,
        stdio: "inherit",
      });
    }
  } catch (err) {
    // Volume may not exist yet or ownership fix already applied — continue
    console.warn("[synapse-fixture] uid 991 fix skipped:", err instanceof Error ? err.message : err);
  }

  // Wait up to 90s for Synapse /health endpoint
  console.log("[synapse-fixture] Waiting for Synapse /health...");
  let healthy = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${SYNAPSE_URL}/health`);
      if (r.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await sleep(1000);
  }

  if (!healthy) {
    // Dump logs before failing
    try {
      const logs = execSync("podman compose logs synapse --tail=30", {
        cwd: SERVER_DIR,
        encoding: "utf8",
      });
      console.error("[synapse-fixture] Synapse logs:\n", logs);
    } catch {}
    throw new Error("Synapse did not become healthy within 90 seconds");
  }

  console.log("[synapse-fixture] Synapse is healthy. Provisioning test user...");

  // Provision a test user via Synapse shared-secret registration
  const user = await provisionUser(SYNAPSE_URL, sharedSecret);

  console.log(`[synapse-fixture] Provisioned user: @${user.username}:localhost`);

  const cleanup = async () => {
    console.log("[synapse-fixture] Tearing down stack...");
    try {
      execSync("podman compose down -v --remove-orphans", {
        cwd: SERVER_DIR,
        stdio: "inherit",
      });
    } catch (err) {
      console.error("[synapse-fixture] Cleanup error:", err);
    }
    // Remove the override file
    fs.rmSync(path.join(SERVER_DIR, "compose.override.yml"), { force: true });
  };

  return {
    url: SYNAPSE_URL,
    sharedSecret,
    username: user.username,
    password: user.password,
    cleanup,
  };
}

/**
 * Provision a new Matrix user via Synapse's shared-secret registration API.
 * Uses HMAC-SHA1 as required by Synapse's admin registration endpoint.
 */
export async function provisionUser(
  serverUrl: string,
  sharedSecret: string,
): Promise<{ username: string; password: string }> {
  const username = `e2e_${crypto.randomBytes(4).toString("hex")}`;
  const password = crypto.randomBytes(12).toString("base64url");

  // Step 1: get a nonce
  const nonceResp = await fetch(
    `${serverUrl}/_synapse/admin/v1/register`,
  );
  if (!nonceResp.ok) {
    throw new Error(
      `Failed to get nonce: ${nonceResp.status} ${nonceResp.statusText}`,
    );
  }
  const { nonce } = (await nonceResp.json()) as { nonce: string };

  // Step 2: compute HMAC-SHA1 mac
  // Format: nonce\0username\0password\0(admin|notadmin)
  const mac = crypto.createHmac("sha1", sharedSecret);
  mac.update(nonce);
  mac.update("\x00");
  mac.update(username);
  mac.update("\x00");
  mac.update(password);
  mac.update("\x00");
  mac.update("notadmin");
  const digest = mac.digest("hex");

  // Step 3: register the user
  const regResp = await fetch(`${serverUrl}/_synapse/admin/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce,
      username,
      password,
      admin: false,
      mac: digest,
    }),
  });

  if (!regResp.ok) {
    const body = await regResp.text();
    throw new Error(
      `Failed to register user: ${regResp.status} ${body}`,
    );
  }

  return { username, password };
}
