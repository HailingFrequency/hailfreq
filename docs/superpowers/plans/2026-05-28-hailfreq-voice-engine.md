# Hailfreq Voice Engine Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tactical-radio voice engine — the headline feature of Hailfreq. Members can monitor multiple "nets" simultaneously, push-to-talk on a specific net with a global hotkey, hear priority ducking when higher-priority nets transmit, and all voice content is end-to-end encrypted via LiveKit's SFrame using Matrix-distributed keys. After Plan 4, the placeholder Home screen is replaced with the real tactical UI: list of monitored nets with volume sliders, active-speaker indicators, PTT bindings, and create-net flow.

**Architecture:** A "net" is one Matrix room paired with one LiveKit room (sharing the UUID portion of the Matrix room ID, per spec §5.1). The Hailfreq client subscribes to multiple LiveKit rooms simultaneously (typically 3-6) and routes their audio through a Web Audio API mixer with per-net gain nodes for volume control and priority ducking. A small Node "LiveKit auth" service alongside Synapse mints LiveKit JWTs after validating the requester's Matrix access token and room membership. SFrame keys are generated at net creation, stored as encrypted Matrix state events, distributed via Megolm-encrypted to-device messages, and consumed by LiveKit's `ExternalE2EEKeyProvider`. Membership-triggered key rotation is deferred to v1.5 (Plan 6 or later).

**Tech Stack:** Server-side adds a tiny TypeScript Node service (Express + livekit-server-sdk + matrix-js-sdk) running in its own container. Client-side adds livekit-client and Web Audio API usage. Electron's `globalShortcut` API for cross-platform PTT hotkeys.

**Scope reference:** Implements §5 (Multi-Net Voice Design — net model, multi-room subscription, PTT/outbound, priority ducking, capacity envelope) and the must-have features from §9.1's v1 list: multi-net simultaneous voice monitor, per-net PTT with global hotkeys (basic — 1 keybind per net for v1), priority ducking (basic dB attenuation), text chat per net (inherited from Matrix). **Plus** voice activation mode (was originally v1.5 per spec; promoted to v1 in this plan).

**PTT modes — per-net configurable:**

Each net is configured with one of three transmission modes:

- **Tap-to-toggle** — tap the keybind to start, tap again to stop. Uses Electron's `globalShortcut` (works everywhere, including Wayland).
- **Press-and-hold** — true PTT: transmit while held, stop on release. Requires a native key-listener module (`node-global-key-listener`). Works on Windows, macOS, and X11 Linux. **Wayland users fall back to tap-to-toggle** because Wayland's security model forbids system-wide keyboard hooks.
- **Voice activation (open-mic)** — automatic transmission triggered by mic level above a configured threshold, with hangover delay before stopping. No native deps; uses Web Audio API analysis on the mic stream.

The mode is a per-net property the admin sets at net creation (or any member toggles for themselves in their preferences — design call: for v1 the mode is a personal preference, not a net-level state event, since each member may want different modes on the same net).

**Out of scope for this plan:**
- Radio chirps (custom WAV/MP3 intro/outro tones) — v1.5
- Focused-app PTT (Win32 / X11 focus detection) — v1.5
- Screen sharing UI exposure — v1.5
- Net Bridges (client-side audio relay between two nets) — v1.5
- SFrame key rotation on membership changes — v1.5
- Multi-server voice (Plan 4 operates only on the active server's nets)
- Admin board (Plan 5)
- Wayland press-and-hold support (limited by compositor security; v1.5+ may explore Wayland-specific approaches like libei/portal-globalshortcuts)

**Repo location:** Server-side additions under `server/livekit-auth/`. Client-side additions throughout `client/src/`.

---

## Task 1: LiveKit auth service — scaffold

**Files:**
- Create: `server/livekit-auth/package.json`
- Create: `server/livekit-auth/tsconfig.json`
- Create: `server/livekit-auth/Dockerfile`
- Create: `server/livekit-auth/src/index.ts` (skeleton)
- Create: `server/livekit-auth/.gitignore`

The service exposes one endpoint: `POST /token` taking `{ matrixAccessToken: string, matrixRoomId: string }` and returning `{ token: string, url: string }`. Validates the Matrix access token via Synapse's whoami, confirms the user is a member of the requested Matrix room, derives the paired LiveKit room name, and mints a JWT using livekit-server-sdk.

- [ ] **Step 1: Create directory + `server/livekit-auth/package.json`**

```bash
mkdir -p server/livekit-auth/src
```

```json
{
  "name": "hailfreq-livekit-auth",
  "version": "0.1.0",
  "description": "Token-minting service that validates Matrix access tokens and issues LiveKit JWTs",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "express": "^4.21.0",
    "livekit-server-sdk": "^2.9.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Create `server/livekit-auth/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `server/livekit-auth/src/index.ts` (skeleton)**

```ts
import express, { type Request, type Response } from "express";

const PORT = parseInt(process.env.PORT || "8088", 10);
const SYNAPSE_URL = mustEnv("SYNAPSE_URL");
const LIVEKIT_URL = mustEnv("LIVEKIT_URL");
const LIVEKIT_API_KEY = mustEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = mustEnv("LIVEKIT_API_SECRET");

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/token", async (_req: Request, res: Response) => {
  // Implemented in Task 2
  res.status(501).json({ error: "not implemented" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`hailfreq-livekit-auth listening on :${PORT}`);
  console.log(`  Synapse: ${SYNAPSE_URL}`);
  console.log(`  LiveKit: ${LIVEKIT_URL}`);
});

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}
```

- [ ] **Step 4: Write `server/livekit-auth/Dockerfile`**

```dockerfile
FROM docker.io/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM docker.io/node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8088
USER node
CMD ["node", "dist/index.js"]
```

- [ ] **Step 5: Write `server/livekit-auth/.gitignore`**

```
node_modules/
dist/
*.log
.env
```

- [ ] **Step 6: Install + build smoke test**

```bash
cd server/livekit-auth
npm install
npm run build 2>&1 | tail -5
# Expect: dist/index.js exists, no TS errors
ls dist/
```

- [ ] **Step 7: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add server/livekit-auth/
git commit -m "server: scaffold livekit-auth service (token-minting skeleton)"
```

---

## Task 2: LiveKit auth service — token minting logic

**Files:**
- Modify: `server/livekit-auth/src/index.ts`

Implement the actual `/token` handler:

1. Parse `matrixAccessToken` and `matrixRoomId` from request body.
2. Call `${SYNAPSE_URL}/_matrix/client/v3/account/whoami` with the access token. Extract `user_id`.
3. Call `${SYNAPSE_URL}/_matrix/client/v3/rooms/${roomId}/state/m.room.member/${userId}` with the access token. Confirm membership state is "join".
4. Derive LiveKit room name from the Matrix room ID: `!a1b2c3...:server` → `a1b2c3...` (the localpart of the Matrix room ID).
5. Mint a LiveKit JWT with the user's Matrix user ID as `identity` and the derived room name in the grant.
6. Return `{ token, url: LIVEKIT_URL }`.

- [ ] **Step 1: Update `server/livekit-auth/src/index.ts`**

Replace the `/token` placeholder with:

```ts
import { AccessToken } from "livekit-server-sdk";

app.post("/token", async (req: Request, res: Response) => {
  try {
    const { matrixAccessToken, matrixRoomId } = req.body as {
      matrixAccessToken?: string;
      matrixRoomId?: string;
    };

    if (!matrixAccessToken || typeof matrixAccessToken !== "string") {
      return res.status(400).json({ error: "matrixAccessToken required" });
    }
    if (!matrixRoomId || typeof matrixRoomId !== "string" || !matrixRoomId.startsWith("!")) {
      return res.status(400).json({ error: "matrixRoomId required (Matrix room ID format)" });
    }

    // 1. Validate access token via whoami
    const whoamiResp = await fetch(`${SYNAPSE_URL}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${matrixAccessToken}` },
    });
    if (!whoamiResp.ok) {
      return res.status(401).json({ error: "invalid Matrix access token" });
    }
    const { user_id: userId } = (await whoamiResp.json()) as { user_id: string };

    // 2. Verify membership
    const memberResp = await fetch(
      `${SYNAPSE_URL}/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${matrixAccessToken}` } }
    );
    if (!memberResp.ok) {
      return res.status(403).json({ error: "not a member of this room" });
    }
    const memberState = (await memberResp.json()) as { membership?: string };
    if (memberState.membership !== "join") {
      return res.status(403).json({ error: "not a member of this room" });
    }

    // 3. Derive LiveKit room name from Matrix room ID localpart
    // !a1b2c3d4...:server → a1b2c3d4...
    const colonIdx = matrixRoomId.indexOf(":");
    const liveKitRoom =
      colonIdx > 0 ? matrixRoomId.substring(1, colonIdx) : matrixRoomId.substring(1);

    // 4. Mint LiveKit JWT
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      ttl: 60 * 60 * 6, // 6 hours
    });
    at.addGrant({
      room: liveKitRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return res.json({ token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("token mint failed:", err);
    return res.status(500).json({ error: "internal error" });
  }
});
```

- [ ] **Step 2: Add CORS headers (Caddy will be in front, but defensive)**

Above the `app.post("/token", ...)` registration:

```ts
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
```

- [ ] **Step 3: Build + check**

```bash
cd /home/shreen/code/tactical-radio/server/livekit-auth
npm run build 2>&1 | tail -5
# Expect: clean
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add server/livekit-auth/src/index.ts
git commit -m "server(livekit-auth): implement /token with whoami + membership check + JWT minting"
```

---

## Task 3: Wire LiveKit auth into compose + Caddy

**Files:**
- Modify: `server/compose.yml`
- Modify: `server/Caddyfile.template`
- Modify: `server/scripts/setup.sh` (build the auth image)

- [ ] **Step 1: Add `livekit-auth` service to `server/compose.yml`**

Append to `services:`:

```yaml
  livekit-auth:
    image: hailfreq/livekit-auth:local
    build:
      context: ./livekit-auth
      dockerfile: Dockerfile
    container_name: hailfreq-livekit-auth
    restart: unless-stopped
    depends_on:
      synapse:
        condition: service_healthy
    environment:
      PORT: "8088"
      SYNAPSE_URL: "http://synapse:8008"
      LIVEKIT_URL: "wss://${HAILFREQ_DOMAIN}/livekit"
      LIVEKIT_API_KEY: "${LIVEKIT_API_KEY}"
      LIVEKIT_API_SECRET: "${LIVEKIT_API_SECRET}"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8088/health"]
      interval: 15s
      timeout: 5s
      retries: 6
      start_period: 10s
    networks:
      - hailfreq
```

- [ ] **Step 2: Add Caddyfile route for the auth service**

In `server/Caddyfile.template`, add a new `handle` block alongside the existing ones (before the `livekit` handle):

```caddy
  handle /lk-auth/* {
    uri strip_prefix /lk-auth
    reverse_proxy livekit-auth:8088
  }
```

- [ ] **Step 3: Modify `server/scripts/setup.sh` to build the auth service image**

After the existing template-rendering section, add:

```bash
# Build the bundled livekit-auth image so podman/docker compose can use it
echo "→ Building livekit-auth image"
docker compose --file compose.yml build livekit-auth 2>&1 | tail -3 || \
  podman compose --file compose.yml build livekit-auth 2>&1 | tail -3
```

- [ ] **Step 4: Build the auth image manually + smoke test**

```bash
cd /home/shreen/code/tactical-radio/server
cp .env.example .env
./scripts/generate-secrets.sh >/dev/null
sed -i 's|HAILFREQ_DOMAIN=radio.example.com|HAILFREQ_DOMAIN=localhost.test|' .env
sed -i 's|HAILFREQ_PUBLIC_IP=203.0.113.10|HAILFREQ_PUBLIC_IP=127.0.0.1|' .env
./scripts/setup.sh 2>&1 | tail -5

podman compose build livekit-auth 2>&1 | tail -5
# Expect: image built successfully

# Bring up just postgres + synapse + livekit-auth
podman compose up -d postgres synapse livekit-auth
sleep 20

# Probe health
podman compose exec livekit-auth wget -qO- http://localhost:8088/health 2>&1 | tail -3
# Expect: {"ok":true}

# Tear down
podman compose down -v
rm -f .env synapse/homeserver.yaml Caddyfile livekit/livekit.yaml coturn/turnserver.conf
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add server/compose.yml server/Caddyfile.template server/scripts/setup.sh
git commit -m "server: wire livekit-auth into compose + caddy reverse-proxy route"
```

---

## Task 4: Voice net data model

**Files:**
- Create: `client/src/renderer/matrix/nets.ts`

A "net" is identified by its Matrix room ID. Net properties live as Matrix state events. We expose a typed API for reading + writing these properties.

- [ ] **Step 1: Write `client/src/renderer/matrix/nets.ts`**

```ts
import type { MatrixClient, MatrixError } from "matrix-js-sdk";

export interface NetProperties {
  priority: number; // 0-100
  name: string;
  color: string; // CSS color or short identifier
}

export interface NetSummary {
  matrixRoomId: string;
  liveKitRoomName: string; // derived: the UUID localpart
  properties: NetProperties;
  memberCount: number;
  myPowerLevel: number;
}

const NET_PRIORITY_EVENT = "org.hailfreq.net.priority";
const NET_NAME_EVENT = "org.hailfreq.net.name";
const NET_COLOR_EVENT = "org.hailfreq.net.color";

/**
 * Derive the LiveKit room name from a Matrix room ID.
 * `!a1b2c3:server.com` → `a1b2c3`.
 */
export function liveKitRoomFromMatrixId(matrixRoomId: string): string {
  const colonIdx = matrixRoomId.indexOf(":");
  if (colonIdx <= 0) return matrixRoomId.substring(1);
  return matrixRoomId.substring(1, colonIdx);
}

/**
 * List all "voice net" rooms the client is a member of.
 * A room is considered a voice net if it has the `org.hailfreq.net.priority` state event.
 */
export function listNets(client: MatrixClient): NetSummary[] {
  const rooms = client.getRooms();
  const nets: NetSummary[] = [];
  for (const room of rooms) {
    const priorityEv = room.currentState.getStateEvents(NET_PRIORITY_EVENT, "");
    if (!priorityEv) continue;
    const nameEv = room.currentState.getStateEvents(NET_NAME_EVENT, "");
    const colorEv = room.currentState.getStateEvents(NET_COLOR_EVENT, "");
    const props: NetProperties = {
      priority: Number(priorityEv.getContent().value ?? 0),
      name: String(nameEv?.getContent().value ?? room.name ?? "Net"),
      color: String(colorEv?.getContent().value ?? "#22d3ee"),
    };
    nets.push({
      matrixRoomId: room.roomId,
      liveKitRoomName: liveKitRoomFromMatrixId(room.roomId),
      properties: props,
      memberCount: room.getJoinedMemberCount(),
      myPowerLevel: room.getMember(client.getSafeUserId())?.powerLevel ?? 0,
    });
  }
  // Sort by priority descending (highest priority first)
  nets.sort((a, b) => b.properties.priority - a.properties.priority);
  return nets;
}

/**
 * Create a new voice net (Matrix room with the required state events).
 * Caller must have permission on the parent space/server to create rooms.
 * Returns the new room ID.
 */
export async function createNet(
  client: MatrixClient,
  props: NetProperties,
): Promise<string> {
  const create = await client.createRoom({
    preset: "private_chat" as any,
    name: props.name,
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
      {
        type: NET_PRIORITY_EVENT,
        state_key: "",
        content: { value: props.priority },
      },
      {
        type: NET_NAME_EVENT,
        state_key: "",
        content: { value: props.name },
      },
      {
        type: NET_COLOR_EVENT,
        state_key: "",
        content: { value: props.color },
      },
    ],
  });
  return create.room_id;
}

