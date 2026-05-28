import type { MatrixClient } from "matrix-js-sdk";
import { listNets } from "./nets";

export interface AdminCapabilities {
  /** User is admin (PL >= 100) in at least one voice net — they see the admin board. */
  isAnyAdmin: boolean;
  /** Set of Matrix room IDs where the user is PL >= 100 (full admin). */
  adminNets: Set<string>;
  /** Set of Matrix room IDs where the user is PL >= 75 (squad leader). */
  squadLeaderNets: Set<string>;
  /** True if the user is a Synapse server admin (can deactivate accounts). */
  isServerAdmin: boolean;
}

export async function detectAdminCapabilities(client: MatrixClient): Promise<AdminCapabilities> {
  const userId = client.getSafeUserId();
  const nets = listNets(client);
  const adminNets = new Set<string>();
  const squadLeaderNets = new Set<string>();
  for (const net of nets) {
    if (net.myPowerLevel >= 100) {
      adminNets.add(net.matrixRoomId);
      squadLeaderNets.add(net.matrixRoomId);
    } else if (net.myPowerLevel >= 75) {
      squadLeaderNets.add(net.matrixRoomId);
    }
  }

  // Detect Synapse server-admin status by trying the admin self-lookup
  let isServerAdmin = false;
  try {
    const url = `${client.getHomeserverUrl()}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${client.getAccessToken()}` },
    });
    if (resp.ok) {
      const body = (await resp.json()) as { admin?: boolean };
      isServerAdmin = body.admin === true;
    }
  } catch {
    // Network/permission failure — assume not a server admin
  }

  return {
    isAnyAdmin: adminNets.size > 0,
    adminNets,
    squadLeaderNets,
    isServerAdmin,
  };
}
