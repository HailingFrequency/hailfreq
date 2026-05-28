/**
 * CitizenID profile cache.
 *
 * Each user who logged in via CitizenID / OIDC can publish their RSI handle +
 * verified flag to their own Matrix account-data under the key
 * "org.hailfreq.citizenid".  Other clients can then read it from the
 * /profile/<userId> endpoint.
 *
 * Implementer note: the Matrix spec doesn't formally support arbitrary keys in
 * the /profile endpoint, but Synapse stores them. If the Synapse version in use
 * doesn't surface custom profile keys, fetchCitizenIdProfile returns null and
 * the roster's rsiVerified flag stays false for that user (graceful degradation).
 * setAccountData always works for self-publication even without the profile key.
 */

import type { MatrixClient } from "matrix-js-sdk";

export interface CitizenIdProfileClaim {
  rsiHandle?: string;
  rsiVerified?: boolean;
}

const ACCOUNT_DATA_TYPE = "org.hailfreq.citizenid";

/**
 * Publish the local user's CitizenID-derived RSI claim to their own
 * Matrix account-data. This is always writeable for the authenticating user.
 * Note: account-data is private; for cross-user reads we rely on Synapse's
 * /profile endpoint or fall back to leaving rsiVerified false.
 */
export async function publishOwnCitizenIdProfile(
  client: MatrixClient,
  claim: CitizenIdProfileClaim,
): Promise<void> {
  await client.setAccountData(ACCOUNT_DATA_TYPE as any, claim);
}

/** In-memory cache: userId → claim (or null = definitively not found) */
const profileCache = new Map<string, CitizenIdProfileClaim | null>();

/**
 * Fetch another user's CitizenID claim via the Matrix /profile endpoint.
 *
 * Synapse may or may not expose custom profile keys — if the key is absent,
 * null is returned and the caller should treat rsiVerified as false.
 * Results are cached for the lifetime of the app session.
 */
export async function fetchCitizenIdProfile(
  client: MatrixClient,
  userId: string,
): Promise<CitizenIdProfileClaim | null> {
  if (profileCache.has(userId)) {
    return profileCache.get(userId) ?? null;
  }

  try {
    const url = `${client.getHomeserverUrl()}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${client.getAccessToken()}` },
    });

    if (!resp.ok) {
      profileCache.set(userId, null);
      return null;
    }

    const body = (await resp.json()) as {
      [ACCOUNT_DATA_TYPE]?: CitizenIdProfileClaim;
      "org.hailfreq.citizenid"?: CitizenIdProfileClaim;
    };

    // Synapse may surface it as the literal key name
    const claim = body["org.hailfreq.citizenid"] ?? null;
    profileCache.set(userId, claim);
    return claim;
  } catch {
    // Network failure — don't cache so we can retry later
    return null;
  }
}

/** Clear cached entry for a userId (e.g. after publishing own profile). */
export function invalidateCitizenIdCache(userId: string): void {
  profileCache.delete(userId);
}