/** Update one or more net properties. Caller must have PL 100 in the room. */
export async function updateNetProperties(
  client: MatrixClient,
  matrixRoomId: string,
  patch: Partial<NetProperties>,
): Promise<void> {
  if (patch.priority !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_PRIORITY_EVENT as any, { value: patch.priority }, "");
  }
  if (patch.name !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_NAME_EVENT as any, { value: patch.name }, "");
  }
  if (patch.color !== undefined) {
    await client.sendStateEvent(matrixRoomId, NET_COLOR_EVENT as any, { value: patch.color }, "");
  }
}

/** Subscribe to net membership/property changes; returns unsubscribe function. */
export function subscribeToNetsChanges(
  client: MatrixClient,
  onChange: () => void,
): () => void {
  const handler = () => onChange();
  client.on("Room" as any, handler);
  client.on("Room.name" as any, handler);
  client.on("RoomState.events" as any, handler);
  client.on("RoomMember.membership" as any, handler);
  return () => {
    client.off("Room" as any, handler);
    client.off("Room.name" as any, handler);
    client.off("RoomState.events" as any, handler);
    client.off("RoomMember.membership" as any, handler);
  };
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/nets.ts
git commit -m "client: voice net data model (Matrix state events + listing/creating)"
```

---

## Task 5: Add `livekit-client` dependency + auth helper

**Files:**
- Modify: `client/package.json` (add livekit-client)
- Create: `client/src/renderer/voice/auth.ts`

- [ ] **Step 1: Install livekit-client**

```bash
cd /home/shreen/code/tactical-radio/client
npm install livekit-client@^2.7.0
```

- [ ] **Step 2: Write `client/src/renderer/voice/auth.ts`**

```ts
/**
 * Fetch a LiveKit JWT from the Hailfreq livekit-auth service.
 * The auth service validates the Matrix access token + membership and returns
 * a JWT scoped to the LiveKit room name derived from the Matrix room ID.
 */

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

export async function fetchLiveKitToken(args: {
  hailfreqAuthBaseUrl: string;     // e.g., https://radio.guild.com/lk-auth
  matrixAccessToken: string;
  matrixRoomId: string;
}): Promise<LiveKitTokenResponse> {
  const resp = await fetch(`${args.hailfreqAuthBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matrixAccessToken: args.matrixAccessToken,
      matrixRoomId: args.matrixRoomId,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`livekit-auth token request failed: ${resp.status} ${body}`);
  }
  return (await resp.json()) as LiveKitTokenResponse;
}

/** Derive the auth base URL from the Synapse homeserver URL. */
export function authBaseUrlFromHomeserver(homeserverUrl: string): string {
  return homeserverUrl.replace(/\/+$/, "") + "/lk-auth";
}
```

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/package.json client/package-lock.json client/src/renderer/voice/auth.ts
git commit -m "client: add livekit-client + auth helper for fetching LiveKit JWT"
```

---

## Task 6: NetConnection — single LiveKit room wrapper

**Files:**
- Create: `client/src/renderer/voice/NetConnection.ts`

A `NetConnection` is one LiveKit Room subscription. It handles connecting, subscribing to audio tracks, exposing track refs for the audio mixer, and disconnecting cleanly.

- [ ] **Step 1: Write `client/src/renderer/voice/NetConnection.ts`**

```ts
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  type RemoteAudioTrack,
} from "livekit-client";

export interface NetConnectionEvents {
  trackSubscribed: (track: RemoteAudioTrack, participant: RemoteParticipant) => void;
  trackUnsubscribed: (track: RemoteAudioTrack, participant: RemoteParticipant) => void;
  activeSpeakersChanged: (participantIdentities: string[]) => void;
  connectionStateChanged: (state: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
}

/**
 * Single-room LiveKit connection. Caller wires `on()` callbacks before `connect()`.
 */
export class NetConnection {
  private readonly room: Room;
  private listeners: Partial<NetConnectionEvents> = {};

  constructor() {
    this.room = new Room({
      adaptiveStream: true,
      dynacast: false,
    });

    this.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        this.listeners.trackSubscribed?.(track as RemoteAudioTrack, participant);
      }
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        this.listeners.trackUnsubscribed?.(track as RemoteAudioTrack, participant);
      }
    });
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      this.listeners.activeSpeakersChanged?.(speakers.map((s) => s.identity));
    });
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      this.listeners.connectionStateChanged?.(state as any);
    });
  }

  on<E extends keyof NetConnectionEvents>(event: E, handler: NetConnectionEvents[E]): this {
    this.listeners[event] = handler;
    return this;
  }

  async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token);
  }

  /**
   * Begin publishing the local microphone track to this room.
   * Toggle this when the user PTTs into a net.
   */
  async startMicPublishing(track: MediaStreamTrack): Promise<void> {
    await this.room.localParticipant.publishTrack(track, {
      name: "microphone",
      source: Track.Source.Microphone,
      dtx: false,
      red: true,
    });
  }

  /** Stop publishing the local microphone. */
  async stopMicPublishing(): Promise<void> {
    const pubs = this.room.localParticipant.getTrackPublications();
    for (const pub of pubs) {
      if (pub.source === Track.Source.Microphone && pub.track) {
        await this.room.localParticipant.unpublishTrack(pub.track);
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
  }

  get connectionState() {
    return this.room.state;
  }

  /** The LiveKit Room instance (for advanced use, e.g., applying E2EE key). */
  get rawRoom(): Room {
    return this.room;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/NetConnection.ts
git commit -m "client: NetConnection — single LiveKit room wrapper with typed events"
```

---

## Task 7: VoiceEngine — multi-room subscription manager + audio mixer

**Files:**
- Create: `client/src/renderer/voice/VoiceEngine.ts`

The central piece. Manages a `Map<matrixRoomId, NetConnection>`. Wires every incoming audio track through a Web Audio API gain node (one per net), then routes to a single destination. Handles per-net volume, priority ducking, and mic-publishing-to-active-net.

- [ ] **Step 1: Write `client/src/renderer/voice/VoiceEngine.ts`**

```ts
import { NetConnection } from "./NetConnection";
import { fetchLiveKitToken, authBaseUrlFromHomeserver } from "./auth";
import type { MatrixClient } from "matrix-js-sdk";
import type { RemoteAudioTrack, RemoteParticipant } from "livekit-client";

interface NetState {
  matrixRoomId: string;
  liveKitRoomName: string;
  priority: number;
  connection: NetConnection;
  /** Per-net master gain (0.0–2.0+). User-controlled. */
  volumeGain: GainNode;
  /** Per-net duck gain (0.0–1.0). Auto-modulated by priority ducking. */
  duckGain: GainNode;
  /** Map participant identity → its source AudioNode (for cleanup on unsubscribe). */
  trackNodes: Map<string, MediaStreamAudioSourceNode>;
  /** Set of identities currently active-speaking. */
  activeSpeakers: Set<string>;
}

export interface VoiceEngineEvents {
  netStateChanged: (matrixRoomId: string, state: "connecting" | "connected" | "reconnecting" | "disconnected") => void;
  activeSpeakersChanged: (matrixRoomId: string, identities: string[]) => void;
}

const DUCK_ATTENUATION_DB = -35; // matches Star Comms default
const DUCK_HANGOVER_MS = 250;

export class VoiceEngine {
  private readonly client: MatrixClient;
  private readonly authBaseUrl: string;
  private readonly nets = new Map<string, NetState>();
  private audioCtx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private listeners: Partial<VoiceEngineEvents> = {};
  /** The Matrix room ID currently being PTT'd into, or null when not transmitting. */
  private activePttNet: string | null = null;
  /** The captured MediaStream (mic). Allocated lazily on first PTT. */
  private micStream: MediaStream | null = null;
  /** Hangover timer for priority ducking. */
  private duckHangoverTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(client: MatrixClient) {
    this.client = client;
    this.authBaseUrl = authBaseUrlFromHomeserver(client.getHomeserverUrl());
  }

  on<E extends keyof VoiceEngineEvents>(event: E, handler: VoiceEngineEvents[E]): this {
    this.listeners[event] = handler;
    return this;
  }

  /** Lazily initialize the AudioContext. Must be called from a user gesture (e.g., first net monitor) in some browsers. */
  ensureAudio(): void {
    if (this.audioCtx) return;
    this.audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    this.outputGain = this.audioCtx.createGain();
    this.outputGain.gain.value = 1.0;
    this.outputGain.connect(this.audioCtx.destination);
  }

  /** Subscribe to a net's voice. Connects to LiveKit + sets up audio routing. */
  async monitorNet(args: { matrixRoomId: string; priority: number }): Promise<void> {
    if (this.nets.has(args.matrixRoomId)) return;
    this.ensureAudio();

    const accessToken = this.client.getAccessToken();
    if (!accessToken) throw new Error("Matrix access token missing — cannot fetch LiveKit JWT");

    const { token, url } = await fetchLiveKitToken({
      hailfreqAuthBaseUrl: this.authBaseUrl,
      matrixAccessToken: accessToken,
      matrixRoomId: args.matrixRoomId,
    });

    const connection = new NetConnection();
    const liveKitRoomName = url.split("/").pop() || ""; // best-effort; not load-bearing
    const volumeGain = this.audioCtx!.createGain();
    volumeGain.gain.value = 1.0;
    const duckGain = this.audioCtx!.createGain();
    duckGain.gain.value = 1.0;
    volumeGain.connect(duckGain);
    duckGain.connect(this.outputGain!);

    const state: NetState = {
      matrixRoomId: args.matrixRoomId,
      liveKitRoomName,
      priority: args.priority,
      connection,
      volumeGain,
      duckGain,
      trackNodes: new Map(),
      activeSpeakers: new Set(),
    };

    connection
      .on("trackSubscribed", (track, participant) =>
        this.handleTrackSubscribed(state, track, participant),
      )
      .on("trackUnsubscribed", (track, participant) =>
        this.handleTrackUnsubscribed(state, track, participant),
      )
      .on("activeSpeakersChanged", (identities) =>
        this.handleActiveSpeakersChanged(state, identities),
      )
      .on("connectionStateChanged", (s) =>
        this.listeners.netStateChanged?.(args.matrixRoomId, s),
      );

    await connection.connect(url, token);
    this.nets.set(args.matrixRoomId, state);
  }

  /** Stop subscribing to a net. Tears down LiveKit + audio routing. */
  async unmonitorNet(matrixRoomId: string): Promise<void> {
    const state = this.nets.get(matrixRoomId);
    if (!state) return;
    await state.connection.disconnect();
    state.duckGain.disconnect();
    state.volumeGain.disconnect();
    for (const node of state.trackNodes.values()) {
      node.disconnect();
    }
    this.nets.delete(matrixRoomId);
    const timer = this.duckHangoverTimers.get(matrixRoomId);
    if (timer) clearTimeout(timer);
  }

  /** Update a net's user-controlled volume (0.0–2.0). */
  setNetVolume(matrixRoomId: string, volume: number): void {
    const state = this.nets.get(matrixRoomId);
    if (!state) return;
    state.volumeGain.gain.setTargetAtTime(volume, this.audioCtx!.currentTime, 0.05);
  }

  /** Push-to-talk: begin transmitting on the named net. */
  async startPtt(matrixRoomId: string): Promise<void> {
    if (this.activePttNet === matrixRoomId) return;
    if (this.activePttNet) await this.stopPtt();
    const state = this.nets.get(matrixRoomId);
    if (!state) throw new Error(`Cannot PTT — not monitoring net ${matrixRoomId}`);

    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    }
    const [micTrack] = this.micStream.getAudioTracks();
    await state.connection.startMicPublishing(micTrack.clone());
    this.activePttNet = matrixRoomId;
  }

  /** Release PTT — stop transmitting. */
  async stopPtt(): Promise<void> {
    if (!this.activePttNet) return;
    const state = this.nets.get(this.activePttNet);
    if (state) await state.connection.stopMicPublishing();
    this.activePttNet = null;
  }

  async shutdown(): Promise<void> {
    await this.stopPtt();
    for (const id of Array.from(this.nets.keys())) {
      await this.unmonitorNet(id);
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
      this.outputGain = null;
    }
    for (const t of this.duckHangoverTimers.values()) clearTimeout(t);
    this.duckHangoverTimers.clear();
  }

  // --- Internals ---

  private handleTrackSubscribed(state: NetState, track: RemoteAudioTrack, participant: RemoteParticipant): void {
    if (!this.audioCtx) return;
    const stream = new MediaStream([track.mediaStreamTrack]);
    const source = this.audioCtx.createMediaStreamSource(stream);
    source.connect(state.volumeGain);
    state.trackNodes.set(participant.identity, source);
  }

  private handleTrackUnsubscribed(state: NetState, _track: RemoteAudioTrack, participant: RemoteParticipant): void {
    const node = state.trackNodes.get(participant.identity);
    if (node) {
      node.disconnect();
      state.trackNodes.delete(participant.identity);
    }
  }

  private handleActiveSpeakersChanged(state: NetState, identities: string[]): void {
    state.activeSpeakers = new Set(identities);
    this.listeners.activeSpeakersChanged?.(state.matrixRoomId, identities);
    this.recomputeDucking();
  }

  /**
   * Priority ducking: if any net with higher priority has an active speaker,
   * attenuate ALL lower-priority nets by DUCK_ATTENUATION_DB. Use exponential
   * ramps for smooth audio.
   */
  private recomputeDucking(): void {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    // Find the highest priority with active speakers
    let maxActivePriority = -Infinity;
    for (const state of this.nets.values()) {
      if (state.activeSpeakers.size > 0 && state.priority > maxActivePriority) {
        maxActivePriority = state.priority;
      }
    }

    for (const state of this.nets.values()) {
      // Cancel any pending hangover timer for this net
      const pending = this.duckHangoverTimers.get(state.matrixRoomId);
      if (pending) {
        clearTimeout(pending);
        this.duckHangoverTimers.delete(state.matrixRoomId);
      }

      const shouldDuck = state.priority < maxActivePriority;
      if (shouldDuck) {
        // dB to linear: 10^(dB/20)
        const target = Math.pow(10, DUCK_ATTENUATION_DB / 20);
        state.duckGain.gain.setTargetAtTime(target, now, 0.04);
      } else {
        // Schedule un-duck with hangover delay
        const timer = setTimeout(() => {
          state.duckGain.gain.setTargetAtTime(1.0, this.audioCtx!.currentTime, 0.08);
          this.duckHangoverTimers.delete(state.matrixRoomId);
        }, DUCK_HANGOVER_MS);
        this.duckHangoverTimers.set(state.matrixRoomId, timer);
      }
    }
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/VoiceEngine.ts
git commit -m "client: VoiceEngine — multi-room subscribe + audio mixer + ducking"
```

---

## Task 8: PTT keybind capture UI

**Files:**
- Create: `client/src/renderer/components/KeybindCapture.tsx`
- Create: `client/src/renderer/voice/keybinds.ts`

A `KeybindCapture` component captures a single key (or accelerator like `CmdOrCtrl+F13`) when the user clicks it. The captured accelerator is stored per-net in settings.

- [ ] **Step 1: Write `client/src/renderer/voice/keybinds.ts`**

```ts
/**
 * Normalize a KeyboardEvent into an Electron-compatible accelerator string.
 * https://www.electronjs.org/docs/latest/api/accelerator
 *
 * Examples:
 *   "F13"
 *   "Control+Shift+P"
 *   "Alt+Numpad0"
 */
export function eventToAccelerator(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  let main = event.code;
  // Map a few common DOM codes to accelerator names
  if (main.startsWith("Key") && main.length === 4) main = main.slice(3);
  if (main.startsWith("Digit") && main.length === 6) main = main.slice(5);
  if (main.startsWith("Numpad")) main = main.replace(/^Numpad/, "num");

  // Filter modifier-only events
  if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(main)) {
    return null;
  }

  parts.push(main);
  return parts.join("+");
}

export function formatAccelerator(accel: string): string {
  return accel;
}
```

- [ ] **Step 2: Write `client/src/renderer/components/KeybindCapture.tsx`**

```tsx
import { useEffect, useState } from "react";
import { eventToAccelerator, formatAccelerator } from "../voice/keybinds";

interface KeybindCaptureProps {
  value: string;
  onChange: (accelerator: string) => void;
  onClear?: () => void;
}

export function KeybindCapture({ value, onChange, onClear }: KeybindCaptureProps) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const accel = eventToAccelerator(e);
      if (!accel) return;
      onChange(accel);
      setCapturing(false);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [capturing, onChange]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCapturing((c) => !c)}
        className={`rounded border px-3 py-1 text-xs font-mono ${
          capturing
            ? "border-brand-400 bg-brand-500/20 text-brand-50"
            : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
        }`}
      >
        {capturing ? "Press a key…" : value ? formatAccelerator(value) : "Click to set"}
      </button>
      {value && onClear && !capturing && (
        <button
          onClick={onClear}
          className="text-xs text-slate-500 hover:text-rose-400"
          title="Clear keybind"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/KeybindCapture.tsx client/src/renderer/voice/keybinds.ts
git commit -m "client: KeybindCapture component + accelerator normalization helpers"
```

---

## Task 9: Global hotkey registration via Electron

**Files:**
- Create: `client/src/main/globalHotkeys.ts`
- Modify: `client/src/shared/ipc.ts` (add hotkey channels)
- Modify: `client/src/main/ipc.ts` (register handlers)

Electron's `globalShortcut` API works system-wide on Windows and Linux. The main process maintains a registry of `accelerator → opaque hotkey ID` mappings; the renderer listens for `hotkey:pressed` / `hotkey:released` events to know when a registered key fires.

- [ ] **Step 1: Write `client/src/main/globalHotkeys.ts`**

```ts
import { globalShortcut, BrowserWindow, app } from "electron";
import crypto from "node:crypto";

interface HotkeyRegistration {
  id: string;
  accelerator: string;
  /** Logical net identifier (the renderer chooses; we just round-trip it). */
  metadata: unknown;
}

const registry = new Map<string, HotkeyRegistration>();

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export function registerHotkey(accelerator: string, metadata: unknown): { id: string } | { error: string } {
  // Check if already registered with the same accelerator
  for (const existing of registry.values()) {
    if (existing.accelerator === accelerator) {
      return { error: `accelerator ${accelerator} already registered` };
    }
  }
  const id = crypto.randomUUID();
  const ok = globalShortcut.register(accelerator, () => {
    broadcast("hotkey:pressed", { id, accelerator });
    // Electron has no native "release" event; we synthesize it on the next tick.
    // For PTT we rely on the renderer wrapping start/stop around press.
    setImmediate(() => broadcast("hotkey:released", { id, accelerator }));
  });
  if (!ok) {
    return { error: `failed to register accelerator ${accelerator} (in use by another app?)` };
  }
  registry.set(id, { id, accelerator, metadata });
  return { id };
}

export function unregisterHotkey(id: string): void {
  const reg = registry.get(id);
  if (!reg) return;
  globalShortcut.unregister(reg.accelerator);
  registry.delete(id);
}

export function unregisterAllHotkeys(): void {
  for (const reg of registry.values()) {
    globalShortcut.unregister(reg.accelerator);
  }
  registry.clear();
}

export function listHotkeys(): HotkeyRegistration[] {
  return Array.from(registry.values());
}

// Clean up on app quit
app.on("will-quit", () => {
  unregisterAllHotkeys();
});
```

- [ ] **Step 2: Add IPC channels in `client/src/shared/ipc.ts`**

```ts
"hotkeys:register": {
  args: [{ accelerator: string; metadata: unknown }];
  result: { id: string } | { error: string };
};
"hotkeys:unregister": { args: [{ id: string }]; result: void };
"hotkeys:list": { args: []; result: Array<{ id: string; accelerator: string; metadata: unknown }> };
```

Also add the renderer-bound events to the preload's exposed API (the IPC bridge needs to expose `ipcRenderer.on("hotkey:pressed", ...)` and `hotkey:released`). Extend `src/preload/index.ts`:

```ts
// in preload/index.ts, alongside the existing `invoke` exposure:
const api = {
  invoke: <K extends IpcChannelName>(
    channel: K,
    ...args: IpcChannels[K]["args"]
  ): Promise<IpcChannels[K]["result"]> => ipcRenderer.invoke(channel, ...args),
  onHotkey: (cb: (e: { id: string; accelerator: string }) => void) => {
    const pressedHandler = (_event: unknown, payload: { id: string; accelerator: string }) => cb(payload);
    ipcRenderer.on("hotkey:pressed", pressedHandler);
    return () => ipcRenderer.off("hotkey:pressed", pressedHandler);
  },
  // No released handler — the renderer uses keyup detection for release if needed,
  // OR treats every press as a brief "tap" that toggles PTT on/off.
  // For Plan 4 v1 we use the "tap to toggle" model (see Task 11).
};
```

- [ ] **Step 3: Register handlers in `client/src/main/ipc.ts`**

```ts
import { registerHotkey, unregisterHotkey, listHotkeys } from "./globalHotkeys";

// inside registerIpcHandlers:
ipcMain.handle("hotkeys:register", (_event, args: { accelerator: string; metadata: unknown }) =>
  registerHotkey(args.accelerator, args.metadata),
);
ipcMain.handle("hotkeys:unregister", (_event, args: { id: string }) => unregisterHotkey(args.id));
ipcMain.handle("hotkeys:list", () => listHotkeys());
```

- [ ] **Step 4: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/main/globalHotkeys.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/preload/index.ts
git commit -m "client: global hotkey registration via Electron globalShortcut"
```

---

## Task 10: PTT state machine — multi-mode dispatcher (tap-to-toggle path)

**Files:**
- Create: `client/src/renderer/voice/PttController.ts`

The PttController routes PTT events from THREE possible sources to the VoiceEngine:

1. **Tap-to-toggle** (this task) — Electron `globalShortcut` fires once per key press; we toggle transmission.
2. **Press-and-hold** (Task 10B) — native key listener gives us keydown + keyup separately.
3. **Voice activation** (Task 10C) — mic level above threshold triggers start; below threshold + hangover triggers stop.

The PttController is the central dispatcher. It maintains per-net binding state and dispatches incoming events from whichever mode is configured for that net. This task implements the controller skeleton + tap-to-toggle path; subsequent tasks wire the other two modes into the same dispatcher.

- [ ] **Step 1: Write `client/src/renderer/voice/PttController.ts`**

```ts
import type { VoiceEngine } from "./VoiceEngine";

export type PttMode = "toggle" | "hold" | "voice";

interface PttBinding {
  matrixRoomId: string;
  mode: PttMode;
  /** For "toggle" and "hold" modes — the keybind accelerator. */
  accelerator?: string;
  /** For "toggle" and "hold" modes — the registered hotkey ID. */
  hotkeyId?: string;
  /** For "voice" mode — the threshold in dBFS (negative; -45 is typical sensitivity). */
  voiceThresholdDb?: number;
}

export class PttController {
  private readonly engine: VoiceEngine;
  private bindings = new Map<string, PttBinding>(); // matrixRoomId → binding
  private unsubscribeHotkeyListener: (() => void) | null = null;
  /** Currently transmitting net (single, since only one net at a time can be active). */
  private transmitting: string | null = null;

  constructor(engine: VoiceEngine) {
    this.engine = engine;
    this.unsubscribeHotkeyListener = window.hailfreq.onHotkey((event) => {
      const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
      if (!binding) return;
      // Tap-to-toggle is the only mode wired in this task.
      // Press-and-hold (Task 10B) and voice activation (Task 10C) extend this.
      if (binding.mode === "toggle") {
        void this.togglePtt(binding.matrixRoomId);
      }
    });
  }

  /** Bind a net's PTT mode. For toggle/hold, accelerator is required. */
  async bind(opts: {
    matrixRoomId: string;
    mode: PttMode;
    accelerator?: string;
    voiceThresholdDb?: number;
  }): Promise<{ ok: boolean; error?: string }> {
    await this.unbind(opts.matrixRoomId);

    if (opts.mode === "toggle" || opts.mode === "hold") {
      if (!opts.accelerator) {
        return { ok: false, error: `${opts.mode} mode requires a keybind` };
      }
      const result = await window.hailfreq.invoke("hotkeys:register", {
        accelerator: opts.accelerator,
        metadata: { matrixRoomId: opts.matrixRoomId, mode: opts.mode },
      });
      if ("error" in result) return { ok: false, error: result.error };
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: opts.mode,
        accelerator: opts.accelerator,
        hotkeyId: result.id,
      });
      return { ok: true };
    }

    if (opts.mode === "voice") {
      this.bindings.set(opts.matrixRoomId, {
        matrixRoomId: opts.matrixRoomId,
        mode: "voice",
        voiceThresholdDb: opts.voiceThresholdDb ?? -45,
      });
      // Task 10C wires the actual voice-activation analyzer
      return { ok: true };
    }

    return { ok: false, error: `Unknown mode: ${opts.mode}` };
  }

  async unbind(matrixRoomId: string): Promise<void> {
    const existing = this.bindings.get(matrixRoomId);
    if (!existing) return;
    if (existing.hotkeyId) {
      await window.hailfreq.invoke("hotkeys:unregister", { id: existing.hotkeyId });
    }
    this.bindings.delete(matrixRoomId);
    if (this.transmitting === matrixRoomId) {
      await this.engine.stopPtt();
      this.transmitting = null;
    }
  }

  private async togglePtt(matrixRoomId: string): Promise<void> {
    if (this.transmitting === matrixRoomId) {
      await this.engine.stopPtt();
      this.transmitting = null;
    } else {
      await this.engine.startPtt(matrixRoomId);
      this.transmitting = matrixRoomId;
    }
  }

  /** Called by press-and-hold (Task 10B) on keydown. */
  async holdStart(matrixRoomId: string): Promise<void> {
    if (this.transmitting === matrixRoomId) return;
    await this.engine.startPtt(matrixRoomId);
    this.transmitting = matrixRoomId;
  }

  /** Called by press-and-hold (Task 10B) on keyup, or by voice activation (Task 10C) when below threshold. */
  async holdStop(matrixRoomId: string): Promise<void> {
    if (this.transmitting !== matrixRoomId) return;
    await this.engine.stopPtt();
    this.transmitting = null;
  }

  getBinding(matrixRoomId: string): PttBinding | null {
    return this.bindings.get(matrixRoomId) ?? null;
  }

  getTransmittingNet(): string | null {
    return this.transmitting;
  }

  async shutdown(): Promise<void> {
    for (const binding of this.bindings.values()) {
      if (binding.hotkeyId) {
        await window.hailfreq.invoke("hotkeys:unregister", { id: binding.hotkeyId });
      }
    }
    this.bindings.clear();
    this.unsubscribeHotkeyListener?.();
    this.unsubscribeHotkeyListener = null;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/PttController.ts
git commit -m "client: PttController — multi-mode dispatcher with tap-to-toggle path"
```

---

## Task 10B: Press-and-hold PTT — native key listener

**Files:**
- Modify: `client/package.json` (add `node-global-key-listener`)
- Create: `client/src/main/nativeKeyListener.ts`
- Modify: `client/src/shared/ipc.ts` (add `nativeHotkey:registerHold` channels + `nativeHotkey:down/up` events)
- Modify: `client/src/main/ipc.ts` (handlers)
- Modify: `client/src/preload/index.ts` (expose onNativeHotkey)
- Modify: `client/src/renderer/voice/PttController.ts` (wire press-and-hold path)

True press-and-hold requires keyup detection, which Electron's `globalShortcut` does not provide. We use `node-global-key-listener` — a native NAPI module that hooks system-wide keyboard events on Windows + macOS + Linux X11.

**Wayland caveat:** on Wayland-based Linux desktops (default on Fedora/Ubuntu 22.10+ GNOME, KDE Plasma 5.27+, etc.), system-wide keyboard hooks are blocked by the compositor security model. Press-and-hold mode will fail to start on Wayland; users get an error message and are advised to switch to tap-to-toggle or voice activation.

- [ ] **Step 1: Install the dependency**

```bash
cd /home/shreen/code/tactical-radio/client
npm install node-global-key-listener@^0.3.0
```

(Verify the package exists and installs cleanly. If it pulls a native binding that fails to build, document the error and consider alternative: `uiohook-napi`.)

- [ ] **Step 2: Detect Wayland in `client/src/main/nativeKeyListener.ts`**

```ts
import { GlobalKeyboardListener } from "node-global-key-listener";
import { BrowserWindow } from "electron";
import crypto from "node:crypto";

interface HoldRegistration {
  id: string;
  /** The Electron-style accelerator (e.g., "F13", "Control+Shift+P"). */
  accelerator: string;
  /** Native-key matcher derived from the accelerator. */
  matchKey: string;
  matchModifiers: string[];
  metadata: unknown;
}

const registry = new Map<string, HoldRegistration>();
let listener: GlobalKeyboardListener | null = null;
let listenerActive = false;

function isWayland(): boolean {
  return (
    process.platform === "linux" &&
    (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY)
  );
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function ensureListener(): Promise<boolean> {
  if (listenerActive) return true;
  if (isWayland()) return false; // Wayland blocks global key hooks
  try {
    listener = new GlobalKeyboardListener();
    listener.addListener((event, down) => {
      // event.name is the key name (e.g., "F13", "A", "LEFT CTRL"); event.state is "DOWN" or "UP"
      // event.rawKey provides modifier state details across platforms
      const eventModifiers = new Set<string>();
      if (down["LEFT CTRL"] || down["RIGHT CTRL"]) eventModifiers.add("Control");
      if (down["LEFT ALT"] || down["RIGHT ALT"]) eventModifiers.add("Alt");
      if (down["LEFT SHIFT"] || down["RIGHT SHIFT"]) eventModifiers.add("Shift");
      if (down["LEFT META"] || down["RIGHT META"]) eventModifiers.add("Super");

      for (const reg of registry.values()) {
        if (event.name !== reg.matchKey) continue;
        const allMatch = reg.matchModifiers.every((m) => eventModifiers.has(m));
        const noExtras = eventModifiers.size === reg.matchModifiers.length;
        if (!allMatch || !noExtras) continue;
        if (event.state === "DOWN") {
          broadcast("nativeHotkey:down", { id: reg.id, accelerator: reg.accelerator });
        } else if (event.state === "UP") {
          broadcast("nativeHotkey:up", { id: reg.id, accelerator: reg.accelerator });
        }
      }
    });
    listenerActive = true;
    return true;
  } catch (err) {
    console.error("Failed to start native key listener:", err);
    return false;
  }
}

function acceleratorToMatcher(accelerator: string): { key: string; modifiers: string[] } {
  const parts = accelerator.split("+");
  const modifiers: string[] = [];
  let key = "";
  for (const p of parts) {
    if (p === "Control" || p === "Alt" || p === "Shift" || p === "Super") {
      modifiers.push(p);
    } else {
      key = p.toUpperCase(); // node-global-key-listener uses uppercase
    }
  }
  return { key, modifiers };
}

export async function registerHold(accelerator: string, metadata: unknown): Promise<{ id: string } | { error: string }> {
  const started = await ensureListener();
  if (!started) {
    return { error: "Press-and-hold not supported on this platform (Wayland blocks global key hooks). Use tap-to-toggle or voice activation." };
  }
  const { key, modifiers } = acceleratorToMatcher(accelerator);
  if (!key) return { error: `Invalid accelerator: ${accelerator}` };
  const id = crypto.randomUUID();
  registry.set(id, { id, accelerator, matchKey: key, matchModifiers: modifiers, metadata });
  return { id };
}

export function unregisterHold(id: string): void {
  registry.delete(id);
  // Tear down listener if no remaining registrations
  if (registry.size === 0 && listener && listenerActive) {
    listener.kill();
    listener = null;
    listenerActive = false;
  }
}

export function unregisterAllHolds(): void {
  registry.clear();
  if (listener && listenerActive) {
    listener.kill();
    listener = null;
    listenerActive = false;
  }
}
```

- [ ] **Step 3: Extend `client/src/shared/ipc.ts`**

```ts
"nativeHotkey:registerHold": { args: [{ accelerator: string; metadata: unknown }]; result: { id: string } | { error: string } };
"nativeHotkey:unregisterHold": { args: [{ id: string }]; result: void };
```

- [ ] **Step 4: Register handlers in `client/src/main/ipc.ts`**

```ts
import { registerHold, unregisterHold, unregisterAllHolds } from "./nativeKeyListener";

ipcMain.handle("nativeHotkey:registerHold", (_e, args) => registerHold(args.accelerator, args.metadata));
ipcMain.handle("nativeHotkey:unregisterHold", (_e, args) => unregisterHold(args.id));

// In main/index.ts, on app.on("will-quit"), call unregisterAllHolds() alongside unregisterAllHotkeys().
```

- [ ] **Step 5: Expose `onNativeHotkey` in `client/src/preload/index.ts`**

```ts
onNativeHotkey: (cb: (e: { id: string; accelerator: string; direction: "down" | "up" }) => void) => {
  const downHandler = (_e: unknown, p: { id: string; accelerator: string }) => cb({ ...p, direction: "down" });
  const upHandler = (_e: unknown, p: { id: string; accelerator: string }) => cb({ ...p, direction: "up" });
  ipcRenderer.on("nativeHotkey:down", downHandler);
  ipcRenderer.on("nativeHotkey:up", upHandler);
  return () => {
    ipcRenderer.off("nativeHotkey:down", downHandler);
    ipcRenderer.off("nativeHotkey:up", upHandler);
  };
},
```

- [ ] **Step 6: Wire press-and-hold path in PttController**

Modify the PttController constructor to also subscribe to `onNativeHotkey`:

```ts
this.unsubscribeNativeListener = window.hailfreq.onNativeHotkey((event) => {
  const binding = Array.from(this.bindings.values()).find((b) => b.hotkeyId === event.id);
  if (!binding || binding.mode !== "hold") return;
  if (event.direction === "down") void this.holdStart(binding.matrixRoomId);
  else void this.holdStop(binding.matrixRoomId);
});
```

Modify the `bind` method's "hold" branch to call `nativeHotkey:registerHold` instead of `hotkeys:register`:

```ts
if (opts.mode === "hold") {
  if (!opts.accelerator) return { ok: false, error: "hold mode requires a keybind" };
  const result = await window.hailfreq.invoke("nativeHotkey:registerHold", {
    accelerator: opts.accelerator,
    metadata: { matrixRoomId: opts.matrixRoomId },
  });
  if ("error" in result) return { ok: false, error: result.error };
  this.bindings.set(opts.matrixRoomId, {
    matrixRoomId: opts.matrixRoomId,
    mode: "hold",
    accelerator: opts.accelerator,
    hotkeyId: result.id,
  });
  return { ok: true };
}
```

And the `unbind` method, plus `shutdown`, need to call `nativeHotkey:unregisterHold` for hold-mode bindings.

- [ ] **Step 7: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -10
# If node-global-key-listener fails to build natively, document the failure and continue without press-and-hold support (still ship tap-to-toggle + voice activation).
```

- [ ] **Step 8: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/package.json client/package-lock.json client/src/main/nativeKeyListener.ts client/src/main/ipc.ts client/src/shared/ipc.ts client/src/preload/index.ts client/src/renderer/voice/PttController.ts client/src/main/index.ts
git commit -m "client: press-and-hold PTT via node-global-key-listener (X11/Win/macOS)"
```

---

## Task 10C: Voice activation mode — mic level analyzer

**Files:**
- Create: `client/src/renderer/voice/voiceActivation.ts`
- Modify: `client/src/renderer/voice/VoiceEngine.ts` (expose mic stream for analysis)
- Modify: `client/src/renderer/voice/PttController.ts` (wire voice-activation path)

Voice activation uses a Web Audio `AnalyserNode` on the mic stream. When RMS level exceeds the threshold for the configured pre-trigger window (~30ms), start transmitting. When level falls below threshold for the hangover window (~400ms default), stop.

- [ ] **Step 1: Write `client/src/renderer/voice/voiceActivation.ts`**

```ts
export interface VoiceActivationConfig {
  audioCtx: AudioContext;
  micSource: MediaStreamAudioSourceNode;
  /** Threshold in dBFS (negative). Typical: -45. Higher (less negative) = less sensitive. */
  thresholdDb: number;
  /** Frames above threshold required to trigger start (~30ms at 60fps polling). */
  triggerFrames?: number;
  /** Hangover delay in ms before stop. */
  hangoverMs?: number;
  /** Called when audio crosses threshold and stays above. */
  onStart: () => void;
  /** Called after hangover when audio falls below threshold. */
  onStop: () => void;
}

export class VoiceActivationDetector {
  private analyser: AnalyserNode;
  private buffer: Uint8Array;
  private triggered = false;
  private framesAboveThreshold = 0;
  private hangoverTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private readonly thresholdLinear: number;
  private readonly triggerFrames: number;
  private readonly hangoverMs: number;
  private readonly onStart: () => void;
  private readonly onStop: () => void;
  private stopped = false;

  constructor(cfg: VoiceActivationConfig) {
    this.analyser = cfg.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buffer = new Uint8Array(this.analyser.fftSize);
    cfg.micSource.connect(this.analyser);

    this.thresholdLinear = Math.pow(10, cfg.thresholdDb / 20);
    this.triggerFrames = cfg.triggerFrames ?? 2;
    this.hangoverMs = cfg.hangoverMs ?? 400;
    this.onStart = cfg.onStart;
    this.onStop = cfg.onStop;
  }

  start(): void {
    this.stopped = false;
    const tick = () => {
      if (this.stopped) return;
      this.analyser.getByteTimeDomainData(this.buffer);
      const rms = computeRms(this.buffer);
      if (rms > this.thresholdLinear) {
        this.framesAboveThreshold++;
        if (this.framesAboveThreshold >= this.triggerFrames && !this.triggered) {
          this.triggered = true;
          if (this.hangoverTimer) {
            clearTimeout(this.hangoverTimer);
            this.hangoverTimer = null;
          }
          this.onStart();
        }
      } else {
        this.framesAboveThreshold = 0;
        if (this.triggered && !this.hangoverTimer) {
          this.hangoverTimer = setTimeout(() => {
            this.triggered = false;
            this.hangoverTimer = null;
            this.onStop();
          }, this.hangoverMs);
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.stopped = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.hangoverTimer) {
      clearTimeout(this.hangoverTimer);
      this.hangoverTimer = null;
    }
    if (this.triggered) {
      this.triggered = false;
      this.onStop();
    }
    this.analyser.disconnect();
  }
}

/** Compute RMS of an 8-bit unsigned time-domain buffer (128 = silence). */
function computeRms(buffer: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}
```

- [ ] **Step 2: Expose mic source on VoiceEngine**

The VoiceEngine already allocates the mic stream on first PTT. For voice activation we need to allocate it earlier and expose an AudioContext-attached source node. Modify `VoiceEngine.ts`:

```ts
/** Allocate the mic + return an audio source for analysis. Safe to call multiple times. */
async getMicSource(): Promise<MediaStreamAudioSourceNode> {
  this.ensureAudio();
  if (!this.micStream) {
    this.micStream = await navigator.mediaDevices.getUserMedia({ /* ... existing constraints ... */ });
  }
  if (!this.micSourceNode) {
    this.micSourceNode = this.audioCtx!.createMediaStreamSource(this.micStream);
  }
  return this.micSourceNode;
}
```

Add a `micSourceNode: MediaStreamAudioSourceNode | null = null;` field.

- [ ] **Step 3: Wire voice activation in PttController**

```ts
// In the bind() method, "voice" branch:
if (opts.mode === "voice") {
  const micSource = await this.engine.getMicSource();
  const detector = new VoiceActivationDetector({
    audioCtx: micSource.context as AudioContext,
    micSource,
    thresholdDb: opts.voiceThresholdDb ?? -45,
    onStart: () => void this.holdStart(opts.matrixRoomId),
    onStop: () => void this.holdStop(opts.matrixRoomId),
  });
  detector.start();
  this.bindings.set(opts.matrixRoomId, {
    matrixRoomId: opts.matrixRoomId,
    mode: "voice",
    voiceThresholdDb: opts.voiceThresholdDb ?? -45,
  });
  this.voiceDetectors.set(opts.matrixRoomId, detector);
  return { ok: true };
}
```

Add a `voiceDetectors = new Map<string, VoiceActivationDetector>();` field. Stop + delete the detector on `unbind()`.

- [ ] **Step 4: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/voiceActivation.ts client/src/renderer/voice/VoiceEngine.ts client/src/renderer/voice/PttController.ts
git commit -m "client: voice activation mode (RMS analyzer + hangover-based PTT)"
```

---

## Task 11: SFrame E2EE — key generation and Matrix-side storage

**Files:**
- Create: `client/src/renderer/voice/sfameKeys.ts`

For v1 of Plan 4, each net has a single SFrame key generated at net creation and stored as a Matrix state event of type `org.hailfreq.net.sframe-key` (encrypted via Megolm because the room is encrypted). Members of the room can read the state event and extract the key.

**Server-level bans work correctly out of the box.** A banned user has had their Synapse account deactivated by an admin:
- Their access token is invalidated by Synapse immediately
- They cannot obtain a new LiveKit JWT (the auth service's whoami check fails)
- They cannot connect to LiveKit at all (no valid JWT)
- They cannot read new Matrix events (no valid session)
A banned user is fully cut off the instant the admin runs the ban action. The static SFrame key has zero relevance — the banned user can't reach any system that uses it.

**The static-key compromise applies only to net-level kicks (Matrix room membership change), and only for forward secrecy.** When an admin kicks a member from a specific net's Matrix room:
- The kicked member's LiveKit JWT for that room expires within ~6 hours (token TTL)
- After expiry they cannot rejoin LiveKit (auth service sees they're no longer a room member)
- BUT: if they captured ciphertext while they were a legitimate member, they can still decrypt that historical traffic with the cached key
- AND: until their JWT expires, they could in theory still send/receive on that LiveKit room

**Active key rotation on net-level kicks is implemented in Task 11B.** When an admin kicks a member, the remaining members generate a fresh SFrame key, upload it as an encrypted timeline event, and rotate LiveKit's keyProvider. The kicked member's cached key becomes useless for any traffic after the rotation. Combined with server-level ban for adversarial removals, this closes the forward-secrecy gap that would otherwise exist with static keys.

- [ ] **Step 1: Write `client/src/renderer/voice/sframeKeys.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";

const SFRAME_KEY_EVENT = "org.hailfreq.net.sframe-key";

/**
 * Generate a fresh 32-byte SFrame key.
 */
export function generateSframeKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Store an SFrame key as a state event in the Matrix room. The room is already
 * E2EE-encrypted (m.room.encryption = megolm), so the state event content is
 * automatically encrypted by Synapse via Megolm.
 *
 * WARNING: Matrix state events on encrypted rooms are NOT automatically
 * encrypted — only timeline events are. We work around this by sending a
 * regular timeline message with a designated content type instead. The
 * implementer should verify this against the Matrix spec at impl time:
 * https://spec.matrix.org/v1.11/client-server-api/#end-to-end-encryption
 */
export async function uploadSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
  keyBytes: Uint8Array,
): Promise<void> {
  const keyBase64 = base64Encode(keyBytes);
  // Send as a timeline event (encrypted by Megolm) rather than state event
  // (which is NOT encrypted on Matrix even in E2EE rooms).
  await client.sendEvent(matrixRoomId, SFRAME_KEY_EVENT as any, {
    key: keyBase64,
    algorithm: "AES-GCM-128",
    issued_at: Date.now(),
  });
}

/**
 * Retrieve the most recent SFrame key from a Matrix room.
 * Scans the timeline backwards for the latest org.hailfreq.net.sframe-key event.
 * Returns null if not found (e.g., net wasn't created with key embedding).
 */
export async function fetchSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<Uint8Array | null> {
  const room = client.getRoom(matrixRoomId);
  if (!room) return null;

  // Walk the timeline from newest to oldest, looking for the key event
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.getType() !== SFRAME_KEY_EVENT) continue;
    // Wait for decryption if encrypted
    if (ev.isBeingDecrypted()) {
      // Listen for completion (simplified — production should subscribe properly)
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    const content = ev.getContent();
    if (typeof content.key !== "string") continue;
    return base64Decode(content.key);
  }
  return null;
}

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
```

**Implementer note:** the Matrix spec is correct that state events in E2EE rooms are NOT automatically encrypted — only timeline events are. The plan correctly uses `sendEvent` (timeline) instead of `sendStateEvent`. Verify against the installed matrix-js-sdk's behavior at implementation time; if your installed Synapse encrypts state events in some configuration (it doesn't by default), the code can be revised.

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/sframeKeys.ts
git commit -m "client: SFrame key generation + Matrix-encrypted-timeline storage"
```

---

## Task 11B: Active SFrame key rotation on net-level kicks

**Files:**
- Modify: `client/src/renderer/voice/sframeKeys.ts` (add key-index awareness + rotation helper)
- Create: `client/src/renderer/voice/keyRotationCoordinator.ts`
- Modify: `client/src/renderer/voice/VoiceEngine.ts` (wire rotation per net)

When an admin kicks (or bans) a member from a net's Matrix room, the remaining members generate a fresh SFrame key and rotate it into LiveKit. The kicked member's cached key becomes useless for any traffic after the rotation. This closes the forward-secrecy gap from Task 11's static-key v1 model.

### Design

- **Rotation trigger:** any `RoomMember.membership` event where `prev_content.membership === "join"` and new `content.membership === "leave"` OR `"ban"`, AND `sender !== state_key` (i.e., kicked/banned by someone else, not voluntary leave).
- **Coordinator selection:** every online member with PL ≥ 50 (speak permission) attempts to upload a new key. Matrix's timeline ordering decides which wins; benign race. No explicit lock needed.
- **Key index:** count the existing `org.hailfreq.net.sframe-key` timeline events; new key gets `(count) % 16`. LiveKit's `ExternalE2EEKeyProvider.setKey(key, keyIndex)` accepts a 4-bit index. Senders use the new index for outgoing frames; receivers try the new index first, fall back to older indexes for in-flight frames (LiveKit handles this internally).
- **Consume side:** all members listen for new `org.hailfreq.net.sframe-key` events on the timeline. On receipt, extract bytes + compute index, call `setKey()` on the LiveKit room's keyProvider.
- **Offline members:** catch up on next sync. During the offline window they have the previous key cached and can still receive older traffic.

### Files

- [ ] **Step 1: Extend `client/src/renderer/voice/sframeKeys.ts`**

Add helpers for retrieving key history and rotating:

```ts
/**
 * Return all SFrame keys ever published in this room, ordered oldest → newest.
 * Each entry is { keyIndex, keyBytes, eventId }. keyIndex is `index % 16`.
 */
export async function listSframeKeys(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<Array<{ keyIndex: number; keyBytes: Uint8Array; eventId: string; ts: number }>> {
  const room = client.getRoom(matrixRoomId);
  if (!room) return [];
  const out: Array<{ keyIndex: number; keyBytes: Uint8Array; eventId: string; ts: number }> = [];
  const events = room.getLiveTimeline().getEvents();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.getType() !== SFRAME_KEY_EVENT) continue;
    if (ev.isBeingDecrypted()) await new Promise<void>((r) => setTimeout(r, 50));
    const content = ev.getContent();
    if (typeof content.key !== "string") continue;
    out.push({
      keyIndex: out.length % 16,
      keyBytes: base64Decode(content.key),
      eventId: ev.getId() || "",
      ts: ev.getTs(),
    });
  }
  return out;
}

/** Upload a fresh key as a rotation. Returns the new key bytes + assigned index. */
export async function rotateSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<{ keyBytes: Uint8Array; keyIndex: number }> {
  const existing = await listSframeKeys(client, matrixRoomId);
  const keyBytes = generateSframeKey();
  await uploadSframeKey(client, matrixRoomId, keyBytes);
  return { keyBytes, keyIndex: existing.length % 16 };
}
```

- [ ] **Step 2: Write `client/src/renderer/voice/keyRotationCoordinator.ts`**

```ts
import type { MatrixClient, MatrixEvent, RoomMember } from "matrix-js-sdk";
import { rotateSframeKey, listSframeKeys } from "./sframeKeys";

interface RotationHandle {
  unsubscribe(): void;
}

interface CoordinatorEvents {
  /** Called whenever a new SFrame key is observed (own rotation OR remote rotation). */
  onNewKey: (matrixRoomId: string, keyBytes: Uint8Array, keyIndex: number) => void;
}

/**
 * Listen for kicks/bans on every voice-net Matrix room and trigger rotation.
 * Also propagates remote rotation events to the caller for LiveKit key updates.
 */
export function startKeyRotationCoordinator(
  client: MatrixClient,
  netMatrixRoomIds: () => Set<string>,
  events: CoordinatorEvents,
): RotationHandle {
  const handler = async (event: MatrixEvent, member: RoomMember) => {
    if (event.getType() !== "m.room.member") return;
    const roomId = event.getRoomId();
    if (!roomId || !netMatrixRoomIds().has(roomId)) return;

    const prev = event.getPrevContent()?.membership;
    const next = event.getContent()?.membership;
    const sender = event.getSender();
    const target = event.getStateKey();

    // Detect kick or ban (forced removal by someone else)
    if (prev === "join" && (next === "leave" || next === "ban") && sender && target && sender !== target) {
      const room = client.getRoom(roomId);
      if (!room) return;
      const myPl = room.getMember(client.getSafeUserId())?.powerLevel ?? 0;
      if (myPl < 50) return; // only speakers participate in rotation

      try {
        const { keyBytes, keyIndex } = await rotateSframeKey(client, roomId);
        events.onNewKey(roomId, keyBytes, keyIndex);
      } catch (err) {
        console.error(`Key rotation failed for ${roomId}:`, err);
      }
    }
  };

  client.on("RoomMember.membership" as any, handler);

  // Also listen for incoming key events from other members (remote rotations)
  const timelineHandler = async (event: MatrixEvent) => {
    if (event.getType() !== "org.hailfreq.net.sframe-key") return;
    const roomId = event.getRoomId();
    if (!roomId || !netMatrixRoomIds().has(roomId)) return;
    if (event.getSender() === client.getSafeUserId()) return; // own event, already applied
    if (event.isBeingDecrypted()) await new Promise<void>((r) => setTimeout(r, 100));
    const all = await listSframeKeys(client, roomId);
    const latest = all[all.length - 1];
    if (!latest) return;
    events.onNewKey(roomId, latest.keyBytes, latest.keyIndex);
  };
  client.on("Room.timeline" as any, timelineHandler);

  return {
    unsubscribe() {
      client.off("RoomMember.membership" as any, handler);
      client.off("Room.timeline" as any, timelineHandler);
    },
  };
}
```

- [ ] **Step 3: Wire into `VoiceEngine`**

```ts
import { ExternalE2EEKeyProvider } from "livekit-client";
import { startKeyRotationCoordinator } from "./keyRotationCoordinator";

// In the VoiceEngine constructor:
this.rotationHandle = startKeyRotationCoordinator(
  this.client,
  () => new Set(this.nets.keys()),
  {
    onNewKey: (roomId, keyBytes, keyIndex) => {
      const state = this.nets.get(roomId);
      if (!state) return;
      const provider = state.connection.rawRoom.options.e2ee?.keyProvider;
      if (provider instanceof ExternalE2EEKeyProvider) {
        void provider.setKey(keyBytes, keyIndex);
      }
    },
  },
);

// In shutdown():
this.rotationHandle?.unsubscribe();
```

- [ ] **Step 4: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/sframeKeys.ts client/src/renderer/voice/keyRotationCoordinator.ts client/src/renderer/voice/VoiceEngine.ts
git commit -m "client: active SFrame key rotation on net-level kicks (forward secrecy)"
```

---

## Task 12: SFrame E2EE — wire into LiveKit Room

**Files:**
- Modify: `client/src/renderer/voice/NetConnection.ts` (accept E2EE config)
- Modify: `client/src/renderer/voice/VoiceEngine.ts` (fetch key + pass to NetConnection)
- Create: `client/src/renderer/voice/e2eeWorker.ts` (Web Worker placeholder)
- Modify: `client/vite.config.ts` (handle worker import)

LiveKit's E2EE uses a Web Worker for the cryptographic operations. The client SDK provides the worker; we just need to instantiate it and pass an ExternalE2EEKeyProvider with our key.

- [ ] **Step 1: Modify `NetConnection.ts` to accept E2EE config**

Change the constructor signature:

```ts
import { Room, ExternalE2EEKeyProvider, ... } from "livekit-client";

export interface E2EEConfig {
  /** The shared SFrame key bytes (32 bytes). */
  keyBytes: Uint8Array;
  /** The Web Worker instance (must be a LiveKit-compatible E2EE worker). */
  worker: Worker;
}

constructor(opts?: { e2ee?: E2EEConfig }) {
  this.room = new Room({
    adaptiveStream: true,
    dynacast: false,
    e2ee: opts?.e2ee
      ? {
          keyProvider: new ExternalE2EEKeyProvider(),
          worker: opts.e2ee.worker,
        }
      : undefined,
  });
  // ... existing track + speaker subscriptions

  // If E2EE is configured, set the key:
  if (opts?.e2ee) {
    void (this.room.options.e2ee!.keyProvider as ExternalE2EEKeyProvider).setKey(opts.e2ee.keyBytes);
  }
}
```

- [ ] **Step 2: Create `client/src/renderer/voice/e2eeWorker.ts`**

```ts
// Placeholder for the LiveKit E2EE worker.
// LiveKit ships its own worker at "livekit-client/e2ee-worker"; in Vite we
// import it as a URL worker.
//
// At runtime, instantiate via:
//   new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" })
//
// The actual implementation is provided by livekit-client; this file is a
// thin re-export for centralization.

export function createLiveKitE2EEWorker(): Worker {
  return new Worker(
    new URL("livekit-client/e2ee-worker", import.meta.url),
    { type: "module" },
  );
}
```

**Note:** if the URL import doesn't resolve cleanly with the installed livekit-client version, the implementer should consult LiveKit's E2EE docs (https://docs.livekit.io/home/client/tracks/encryption/) for the canonical worker setup pattern in their version.

- [ ] **Step 3: Modify `VoiceEngine.monitorNet` to fetch the key and pass E2EE config**

In `VoiceEngine.ts`, before constructing the NetConnection:

```ts
import { fetchSframeKey } from "./sframeKeys";
import { createLiveKitE2EEWorker } from "./e2eeWorker";

// inside monitorNet:
const keyBytes = await fetchSframeKey(this.client, args.matrixRoomId);
let e2eeConfig: E2EEConfig | undefined;
if (keyBytes) {
  e2eeConfig = { keyBytes, worker: createLiveKitE2EEWorker() };
} else {
  console.warn(`Net ${args.matrixRoomId} has no SFrame key — joining without E2EE`);
}
const connection = new NetConnection({ e2ee: e2eeConfig });
```

- [ ] **Step 4: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -10
# Expect: success. Vite may emit a warning about the worker URL; that's OK as long as the dist contains the worker chunk.
```

- [ ] **Step 5: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/NetConnection.ts client/src/renderer/voice/VoiceEngine.ts client/src/renderer/voice/e2eeWorker.ts
git commit -m "client: wire SFrame E2EE via LiveKit ExternalE2EEKeyProvider + worker"
```

---

## Task 13: Net list panel UI

**Files:**
- Create: `client/src/renderer/components/NetListPanel.tsx`
- Create: `client/src/renderer/components/NetRow.tsx`

A panel that lists all nets the user is a member of, showing each with:
- Name + priority badge
- Volume slider
- Active speaker indicator (small pulsing dot)
- **PTT mode selector** (toggle | hold | voice)
- **PTT keybind** (click to capture; hidden for voice mode)
- **Voice threshold slider** (only visible for voice mode)
- Monitor toggle (currently subscribing or not)

- [ ] **Step 1: Write `client/src/renderer/components/NetRow.tsx`**

```tsx
import type { NetSummary } from "../matrix/nets";
import { KeybindCapture } from "./KeybindCapture";

import type { PttMode } from "../voice/PttController";

interface NetRowProps {
  net: NetSummary;
  monitored: boolean;
  volume: number;
  activeSpeakers: number;
  transmitting: boolean;
  pttMode: PttMode;
  keybind: string | null;
  voiceThresholdDb: number;
  onToggleMonitor: () => void;
  onVolumeChange: (volume: number) => void;
  onPttModeChange: (mode: PttMode) => void;
  onKeybindChange: (accel: string) => void;
  onKeybindClear: () => void;
  onVoiceThresholdChange: (db: number) => void;
}

export function NetRow({
  net,
  monitored,
  volume,
  activeSpeakers,
  transmitting,
  keybind,
  onToggleMonitor,
  onVolumeChange,
  onKeybindChange,
  onKeybindClear,
}: NetRowProps) {
  return (
    <div className={`flex items-center gap-3 rounded border p-3 ${
      transmitting
        ? "border-brand-400 bg-brand-500/10"
        : monitored
          ? "border-slate-700 bg-slate-800/50"
          : "border-slate-800 bg-slate-900"
    }`}>
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: net.properties.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-slate-100">{net.properties.name}</span>
          <span className="text-xs text-slate-500">P{net.properties.priority}</span>
          {activeSpeakers > 0 && (
            <span className="text-xs text-ok">{activeSpeakers} talking</span>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-500">{net.memberCount} members</div>
      </div>

      <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        value={volume}
        onChange={(e) => onVolumeChange(Number(e.target.value))}
        className="w-24"
        title={`Volume: ${Math.round(volume * 100)}%`}
        disabled={!monitored}
      />

      <select
        value={pttMode}
        onChange={(e) => onPttModeChange(e.target.value as PttMode)}
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
        title="PTT mode"
      >
        <option value="toggle">Tap</option>
        <option value="hold">Hold</option>
        <option value="voice">Voice</option>
      </select>

      {pttMode !== "voice" && (
        <KeybindCapture value={keybind ?? ""} onChange={onKeybindChange} onClear={onKeybindClear} />
      )}
      {pttMode === "voice" && (
        <input
          type="range"
          min="-70"
          max="-20"
          step="1"
          value={voiceThresholdDb}
          onChange={(e) => onVoiceThresholdChange(Number(e.target.value))}
          className="w-24"
          title={`Voice threshold: ${voiceThresholdDb} dB`}
        />
      )}

      <button
        onClick={onToggleMonitor}
        className={`rounded px-3 py-1 text-xs ${
          monitored
            ? "border border-brand-400 bg-brand-500/20 text-brand-50"
            : "border border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500"
        }`}
      >
        {monitored ? "Monitoring" : "Monitor"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/renderer/components/NetListPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import { NetRow } from "./NetRow";
import { VoiceEngine } from "../voice/VoiceEngine";
import { PttController } from "../voice/PttController";

interface NetListPanelProps {
  client: MatrixClient;
}

interface PerNetUiState {
  monitored: boolean;
  volume: number;
  activeSpeakers: number;
  keybind: string | null;
}

export function NetListPanel({ client }: NetListPanelProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [uiState, setUiState] = useState<Map<string, PerNetUiState>>(new Map());
  const [engine] = useState(() => new VoiceEngine(client));
  const [ptt] = useState(() => new PttController(engine));
  const [transmitting, setTransmitting] = useState<string | null>(null);

  // Refresh net list on Matrix changes
  useEffect(() => {
    const refresh = () => setNets(listNets(client));
    refresh();
    return subscribeToNetsChanges(client, refresh);
  }, [client]);

  // Wire voice engine events to UI state
  useEffect(() => {
    engine.on("activeSpeakersChanged", (matrixRoomId, identities) => {
      setUiState((m) => {
        const next = new Map(m);
        const existing = next.get(matrixRoomId) ?? defaultUi();
        next.set(matrixRoomId, { ...existing, activeSpeakers: identities.length });
        return next;
      });
    });
  }, [engine]);

  // Poll PTT state (cheap, runs only when something changes)
  useEffect(() => {
    const i = setInterval(() => setTransmitting(ptt.getTransmittingNet()), 100);
    return () => clearInterval(i);
  }, [ptt]);

  useEffect(() => {
    return () => {
      void ptt.shutdown();
      void engine.shutdown();
    };
  }, [engine, ptt]);

  async function handleToggleMonitor(net: NetSummary) {
    const current = uiState.get(net.matrixRoomId) ?? defaultUi();
    if (current.monitored) {
      await engine.unmonitorNet(net.matrixRoomId);
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: false, activeSpeakers: 0 });
        return next;
      });
    } else {
      await engine.monitorNet({
        matrixRoomId: net.matrixRoomId,
        priority: net.properties.priority,
      });
      setUiState((m) => {
        const next = new Map(m);
        next.set(net.matrixRoomId, { ...current, monitored: true });
        return next;
      });
    }
  }

  async function handleVolume(matrixRoomId: string, volume: number) {
    engine.setNetVolume(matrixRoomId, volume);
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, volume });
      return next;
    });
  }

  async function handleKeybindChange(matrixRoomId: string, accel: string) {
    const result = await ptt.bind(matrixRoomId, accel);
    if (!result.ok) {
      alert(`Failed to register keybind: ${result.error}`);
      return;
    }
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, keybind: accel });
      return next;
    });
  }

  async function handleKeybindClear(matrixRoomId: string) {
    await ptt.unbind(matrixRoomId);
    setUiState((m) => {
      const next = new Map(m);
      const existing = next.get(matrixRoomId) ?? defaultUi();
      next.set(matrixRoomId, { ...existing, keybind: null });
      return next;
    });
  }

  if (nets.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        <p>No nets yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          An admin can create one via the "+" button (when wired in Task 15).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {nets.map((net) => {
        const ui = uiState.get(net.matrixRoomId) ?? defaultUi();
        return (
          <NetRow
            key={net.matrixRoomId}
            net={net}
            monitored={ui.monitored}
            volume={ui.volume}
            activeSpeakers={ui.activeSpeakers}
            transmitting={transmitting === net.matrixRoomId}
            keybind={ui.keybind}
            onToggleMonitor={() => handleToggleMonitor(net)}
            onVolumeChange={(v) => handleVolume(net.matrixRoomId, v)}
            onKeybindChange={(a) => handleKeybindChange(net.matrixRoomId, a)}
            onKeybindClear={() => handleKeybindClear(net.matrixRoomId)}
          />
        );
      })}
    </div>
  );
}

