/**
 * Synapse test fixtures for E2E tests.
 *
 * Provides `startSynapseInstance(name, hostPort)` to spin up a fully isolated
 * Synapse + Postgres stack. Each instance gets:
 *   - Its own standalone compose file (no shared base compose.yml)
 *   - Its own container names (hailfreq-{name}-postgres, hailfreq-{name}-synapse)
 *   - Its own network (hailfreq-{name})
 *   - Its own volumes (hailfreq-{name}_postgres_data, hailfreq-{name}_synapse_data)
 *   - Its own homeserver.yaml rendered to a temp directory
 *
 * This design avoids all name/config collisions when running two instances for
 * the multi-server E2E test.
 *
 * Requirements:
 *   - podman + podman-compose available in PATH
 *   - Server directory at ../../../../server relative to this file
 */

import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

// __dirname is not available in ES modules; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.resolve(__dirname, "../../../../server");

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SynapseInstance {
  url: string;
  sharedSecret: string;
  username: string;
  password: string;
  cleanup: () => Promise<void>;
}

/**
 * Start a named, isolated Synapse instance on the given host port.
 *
 * Each instance gets its own temp directory with a standalone compose file,
 * rendered homeserver.yaml, and unique container/volume/network names so
 * multiple instances can run concurrently without any collisions.
 *
 * @param name     Short label, e.g. "alpha" or "beta". Used for container names.
 * @param hostPort TCP port to expose Synapse on (e.g. 8008, 8009).
 */
