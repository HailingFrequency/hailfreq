import fs from "node:fs";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

/** Matrix user ID format: @localpart:domain */
const MXID_RE = /^@[^\s:]+:[^\s:]+$/;

/**
 * Read a secret value, preferring /run/secrets/<name> if it exists
 * (Plan 10 secrets-volume pattern), falling back to environment variable.
 * Throws if neither source provides the secret.
 */
function readSecret(secretName: string, envFallbackName: string): string {
  const filePath = `/run/secrets/${secretName}`;
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8").trim();
  }
  const env = process.env[envFallbackName];
  if (env) return env;
  throw new Error(
    `Secret '${secretName}' not available — checked ${filePath} and env var ${envFallbackName}`,
  );
}

const PORT = parseInt(process.env.PORT || "8088", 10);
const SYNAPSE_URL = mustEnv("SYNAPSE_URL");
const LIVEKIT_URL = mustEnv("LIVEKIT_URL");
const LIVEKIT_API_KEY = readSecret("livekit_api_key", "LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = readSecret("livekit_api_secret", "LIVEKIT_API_SECRET");

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const app = express();
// Behind Caddy: trust the first proxy hop so express-rate-limit keys on the
// real client IP (X-Forwarded-For) rather than the proxy's.
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

// CORS (H4): the previous hardcoded wildcard let any origin read /token and
// /kick responses. It's now configurable via LK_AUTH_CORS_ORIGIN. NOTE: the
// Electron client loads from a file:// origin (sent as "null"), so locking this
// down requires the client to use a fixed app:// origin; until then operators
// who run only the Electron client can leave the default. Bearer tokens (not
// cookies) carry auth, so a wildcard is not a CSRF vector, but it is needless
// cross-origin exposure.
const CORS_ORIGIN = process.env.LK_AUTH_CORS_ORIGIN || "*";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting (H3): each /token call triggers 2 Synapse round-trips and a JWT
// signing; /kick triggers 3 Synapse calls + a LiveKit admin op. Cap per-IP to
// blunt floods / amplification against Synapse.
const tokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});
const kickLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/token", tokenLimiter, async (req: Request, res: Response) => {
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
      // M4: 1 hour (was 6h). Limits the window in which a kicked/removed user
      // can reconnect with a still-valid token. The client re-mints on
      // disconnect; a proactive pre-expiry refresh would be the ideal follow-up.
      ttl: 60 * 60,
    });
    at.addGrant({
      room: liveKitRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // canPublishData intentionally omitted — voice nets don't need data channels
    });

    const token = await at.toJwt();
    return res.json({ token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("token mint failed:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/kick", kickLimiter, async (req: Request, res: Response) => {
  try {
    const { matrixAccessToken, matrixRoomId, targetUserId } = req.body as {
      matrixAccessToken?: string;
      matrixRoomId?: string;
      targetUserId?: string;
    };

    if (!matrixAccessToken || !matrixRoomId || !matrixRoomId.startsWith("!") || !targetUserId) {
      return res.status(400).json({ error: "matrixAccessToken, matrixRoomId, targetUserId required" });
    }
    // M5: validate target is a well-formed Matrix user ID before passing it to
    // the LiveKit admin API.
    if (typeof targetUserId !== "string" || !MXID_RE.test(targetUserId)) {
      return res.status(400).json({ error: "targetUserId must be a Matrix user ID (@user:domain)" });
    }

    // Validate the requester
    const whoami = await fetch(`${SYNAPSE_URL}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${matrixAccessToken}` },
    });
    if (!whoami.ok) return res.status(401).json({ error: "invalid Matrix access token" });
    const { user_id: requesterId } = (await whoami.json()) as { user_id: string };

    // Verify requester is an admin (PL >= 100) in the room
    const plResp = await fetch(
      `${SYNAPSE_URL}/_matrix/client/v3/rooms/${encodeURIComponent(matrixRoomId)}/state/m.room.power_levels/`,
      { headers: { Authorization: `Bearer ${matrixAccessToken}` } }
    );
    if (!plResp.ok) return res.status(403).json({ error: "cannot read room power levels" });
    const pl = (await plResp.json()) as {
      users?: Record<string, number>;
      users_default?: number;
    };
    const requesterPl = pl.users?.[requesterId] ?? pl.users_default ?? 0;
    if (requesterPl < 100) return res.status(403).json({ error: "admin power level required" });

    // Derive LiveKit room name from Matrix room ID (same logic as /token)
    const colonIdx = matrixRoomId.indexOf(":");
    const liveKitRoom = colonIdx > 0 ? matrixRoomId.substring(1, colonIdx) : matrixRoomId.substring(1);

    // Kick from LiveKit (chat membership unaffected — Matrix kick is a separate action)
    try {
      await roomService.removeParticipant(liveKitRoom, targetUserId);
    } catch (kickErr) {
      // Treat "participant not found" as idempotent success — operator intent is satisfied
      // if the participant is already gone (e.g., disconnected before the kick was processed).
      const msg = String(kickErr instanceof Error ? kickErr.message : kickErr).toLowerCase();
      if (msg.includes("not found") || msg.includes("no participant")) {
        return res.json({ ok: true, alreadyGone: true });
      }
      throw kickErr;
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("kick failed:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`hailfreq-livekit-auth listening on :${PORT}`);
  console.log(`  Synapse: ${SYNAPSE_URL}`);
  console.log(`  LiveKit: ${LIVEKIT_URL}`);
  // Validate that all required env vars are present
  void [LIVEKIT_API_KEY, LIVEKIT_API_SECRET];
});

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}