function defaultUi(): PerNetUiState {
  return { monitored: false, volume: 1.0, activeSpeakers: 0, keybind: null };
}
```

- [ ] **Step 3: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/NetListPanel.tsx client/src/renderer/components/NetRow.tsx
git commit -m "client: net list panel with monitor toggle + volume + PTT keybind"
```

---

## Task 14: Create-net flow (basic UI)

**Files:**
- Create: `client/src/renderer/components/CreateNetDialog.tsx`

A modal dialog: enter Name + Priority (slider 0-100) + Color picker. On submit, calls `createNet` from matrix/nets, then `uploadSframeKey` to seed the E2EE key, then closes.

- [ ] **Step 1: Write `client/src/renderer/components/CreateNetDialog.tsx`**

```tsx
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";
import { Input } from "./Input";
import { createNet } from "../matrix/nets";
import { generateSframeKey, uploadSframeKey } from "../voice/sframeKeys";

interface CreateNetDialogProps {
  client: MatrixClient;
  onClose: () => void;
  onCreated: (matrixRoomId: string) => void;
}

const PRESET_COLORS = ["#22d3ee", "#a78bfa", "#fb7185", "#fbbf24", "#34d399", "#f97316"];

export function CreateNetDialog({ client, onClose, onCreated }: CreateNetDialogProps) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(50);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const roomId = await createNet(client, { name, priority, color });
      const keyBytes = generateSframeKey();
      await uploadSframeKey(client, roomId, keyBytes);
      onCreated(roomId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create net");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-brand-400">Create a net</h2>
        <p className="mt-1 text-xs text-slate-500">
          A new encrypted Matrix room paired with a LiveKit voice room.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Name"
            placeholder="Command, Alpha Squad, All-Hands…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">
              Priority: <span className="text-brand-400">{priority}</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <span className="text-xs text-slate-500">Higher priority ducks lower-priority nets.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Color</span>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${color === c ? "ring-2 ring-white" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </label>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create net"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/CreateNetDialog.tsx
git commit -m "client: CreateNetDialog — admin UI for spawning a new voice net"
```

