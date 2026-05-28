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

export async function kickFromVoice(args: {
  hailfreqAuthBaseUrl: string;
  matrixAccessToken: string;
  matrixRoomId: string;
  targetUserId: string;
}): Promise<void> {
  const resp = await fetch(`${args.hailfreqAuthBaseUrl}/kick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matrixAccessToken: args.matrixAccessToken,
      matrixRoomId: args.matrixRoomId,
      targetUserId: args.targetUserId,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`kick failed: ${resp.status} ${body}`);
  }
}
