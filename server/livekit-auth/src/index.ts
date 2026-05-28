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
  // Validate that all required env vars are present
  void [LIVEKIT_API_KEY, LIVEKIT_API_SECRET];
});

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var is required`);
  return v;
}