---

## Task 15: Replace Home placeholder with real tactical UI

**Files:**
- Modify: `client/src/renderer/screens/Home.tsx`

Replace the placeholder Home screen with the real tactical-radio UI: NetListPanel + a "+" button that opens CreateNetDialog. Logout button stays in a top bar.

- [ ] **Step 1: Rewrite `client/src/renderer/screens/Home.tsx`**

```tsx
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";
import { NetListPanel } from "../components/NetListPanel";
import { CreateNetDialog } from "../components/CreateNetDialog";

interface HomeProps {
  client: MatrixClient;
  onLogout: () => Promise<void> | void;
}

export function Home({ client, onLogout }: HomeProps) {
  const [creating, setCreating] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-400">Hailfreq</h1>
          <p className="text-xs text-slate-500">{client.getSafeUserId()}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New net
          </Button>
          <Button
            variant="ghost"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              await onLogout();
            }}
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <NetListPanel client={client} />
      </div>

      {creating && (
        <CreateNetDialog
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(_roomId) => {
            // NetListPanel re-syncs from Matrix events; nothing else to do
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/Home.tsx
git commit -m "client: Home screen replaces placeholder with tactical net list + create-net"
```

---

## Task 16: Persist PTT bindings + monitored nets per-server

**Files:**
- Modify: `client/src/shared/types.ts` (add VoicePrefs to ServerEntry)
- Modify: `client/src/main/store.ts` (initialize VoicePrefs on add)
- Modify: `client/src/renderer/components/NetListPanel.tsx` (load + save prefs)