export async function startSynapseInstance(
  name: string,
  hostPort: number,
): Promise<SynapseInstance> {
  const prefix = `hailfreq-${name}`;
  const synapseUrl = `http://localhost:${hostPort}`;

  // ------------------------------------------------------------------
  // 1. Create a per-instance temp directory
  //    Contains: compose.yml, homeserver.yaml, .env, log.config, init-db.sh
  // ------------------------------------------------------------------
  const instanceDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const synapseDir = path.join(instanceDir, "synapse");
  fs.mkdirSync(synapseDir, { recursive: true });

  // ------------------------------------------------------------------
  // 2. Generate per-instance secrets
  // ------------------------------------------------------------------
  const postgresPassword = crypto.randomBytes(32).toString("hex");
  const sharedSecret = crypto.randomBytes(32).toString("hex");
  const macaroonSecret = crypto.randomBytes(32).toString("hex");
  const formSecret = crypto.randomBytes(32).toString("hex");

  // ------------------------------------------------------------------
  // 3. Render homeserver.yaml into the instance's synapse/ dir
  // ------------------------------------------------------------------
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
    // TURN not needed for E2E; replace the TURN URI template references
    .replace(/\${HAILFREQ_DOMAIN}:[^\n]*/g, "localhost:3478")
    .replace(/\${TURN_SHARED_SECRET}/g, "placeholder");

  fs.writeFileSync(path.join(synapseDir, "homeserver.yaml"), homeserverYaml);

  // Copy log.config and init-db.sh (these are static)
  fs.copyFileSync(
    path.join(SERVER_DIR, "synapse/log.config"),
    path.join(synapseDir, "log.config"),
  );
  fs.copyFileSync(
    path.join(SERVER_DIR, "synapse/init-db.sh"),
    path.join(synapseDir, "init-db.sh"),
  );
  fs.chmodSync(path.join(synapseDir, "init-db.sh"), 0o755);

  // ------------------------------------------------------------------
  // 4. Write a fully self-contained compose.yml for this instance.
  //    Uses unique container names, network name, and volume names.
  // ------------------------------------------------------------------
  const composeYaml = `
name: ${prefix}

services:
  postgres:
    image: docker.io/postgres:16-alpine
    container_name: ${prefix}-postgres
    restart: "no"
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: ${postgresPassword}
      POSTGRES_DB: synapse_init
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./synapse/init-db.sh:/docker-entrypoint-initdb.d/10-init-synapse.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synapse -d synapse"]
      interval: 10s
      timeout: 5s
      retries: 6
    networks:
      - ${prefix}

  synapse:
    image: docker.io/matrixdotorg/synapse:v1.122.0
    container_name: ${prefix}-synapse
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SYNAPSE_CONFIG_PATH: /data/homeserver.yaml
    ports:
      - "127.0.0.1:${hostPort}:8008"
    volumes:
      - synapse_data:/data
      - ./synapse/homeserver.yaml:/data/homeserver.yaml:ro
      - ./synapse/log.config:/data/log.config:ro
    healthcheck:
      test: ["CMD", "curl", "-fSs", "http://localhost:8008/health"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 30s
    networks:
      - ${prefix}

networks:
  ${prefix}:
    name: ${prefix}

volumes:
  postgres_data:
  synapse_data:
`.trimStart();

  fs.writeFileSync(path.join(instanceDir, "compose.yml"), composeYaml);

  // ------------------------------------------------------------------
  // 5. Helper: run a podman-compose command in the instance directory
  // ------------------------------------------------------------------
  const compose = (cmd: string, opts: { stdio?: "inherit" | "pipe"; encoding?: "utf8" } = {}) =>
    execSync(`podman compose ${cmd}`, {
      cwd: instanceDir,
      stdio: opts.stdio ?? "inherit",
      ...(opts.encoding ? { encoding: opts.encoding } : {}),
    });

  // ------------------------------------------------------------------
  // 6. Tear down any leftover containers from a previous run
  //    (identified by container names, which are deterministic per instance)
  // ------------------------------------------------------------------
  try {
    compose("down -v --remove-orphans", { stdio: "pipe" });
  } catch {
    // No previous stack running — ignore
  }

  // Also remove any orphaned containers by name (belt-and-suspenders)
  for (const cname of [`${prefix}-postgres`, `${prefix}-synapse`]) {
    try {
      execSync(`podman rm -f ${cname}`, { stdio: "pipe" });
    } catch {
      // Container doesn't exist — ignore
    }
  }

  // ------------------------------------------------------------------
  // 7. Bring up postgres + synapse
  // ------------------------------------------------------------------
  console.log(
    `[synapse:${name}] Starting postgres + synapse on port ${hostPort}...`,
  );
  compose("up -d postgres synapse");

  // ------------------------------------------------------------------
  // 8. Fix rootless-podman uid 991 volume ownership
  //
  //    Volumes are named by compose project prefix so they're unique:
  //    e.g. "hailfreq-alpha_synapse_data"
  // ------------------------------------------------------------------
  console.log(`[synapse:${name}] Fixing uid 991 volume ownership...`);
  try {
    const volumeName = `${prefix}_synapse_data`;
    const mountpoint = execSync(
      `podman volume inspect ${volumeName} --format '{{ .Mountpoint }}'`,
      { encoding: "utf8" },
    ).trim();

    if (mountpoint) {
      execSync(`podman unshare chown -R 991:991 ${mountpoint}`, {
        stdio: "inherit",
      });
      console.log(`[synapse:${name}] Restarting synapse after ownership fix...`);
      compose("restart synapse");
    }
  } catch (err) {
    console.warn(
      `[synapse:${name}] uid 991 fix skipped:`,
      err instanceof Error ? err.message : err,
    );
  }

  // ------------------------------------------------------------------
  // 9. Wait up to 90 s for /health
  // ------------------------------------------------------------------
  console.log(`[synapse:${name}] Waiting for Synapse /health at ${synapseUrl}...`);
  let healthy = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${synapseUrl}/health`);
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
    try {
      const logs = execSync("podman compose logs synapse --tail=30", {
        cwd: instanceDir,
        encoding: "utf8",
      });
      console.error(`[synapse:${name}] Synapse logs:\n`, logs);
    } catch {}
    // Clean up before throwing
    try { compose("down -v --remove-orphans", { stdio: "pipe" }); } catch {}
    fs.rmSync(instanceDir, { recursive: true, force: true });
    throw new Error(
      `[synapse:${name}] Synapse did not become healthy within 90 seconds`,
    );
  }

  // ------------------------------------------------------------------
  // 10. Provision a test user
  // ------------------------------------------------------------------
  console.log(`[synapse:${name}] Synapse is healthy. Provisioning test user...`);
  const user = await provisionUser(synapseUrl, sharedSecret);
  console.log(`[synapse:${name}] Provisioned user: @${user.username}:localhost`);

  // ------------------------------------------------------------------
  // 11. Return instance with cleanup
  // ------------------------------------------------------------------
  const cleanup = async () => {
    console.log(`[synapse:${name}] Tearing down stack...`);
    try {
      compose("down -v --remove-orphans");
    } catch (err) {
      console.error(`[synapse:${name}] Cleanup error:`, err);
    }
    // Remove the temp instance directory
    fs.rmSync(instanceDir, { recursive: true, force: true });
  };

  return {
    url: synapseUrl,
    sharedSecret,
    username: user.username,
    password: user.password,
    cleanup,
  };
}

/**
 * Convenience wrapper: start a single default instance on port 8008.
 * Kept for backward-compat with firstrun.spec.ts (which uses startSynapseInstance
 * directly now, but this alias avoids breaking any other callers).
 */
export async function startSynapse(): Promise<SynapseInstance> {
  return startSynapseInstance("default", 8008);
}

// ---------------------------------------------------------------------------
// Full-stack fixture: postgres + synapse + livekit + coturn + livekit-auth
// ---------------------------------------------------------------------------

export interface FullStackInstance extends SynapseInstance {
  /** LiveKit WebSocket URL reachable from the host (e.g. ws://localhost:7880) */
  liveKitUrl: string;
  /** livekit-auth HTTP base URL reachable from the host (e.g. http://localhost:8088) */
  liveKitAuthUrl: string;
  /** LiveKit API key (used for direct SDK calls in tests) */
  liveKitApiKey: string;
  /** LiveKit API secret (used for direct SDK calls in tests) */
  liveKitApiSecret: string;
  /** Provision a second user on the same stack */
  provisionSecondUser: () => Promise<{ username: string; password: string }>;
}

/**
 * Start a full voice stack: postgres + synapse + livekit + coturn + livekit-auth.
 *
 * All services share one compose project so they can communicate over the
 * project-scoped bridge network. LiveKit and coturn are NOT run with
 * `network_mode: host` here — instead they use the compose bridge and expose
 * ports on 127.0.0.1.  This is sufficient for loopback E2E tests where both
 * clients run on the same host.
 *
 * Port layout (all on 127.0.0.1):
 *   hostPort        — Synapse HTTP
 *   hostPort+1000   — LiveKit HTTP/WS (e.g., 9880 when hostPort=8880)
 *   hostPort+1001   — livekit-auth HTTP (e.g., 9881 when hostPort=8880)
 *   3478 (UDP/TCP)  — coturn TURN (fixed; only one coturn instance per host)
 *
 * @param name     Short label, e.g. "voice". Used for container/volume/network names.
 * @param hostPort Synapse TCP port (e.g. 8008). LiveKit uses hostPort+1000.
 */
export async function startFullStackInstance(
  name: string,
  hostPort: number,
): Promise<FullStackInstance> {
  const prefix = `hailfreq-${name}`;
  const synapseUrl = `http://localhost:${hostPort}`;
  const liveKitPort = hostPort + 1000;
  const liveKitAuthPort = hostPort + 1001;
  const liveKitUrl = `ws://localhost:${liveKitPort}`;
  const liveKitAuthUrl = `http://localhost:${liveKitAuthPort}`;

  // Generate LiveKit credentials
  const liveKitApiKey = crypto.randomBytes(12).toString("hex");
  const liveKitApiSecret = crypto.randomBytes(32).toString("hex");
  const turnSecret = crypto.randomBytes(32).toString("hex");

  // ------------------------------------------------------------------
  // 1. Create a per-instance temp directory
  // ------------------------------------------------------------------
  const instanceDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const synapseDir = path.join(instanceDir, "synapse");
  const liveKitDir = path.join(instanceDir, "livekit");
  const coturnDir = path.join(instanceDir, "coturn");
  fs.mkdirSync(synapseDir, { recursive: true });
  fs.mkdirSync(liveKitDir, { recursive: true });
  fs.mkdirSync(coturnDir, { recursive: true });

  // ------------------------------------------------------------------
  // 2. Generate per-instance secrets
  // ------------------------------------------------------------------
  const postgresPassword = crypto.randomBytes(32).toString("hex");
  const sharedSecret = crypto.randomBytes(32).toString("hex");
  const macaroonSecret = crypto.randomBytes(32).toString("hex");
  const formSecret = crypto.randomBytes(32).toString("hex");

  // ------------------------------------------------------------------
  // 3. Render homeserver.yaml
  // ------------------------------------------------------------------
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
    .replace(/\${HAILFREQ_DOMAIN}:[^\n]*/g, "localhost:3478")
    .replace(/\${TURN_SHARED_SECRET}/g, turnSecret);

  fs.writeFileSync(path.join(synapseDir, "homeserver.yaml"), homeserverYaml);
  fs.copyFileSync(
    path.join(SERVER_DIR, "synapse/log.config"),
    path.join(synapseDir, "log.config"),
  );
  fs.copyFileSync(
    path.join(SERVER_DIR, "synapse/init-db.sh"),
    path.join(synapseDir, "init-db.sh"),
  );
  fs.chmodSync(path.join(synapseDir, "init-db.sh"), 0o755);

  // ------------------------------------------------------------------
  // 4. Render livekit.yaml
  // ------------------------------------------------------------------
  const liveKitTemplate = fs.readFileSync(
    path.join(SERVER_DIR, "livekit/livekit.yaml.template"),
    "utf8",
  );
  const liveKitYaml = liveKitTemplate
    .replace(/\${LIVEKIT_API_KEY}/g, liveKitApiKey)
    .replace(/\${LIVEKIT_API_SECRET}/g, liveKitApiSecret)
    .replace(/\${HAILFREQ_PUBLIC_IP}/g, "127.0.0.1")
    // Use a small port range to avoid collisions with host services
    .replace(/port_range_start: \d+/, "port_range_start: 50200")
    .replace(/port_range_end: \d+/, "port_range_end: 50299")
    // Disable external IP usage for loopback testing
    .replace(/use_external_ip: true/, "use_external_ip: false")
    .replace(/node_ip:.*/, "node_ip: \"127.0.0.1\"")
    // Disable TURN (coturn) for simplicity in loopback tests
    .replace(/turn:\n\s+enabled: false/, "turn:\n  enabled: false");
  fs.writeFileSync(path.join(liveKitDir, "livekit.yaml"), liveKitYaml);

  // ------------------------------------------------------------------
  // 5. Render coturn config (minimal for loopback testing)
  // ------------------------------------------------------------------
  const coturnConf = [
    `listening-port=3478`,
    `listening-ip=0.0.0.0`,
    `external-ip=127.0.0.1`,
    `min-port=49200`,
    `max-port=49299`,
    `realm=localhost`,
    `server-name=localhost`,
    `use-auth-secret`,
    `static-auth-secret=${turnSecret}`,
    `log-file=stdout`,
    `no-cli`,
    `verbose`,
  ].join("\n");
  fs.writeFileSync(path.join(coturnDir, "turnserver.conf"), coturnConf);

  // ------------------------------------------------------------------
  // 6. Write the full-stack compose.yml
  //    LiveKit and coturn use bridge networking (not host mode) for
  //    loopback E2E. Ports are exposed on 127.0.0.1 for isolation.
  // ------------------------------------------------------------------
  const composeYaml = `
name: ${prefix}

services:
  postgres:
    image: docker.io/postgres:16-alpine
    container_name: ${prefix}-postgres
    restart: "no"
    environment:
      POSTGRES_USER: synapse
      POSTGRES_PASSWORD: ${postgresPassword}
      POSTGRES_DB: synapse_init
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./synapse/init-db.sh:/docker-entrypoint-initdb.d/10-init-synapse.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U synapse -d synapse"]
      interval: 10s
      timeout: 5s
      retries: 6
    networks:
      - ${prefix}

  synapse:
    image: docker.io/matrixdotorg/synapse:v1.122.0
    container_name: ${prefix}-synapse
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      SYNAPSE_CONFIG_PATH: /data/homeserver.yaml
    ports:
      - "127.0.0.1:${hostPort}:8008"
    volumes:
      - synapse_data:/data
      - ./synapse/homeserver.yaml:/data/homeserver.yaml:ro
      - ./synapse/log.config:/data/log.config:ro
    healthcheck:
      test: ["CMD", "curl", "-fSs", "http://localhost:8008/health"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 30s
    networks:
      - ${prefix}

  livekit:
    image: docker.io/livekit/livekit-server:v1.7
    container_name: ${prefix}-livekit
    restart: "no"
    command: --config /etc/livekit.yaml
    ports:
      - "127.0.0.1:${liveKitPort}:7880"
      - "127.0.0.1:${liveKitPort + 1}:7881"
    volumes:
      - ./livekit/livekit.yaml:/etc/livekit.yaml:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:7880/"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 20s
    networks:
      - ${prefix}

  livekit-auth:
    image: localhost/hailfreq/livekit-auth:local
    container_name: ${prefix}-livekit-auth
    restart: "no"
    depends_on:
      synapse:
        condition: service_healthy
    environment:
      PORT: "8088"
      SYNAPSE_URL: "http://${prefix}-synapse:8008"
      LIVEKIT_URL: "ws://${prefix}-livekit:7880"
      LIVEKIT_API_KEY: "${liveKitApiKey}"
      LIVEKIT_API_SECRET: "${liveKitApiSecret}"
    ports:
      - "127.0.0.1:${liveKitAuthPort}:8088"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8088/health"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 10s
    networks:
      - ${prefix}

networks:
  ${prefix}:
    name: ${prefix}

volumes:
  postgres_data:
  synapse_data:
`.trimStart();

  fs.writeFileSync(path.join(instanceDir, "compose.yml"), composeYaml);

  // ------------------------------------------------------------------
  // 7. Helper: run a podman-compose command in the instance directory
  // ------------------------------------------------------------------
  const compose = (cmd: string, opts: { stdio?: "inherit" | "pipe"; encoding?: "utf8" } = {}) =>
    execSync(`podman compose ${cmd}`, {
      cwd: instanceDir,
      stdio: opts.stdio ?? "inherit",
      ...(opts.encoding ? { encoding: opts.encoding } : {}),
    });

  // ------------------------------------------------------------------
  // 8. Tear down any leftover containers from a previous run
  // ------------------------------------------------------------------
  try {
    compose("down -v --remove-orphans", { stdio: "pipe" });
  } catch {
    // No previous stack running — ignore
  }
  for (const cname of [
    `${prefix}-postgres`,
    `${prefix}-synapse`,
    `${prefix}-livekit`,
    `${prefix}-livekit-auth`,
  ]) {
    try {
      execSync(`podman rm -f ${cname}`, { stdio: "pipe" });
    } catch {
      // Container doesn't exist — ignore
    }
  }

  // ------------------------------------------------------------------
  // 9. Bring up postgres + synapse + livekit + livekit-auth
  //    (coturn is omitted for loopback tests — ICE will use host directly)
  // ------------------------------------------------------------------
  console.log(
    `[fullstack:${name}] Starting postgres + synapse + livekit + livekit-auth on ports ${hostPort}/${liveKitPort}/${liveKitAuthPort}...`,
  );
  compose("up -d postgres synapse livekit livekit-auth");

  // ------------------------------------------------------------------
  // 10. Fix rootless-podman uid 991 volume ownership for Synapse
  // ------------------------------------------------------------------
  console.log(`[fullstack:${name}] Fixing uid 991 volume ownership...`);
  try {
    const volumeName = `${prefix}_synapse_data`;
    const mountpoint = execSync(
      `podman volume inspect ${volumeName} --format '{{ .Mountpoint }}'`,
      { encoding: "utf8" },
    ).trim();

    if (mountpoint) {
      execSync(`podman unshare chown -R 991:991 ${mountpoint}`, {
        stdio: "inherit",
      });
      console.log(`[fullstack:${name}] Restarting synapse after ownership fix...`);
      compose("restart synapse");
    }
  } catch (err) {
    console.warn(
      `[fullstack:${name}] uid 991 fix skipped:`,
      err instanceof Error ? err.message : err,
    );
  }

  // ------------------------------------------------------------------
  // 11. Wait for Synapse /health (up to 90 s)
  // ------------------------------------------------------------------
  console.log(`[fullstack:${name}] Waiting for Synapse /health at ${synapseUrl}...`);
  let synapseHealthy = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${synapseUrl}/health`);
      if (r.ok) { synapseHealthy = true; break; }
    } catch { /* not ready yet */ }
    await sleep(1000);
  }

  if (!synapseHealthy) {
    try {
      const logs = execSync("podman compose logs synapse --tail=30", {
        cwd: instanceDir, encoding: "utf8",
      });
      console.error(`[fullstack:${name}] Synapse logs:\n`, logs);
    } catch {}
    try { compose("down -v --remove-orphans", { stdio: "pipe" }); } catch {}
    fs.rmSync(instanceDir, { recursive: true, force: true });
    throw new Error(`[fullstack:${name}] Synapse did not become healthy within 90 seconds`);
  }

  // ------------------------------------------------------------------
  // 12. Wait for LiveKit /health (up to 60 s)
  // ------------------------------------------------------------------
  console.log(`[fullstack:${name}] Waiting for LiveKit at ws://localhost:${liveKitPort}...`);
  let liveKitHealthy = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${liveKitPort}/`);
      // LiveKit returns 404 on GET / but 200 on GET /rtc (or similar).
      // Any non-connection-refused response indicates the server is up.
      if (r.status < 600) { liveKitHealthy = true; break; }
    } catch { /* not ready yet */ }
    await sleep(1000);
  }

  if (!liveKitHealthy) {
    try {
      const logs = execSync("podman compose logs livekit --tail=30", {
        cwd: instanceDir, encoding: "utf8",
      });
      console.error(`[fullstack:${name}] LiveKit logs:\n`, logs);
    } catch {}
    try { compose("down -v --remove-orphans", { stdio: "pipe" }); } catch {}
    fs.rmSync(instanceDir, { recursive: true, force: true });
    throw new Error(`[fullstack:${name}] LiveKit did not become healthy within 60 seconds`);
  }

  // ------------------------------------------------------------------
  // 13. Wait for livekit-auth /health (up to 30 s)
  // ------------------------------------------------------------------
  console.log(`[fullstack:${name}] Waiting for livekit-auth at ${liveKitAuthUrl}...`);
  let authHealthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${liveKitAuthUrl}/health`);
      if (r.ok) { authHealthy = true; break; }
    } catch { /* not ready yet */ }
    await sleep(1000);
  }

  if (!authHealthy) {
    try {
      const logs = execSync("podman compose logs livekit-auth --tail=30", {
        cwd: instanceDir, encoding: "utf8",
      });
      console.error(`[fullstack:${name}] livekit-auth logs:\n`, logs);
    } catch {}
    try { compose("down -v --remove-orphans", { stdio: "pipe" }); } catch {}
    fs.rmSync(instanceDir, { recursive: true, force: true });
    throw new Error(`[fullstack:${name}] livekit-auth did not become healthy within 30 seconds`);
  }

  // ------------------------------------------------------------------
  // 14. Provision test user A
  // ------------------------------------------------------------------
  console.log(`[fullstack:${name}] All services healthy. Provisioning test users...`);
  const userA = await provisionUser(synapseUrl, sharedSecret);
  console.log(`[fullstack:${name}] Provisioned user A: @${userA.username}:localhost`);

  // ------------------------------------------------------------------
  // 15. Return instance with cleanup
  // ------------------------------------------------------------------
  const cleanup = async () => {
    console.log(`[fullstack:${name}] Tearing down full stack...`);
    try {
      compose("down -v --remove-orphans");
    } catch (err) {
      console.error(`[fullstack:${name}] Cleanup error:`, err);
    }
    fs.rmSync(instanceDir, { recursive: true, force: true });
  };

  return {
    url: synapseUrl,
    sharedSecret,
    username: userA.username,
    password: userA.password,
    liveKitUrl,
    liveKitAuthUrl,
    liveKitApiKey,
    liveKitApiSecret,
    cleanup,
    provisionSecondUser: () => provisionUser(synapseUrl, sharedSecret),
  };
}

// ---------------------------------------------------------------------------
// User provisioning
// ---------------------------------------------------------------------------

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
  const nonceResp = await fetch(`${serverUrl}/_synapse/admin/v1/register`);
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
