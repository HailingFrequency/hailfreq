import type { MatrixClient } from "matrix-js-sdk";

/** Invite a user (by Matrix user ID) to a net. */
export async function inviteToNet(
  client: MatrixClient,
  matrixRoomId: string,
  userId: string,
): Promise<void> {
  await client.invite(matrixRoomId, userId);
}

/** Kick a user from a net (Matrix room membership change — voice access lost on next JWT refresh + immediately on rotation). */
export async function kickFromNet(
  client: MatrixClient,
  matrixRoomId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await client.kick(matrixRoomId, userId, reason);
}

/** Set a user's power level in a net. PL 75 = squad leader, PL 100 = admin, PL 0 = regular. */
export async function setPowerLevel(
  client: MatrixClient,
  matrixRoomId: string,
  userId: string,
  level: number,
): Promise<void> {
  await client.setPowerLevel(matrixRoomId, userId, level);
}

/**
 * Deactivate a user account via Synapse admin API. Requires the caller to be a
 * Synapse server admin. After this call, the user cannot authenticate, cannot
 * fetch new tokens, and is fully cut off from the server.
 */
export async function banFromServer(
  client: MatrixClient,
  targetUserId: string,
): Promise<void> {
  const url = `${client.getHomeserverUrl()}/_synapse/admin/v1/deactivate/${encodeURIComponent(targetUserId)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ erase: false }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Ban failed: ${resp.status} ${body}`);
  }
}