We persist per-server: per-net volume and PTT keybind, plus a list of monitored nets. Stored under each ServerEntry so multi-server works cleanly.

- [ ] **Step 1: Extend `ServerEntry` in `client/src/shared/types.ts`**

```ts
export interface NetPreferences {
  /** Per-net volume (0.0-2.0). Keyed by Matrix room ID. */
  volumes: Record<string, number>;
  /** PTT accelerator per net. Keyed by Matrix room ID. Only populated for toggle/hold modes. */
  keybinds: Record<string, string>;
  /** PTT mode per net. Keyed by Matrix room ID. Default: "toggle". */
  pttModes: Record<string, "toggle" | "hold" | "voice">;
  /** Voice activation threshold in dBFS per net. Keyed by Matrix room ID. Default: -45. */
  voiceThresholds: Record<string, number>;
  /** Matrix room IDs the user has chosen to monitor (auto-connect on app start). */
  monitored: string[];
}

export interface ServerEntry {
  // ... existing fields ...
  voicePrefs?: NetPreferences;
}
```

- [ ] **Step 2: Ensure `addServer` and migration initialize `voicePrefs`**

In `store.ts`'s `addServer`:

```ts
const entry: ServerEntry = {
  // ... existing fields ...
  voicePrefs: { volumes: {}, keybinds: {}, pttModes: {}, voiceThresholds: {}, monitored: [] },
};
```

