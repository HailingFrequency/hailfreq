import express, { type Request, type Response } from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const PORT = parseInt(process.env.PORT || "8088", 10);
const SYNAPSE_URL = mustEnv("SYNAPSE_URL");
const LIVEKIT_URL = mustEnv("LIVEKIT_URL");
const LIVEKIT_API_KEY = mustEnv("LIVEKIT_API_KEY");
const LIVEKIT_API_SECRET = mustEnv("LIVEKIT_API_SECRET");

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const app = express();
app.use(express.json({ limit: "32kb" }));

// CORS middleware (defensive; Caddy will be in front)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

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
      // canPublishData intentionally omitted — voice nets don't need data channels
    });

    const token = await at.toJwt();
    return res.json({ token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("token mint failed:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/kick", async (req: Request, res: Response) => {
  try {
    const { matrixAccessToken, matrixRoomId, targetUserId } = req.body as {
      matrixAccessToken?: string;
      matrixRoomId?: string;
      targetUserId?: string;
    };

    if (!matrixAccessToken || !matrixRoomId || !matrixRoomId.startsWith("!") || !targetUserId) {
      return res.status(400).json({ error: "matrixAccessToken, matrixRoomId, targetUserId required" });
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
    await roomService.removeParticipant(liveKitRoom, targetUserId);

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