In `migrateLegacyShape`, when constructing the migrated entry, also include `voicePrefs: { volumes: {}, keybinds: {}, pttModes: {}, voiceThresholds: {}, monitored: [] }`.

- [ ] **Step 3: Modify NetListPanel to load + save prefs**

In NetListPanel, accept an `activeServerEntry: ServerEntry` prop. On mount, populate uiState from `activeServerEntry.voicePrefs`. On volume/keybind/monitor changes, call `servers:update` to persist the changes back.

(The implementation details are a few lines per handler — straightforward but a little ceremony.)

- [ ] **Step 4: Thread the activeServerEntry from AppState to Home to NetListPanel**

In `AppState.tsx`, when rendering Home, pass the active server's entry:

```tsx
<Home
  client={instance.handle!.client}
  serverEntry={instance.entry}
  onLogout={...}
/>
```

In `Home.tsx`, thread `serverEntry` to NetListPanel.

- [ ] **Step 5: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/shared/types.ts client/src/main/store.ts client/src/renderer/components/NetListPanel.tsx client/src/renderer/screens/Home.tsx client/src/renderer/AppState.tsx
git commit -m "client: persist per-net volume + PTT keybinds + monitored list per server"
```

---

## Task 17: Sidebar shows the active net's transmitting badge

**Files:**
- Modify: `client/src/renderer/AppState.tsx` (track PTT state from VoiceEngine globally)
- Modify: `client/src/renderer/components/ServerIcon.tsx` (badge for transmitting)
- Modify: `client/src/renderer/components/Sidebar.tsx` (thread the new prop)

A small UI touch: when the user is PTT-transmitting on any net, the active server's icon in the sidebar gets a pulsing brand-colored ring so it's clear they're hot.

- [ ] **Step 1: ServerIcon accepts `transmitting?: boolean` prop**

When `transmitting`, add an outer animated ring class (Tailwind's `animate-pulse` plus a brand ring).

- [ ] **Step 2: Sidebar threads the prop**

Sidebar accepts `servers: Array<{ entry: ServerEntry; unreadCount: number; transmitting: boolean }>`.

- [ ] **Step 3: AppState tracks PTT state**

Wire a small per-server `transmittingNet: string | null` state. Update on PTT start/stop events from the VoiceEngine (which can emit a new event for this — extend VoiceEngineEvents accordingly).

- [ ] **Step 4: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -3
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/ServerIcon.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/AppState.tsx client/src/renderer/voice/VoiceEngine.ts
git commit -m "client: sidebar shows transmitting badge while PTT active"
```

---

## Task 18: Vitest unit tests for the new modules

**Files:**
- Create: `client/tests/unit/keybinds.test.ts`
- Create: `client/tests/unit/sframeKeys.test.ts`

Pure functions get unit tests; the engine-level pieces are covered by the E2E test in Task 20.

- [ ] **Step 1: Write `client/tests/unit/keybinds.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { eventToAccelerator } from "@/renderer/voice/keybinds";

function ev(opts: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", opts as KeyboardEventInit);
}

describe("eventToAccelerator", () => {
  it("returns a function-key code", () => {
    expect(eventToAccelerator(ev({ code: "F13" }))).toBe("F13");
  });
  it("formats modifier keys in canonical order", () => {
    expect(eventToAccelerator(ev({ code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("Control+Shift+P");
  });
  it("normalizes Digit codes", () => {
    expect(eventToAccelerator(ev({ code: "Digit5", altKey: true }))).toBe("Alt+5");
  });
  it("returns null for modifier-only presses", () => {
    expect(eventToAccelerator(ev({ code: "ShiftLeft" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Write `client/tests/unit/sframeKeys.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { generateSframeKey } from "@/renderer/voice/sframeKeys";

describe("generateSframeKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const k = generateSframeKey();
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });
  it("produces distinct keys on each call (statistical: 4 calls should be unique)", () => {
    const ks = new Set(Array.from({ length: 4 }, () => Array.from(generateSframeKey()).join(",")));
    expect(ks.size).toBe(4);
  });
});
```

- [ ] **Step 3: Run vitest**

```bash
cd /home/shreen/code/tactical-radio/client
npx vitest run 2>&1 | tail -10
# Expect: previous 10 + new tests pass
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/keybinds.test.ts client/tests/unit/sframeKeys.test.ts
git commit -m "client: vitest unit tests for keybinds + sframe key gen"
```

---

## Task 19: E2E voice test — two clients, one PTT, verify other receives

**Files:**
- Create: `client/tests/e2e/voice.spec.ts`
- Modify: `client/tests/e2e/helpers/synapse.ts` (add LiveKit + livekit-auth to the started services)

This test boots a full server stack (postgres + synapse + livekit + coturn + livekit-auth), launches two Hailfreq client instances, creates a net, has both join + monitor it, has one push-to-talk, and verifies the other receives at least one audio packet via `RoomEvent.TrackSubscribed`.

**Implementer warning:** this is a complex test. It may need ~2-3 minutes per run (cold-starting Synapse + LiveKit). Be patient with the timeouts. If specific steps fail, debug honestly rather than faking a pass.

- [ ] **Step 1: Extend Synapse fixture to bring up LiveKit + livekit-auth**

Modify `startSynapseInstance` (or add a new `startFullStackInstance`) to also start `livekit`, `coturn`, and `livekit-auth` from the same compose project. The fixture should expose the LiveKit URL and the livekit-auth URL.

- [ ] **Step 2: Write `client/tests/e2e/voice.spec.ts`**

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { startFullStackInstance } from "./helpers/synapse";

test("voice: two clients can transmit + receive on a shared net", async () => {
  const stack = await startFullStackInstance("voice", 8008);
  try {
    // Launch Client A
    const appA = await electron.launch({ args: ["."], cwd: "<client/ dir>", env: { HAILFREQ_TEST: "1" } });
    const winA = await appA.firstWindow();

    // Walk through first-run + login + encryption for Client A
    // ... (use the helper from Plan 2's E2E test, with two distinct users)

    // Same for Client B in a separate Electron instance with a distinct userData dir

    // Client A: creates a net via the + New Net button
    // Both: monitor the new net

    // Client A: sets a PTT keybind (F13) and triggers it programmatically via Electron's globalShortcut
    // (Or: invoke the PttController directly via the test-mode IPC hooks if simpler)

    // Verify Client B's VoiceEngine receives a TrackSubscribed event for Client A's mic track
    // We can expose a test-mode hook on the renderer that exposes the engine's event log

    // ...

    await appA.close();
    // ... appB.close()
  } finally {
    await stack.cleanup();
  }
});
```

**Note:** the full implementation is non-trivial. The test sketch above shows structure; the implementer should flesh it out, exposing whatever test-mode hooks are necessary to observe internal state without true audio capture. If actual audio capture is too hard, validate at the protocol level: confirm that Client B sees Client A as an active speaker.

If after honest effort the E2E doesn't pass, report DONE_WITH_CONCERNS with the specific failure step — do not fake a pass. The unit tests + manual smoke-test cover the basics.

- [ ] **Step 3: Run the E2E**

```bash
cd /home/shreen/code/tactical-radio/client
npx playwright test voice 2>&1 | tail -25
```

- [ ] **Step 4: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/e2e/voice.spec.ts client/tests/e2e/helpers/synapse.ts
git commit -m "client: e2e voice test — two clients, one PTT, receiver detects active speaker"
```

---

## Task 20: Rebuild installers + final smoke test

**Files:**
- (No new files)

- [ ] **Step 1: Build Linux + Windows**

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
ls -lh release/Hailfreq-*
```

- [ ] **Step 2: Smoke-test Linux AppImage**

```bash
chmod +x release/Hailfreq-*x86_64.AppImage
timeout 5 ./release/Hailfreq-*x86_64.AppImage 2>&1 | head -5 || true
```

- [ ] **Step 3: No commit unless something needed fixing**

---

## Task 21: Update README + spec markers

**Files:**
- Modify: `client/README.md` (add voice features)
- Modify: `docs/superpowers/specs/2026-05-26-hailfreq-design.md` (mark §5 sections as implemented)

- [ ] **Step 1: Update `client/README.md`**

Add to feature list:

```markdown
- Multi-net simultaneous voice monitor (LiveKit-backed) with SFrame E2EE
- Per-net push-to-talk with global hotkeys
- Priority ducking (configurable per-net priority levels)
- Per-net volume controls
```

- [ ] **Step 2: Add implementation markers to spec §5**

Find spec §5 (Multi-Net Voice Design). After §5.5 (Capacity envelope), add:

```markdown
**Implementation status (v1):** §5.1–5.5 shipped in Plan 4. See `docs/superpowers/plans/2026-05-28-hailfreq-voice-engine.md`. §5.6 (Net Bridges) remains v1.5.
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/README.md docs/superpowers/specs/
git commit -m "docs: note voice engine shipped; mark spec §5 as implemented in Plan 4"
```

---

## Task 22: Server kit README + deployment notes

**Files:**
- Modify: `server/docs/deployment.md` (add livekit-auth note)
- Modify: `server/README.md` (add livekit-auth to layout)

- [ ] **Step 1: Add livekit-auth notes to `server/docs/deployment.md`**

Add a sub-section after Step 4 (Bring up the stack):

```markdown
### livekit-auth — LiveKit token minting service

After Plan 4, the stack includes a `livekit-auth` service that mints LiveKit JWTs for Hailfreq clients. It validates Matrix access tokens against Synapse and confirms room membership before issuing a JWT. The Caddy reverse-proxy exposes it at `/lk-auth/*`.

**Image build:** The setup script builds the image from `server/livekit-auth/` on first run. Subsequent runs reuse the cached image. To force a rebuild: `docker compose build livekit-auth`.
```

- [ ] **Step 2: Add livekit-auth to the layout in `server/README.md`**

```markdown
- `livekit-auth/` — Token-minting service for LiveKit access
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add server/docs/deployment.md server/README.md
git commit -m "docs(server): note livekit-auth service in deployment guide"
```

---

## Done

After Task 22, the deliverable is:

- A working voice engine: multi-net monitoring + PTT + priority ducking + SFrame E2EE
- **Three PTT modes per net**: tap-to-toggle, press-and-hold (native), voice activation (RMS analyzer)
- Tactical-radio Home UI replacing Plan 2's placeholder
- Per-server persistence of voice preferences (volumes, keybinds, modes, voice thresholds, monitored nets)
- Sidebar transmit indicator
- Server-side LiveKit auth service (containerized, in compose)
- Vitest unit tests + (best-effort) Playwright voice E2E test
- Updated docs

**Known v1 limitations (documented elsewhere):**
- Press-and-hold doesn't work on Wayland Linux (compositor security blocks global key hooks); affected users fall back to tap or voice activation
- SFrame keys rotate on net-level kicks, but kicked members can still decrypt traffic they captured prior to the rotation (standard forward-secrecy property of Megolm-style ratchets). Server-level ban is fully effective immediately for adversarial removals.
- Voice operates only on the active server (multi-server voice deferred)
- No chirps, no focused-app PTT, no screen sharing UI

**Next plans:**

- **Plan 5:** Admin / Squad-Leader board — power-level management UI, net priority editor, member assign/unassign across nets, disconnect-from-voice controls
- **v1.5 (Plan 6+):** Chirps, focused-app PTT, screen sharing exposure, SFrame key rotation, Net Bridges, drag-to-reorder sidebar, OS-level notifications
