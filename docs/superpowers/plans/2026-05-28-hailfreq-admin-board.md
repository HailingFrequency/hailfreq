# Hailfreq Admin / Squad-Leader Board Implementation Plan (Plan 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin / squad-leader board — the operator UI for managing nets, members, and discipline during an active op. After Plan 5, admins can create/rename/delete nets, change priorities and colors, invite and remove members, promote and demote squad leaders, disconnect operators from voice, and ban accounts from the server. The board surfaces the full roster across all visible nets with online/active-speaker indicators and RSI-verified badges from CitizenID. This is the last spec piece needed for v1 of the product.

**Architecture:** Almost everything reads + writes Matrix primitives directly from the client (room state, power levels, membership). One new server-side endpoint (`POST /kick` on livekit-auth) is needed because kicking a participant from a LiveKit room requires the API key, which lives only on the server. Server-level bans go straight to Synapse's admin API. The admin board is a separate screen reachable from the Home header, gated on the user having PL ≥ 100 in at least one voice net.

**Tech Stack:** Same as Plans 1–4. No new dependencies.

**Scope reference:** Implements §6 (Admin / Squad-Leader Board) of the Hailfreq design spec. Closes out the v1 must-have feature list.

**Out of scope:**
- Chirps, focused-app PTT, screen sharing, drag-to-reorder, tray, OS notifications — Plan 6
- Star Citizen Game.log integration / ship-nets — Plan 7
- Net Bridges (client-side audio relay) — Plan 8
- Multi-server voice — v1.5
- Audit-log custom event format — deferred to v1.5; Matrix's built-in timeline already captures membership changes
- Bulk operations (kick everyone, broadcast to all nets) — v1.5

**Repo location:** Client work under `client/src/renderer/`. One small server-side addition to `server/livekit-auth/src/index.ts`.

---

## Task 1: livekit-auth /kick endpoint

**Files:**
- Modify: `server/livekit-auth/src/index.ts` (add /kick handler)

Add a server-side endpoint that authenticates the requester as a Matrix admin in the room (PL ≥ 100), then uses the LiveKit `RoomServiceClient` to remove a participant from the corresponding LiveKit room. Chat membership is unaffected.

- [ ] **Step 1: Extend `server/livekit-auth/src/index.ts`** with a new /kick route:

```ts
import { RoomServiceClient } from "livekit-server-sdk";

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

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

    // Derive LiveKit room name from Matrix room ID
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
```

- [ ] **Step 2: Build + verify**

```bash
cd /home/shreen/code/tactical-radio/server/livekit-auth
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add server/livekit-auth/src/index.ts
git commit -m "server(livekit-auth): add /kick endpoint for disconnect-from-voice action"
```

---

## Task 2: Client helper for /kick

**Files:**
- Modify: `client/src/renderer/voice/auth.ts` (add kickFromVoice helper)

- [ ] **Step 1: Add `kickFromVoice` to `client/src/renderer/voice/auth.ts`**

```ts
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
```

- [ ] **Step 2: Verify build**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/voice/auth.ts
git commit -m "client(voice): kickFromVoice helper for admin disconnect-from-voice action"
```

---

## Task 3: Admin capability detection

**Files:**
- Create: `client/src/renderer/matrix/permissions.ts`

A small module that derives admin-related capabilities from the active MatrixClient.

- [ ] **Step 1: Write `client/src/renderer/matrix/permissions.ts`**

```ts
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
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/permissions.ts
git commit -m "client: admin capability detection (net PL + Synapse server-admin)"
```

---

## Task 4: Member roster aggregation

**Files:**
- Create: `client/src/renderer/matrix/roster.ts`

Aggregate the union of members across all visible voice nets, with per-net PL, presence, and any cached CitizenID-verified metadata.

- [ ] **Step 1: Write `client/src/renderer/matrix/roster.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";
import { listNets, type NetSummary } from "./nets";

export interface RosterMember {
  userId: string;
  displayName: string;
  /** Map: matrixRoomId → that member's power level in that net. */
  perNetPowerLevel: Map<string, number>;
  /** Set of matrixRoomIds the member is joined to. */
  joinedNets: Set<string>;
  /** Presence: "online" | "offline" | "unavailable" (per Matrix presence). */
  presence: string;
  /** Cached RSI-verified flag (populated when CitizenID claim is available — see Task 9). */
  rsiVerified: boolean;
  /** Cached RSI handle (for the verified badge). */
  rsiHandle: string | null;
}

export function buildRoster(client: MatrixClient, nets: NetSummary[]): RosterMember[] {
  const byUser = new Map<string, RosterMember>();
  for (const net of nets) {
    const room = client.getRoom(net.matrixRoomId);
    if (!room) continue;
    for (const member of room.getJoinedMembers()) {
      let entry = byUser.get(member.userId);
      if (!entry) {
        entry = {
          userId: member.userId,
          displayName: member.name || member.userId,
          perNetPowerLevel: new Map(),
          joinedNets: new Set(),
          presence: client.getUser(member.userId)?.presence ?? "offline",
          rsiVerified: false,
          rsiHandle: null,
        };
        byUser.set(member.userId, entry);
      }
      entry.perNetPowerLevel.set(net.matrixRoomId, member.powerLevel);
      entry.joinedNets.add(net.matrixRoomId);
    }
  }
  const out = Array.from(byUser.values());
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Subscribe to roster changes (membership, presence, power levels) — debounced refresh. */
export function subscribeToRosterChanges(client: MatrixClient, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, 100);
  };
  client.on("RoomMember.membership" as any, debounced);
  client.on("RoomMember.powerLevel" as any, debounced);
  client.on("User.presence" as any, debounced);
  return () => {
    if (timer) clearTimeout(timer);
    client.off("RoomMember.membership" as any, debounced);
    client.off("RoomMember.powerLevel" as any, debounced);
    client.off("User.presence" as any, debounced);
  };
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/roster.ts
git commit -m "client: member roster aggregation across visible voice nets"
```

---

## Task 5: Net admin actions

**Files:**
- Modify: `client/src/renderer/matrix/nets.ts` (add admin action helpers)

Extend the existing nets.ts with admin-only helpers: rename, recolor, delete.

- [ ] **Step 1: Add helpers to `client/src/renderer/matrix/nets.ts`**

```ts
/** Rename a net's display name (updates BOTH m.room.name and org.hailfreq.net.name). */
export async function renameNet(
  client: MatrixClient,
  matrixRoomId: string,
  newName: string,
): Promise<void> {
  await client.sendStateEvent(matrixRoomId, "m.room.name" as any, { name: newName }, "");
  await client.sendStateEvent(matrixRoomId, "org.hailfreq.net.name" as any, { value: newName }, "");
}

/**
 * Delete a net. Matrix has no native delete — the convention is for the admin to
 * leave the room and forget it. Other members can still see it until they leave.
 * For a full "tombstone" approach we'd send an m.room.tombstone event.
 */
export async function deleteNet(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<void> {
  // Send a tombstone event so other clients can hide the room
  await client.sendStateEvent(
    matrixRoomId,
    "m.room.tombstone" as any,
    { body: "Net deleted by admin", replacement_room: "" },
    "",
  );
  // The admin leaves; remaining members will see the tombstone and can leave too
  await client.leave(matrixRoomId);
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/nets.ts
git commit -m "client(matrix): admin helpers for rename + delete nets (tombstone)"
```

---

## Task 6: Member admin actions

**Files:**
- Create: `client/src/renderer/matrix/memberActions.ts`

Helpers for invite/remove/promote/demote/ban operations.

- [ ] **Step 1: Write `client/src/renderer/matrix/memberActions.ts`**

```ts
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
  // matrix-js-sdk provides client.setPowerLevel for this
  const room = client.getRoom(matrixRoomId);
  const currentPlState = room?.currentState.getStateEvents("m.room.power_levels", "")?.getContent();
  await client.setPowerLevel(matrixRoomId, userId, level, currentPlState as any);
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
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/memberActions.ts
git commit -m "client(matrix): member admin actions (invite/kick/PL/server-ban)"
```

---

## Task 7: Find-user-by-Matrix-ID search

**Files:**
- Create: `client/src/renderer/matrix/userSearch.ts`

To invite a member you need their Matrix user ID. The Matrix client API has `/user_directory/search` for this.

- [ ] **Step 1: Write `client/src/renderer/matrix/userSearch.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";

export interface UserSearchResult {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function searchUsers(
  client: MatrixClient,
  searchTerm: string,
  limit = 10,
): Promise<UserSearchResult[]> {
  if (!searchTerm.trim()) return [];
  const url = `${client.getHomeserverUrl()}/_matrix/client/v3/user_directory/search`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search_term: searchTerm, limit }),
  });
  if (!resp.ok) return [];
  const body = (await resp.json()) as {
    results?: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
  };
  return (body.results ?? []).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name || r.user_id,
    avatarUrl: r.avatar_url ?? null,
  }));
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -3
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/userSearch.ts
git commit -m "client(matrix): user directory search for invite-to-net flow"
```

---

## Task 8: AdminBoard screen — layout skeleton

**Files:**
- Create: `client/src/renderer/screens/AdminBoard.tsx`

The three-pane layout from spec §6.2: net list left, member roster center, operator detail right. This task lays down the structure; subsequent tasks fill in the panels and wire actions.

- [ ] **Step 1: Write `client/src/renderer/screens/AdminBoard.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { listNets, subscribeToNetsChanges, type NetSummary } from "../matrix/nets";
import { buildRoster, subscribeToRosterChanges, type RosterMember } from "../matrix/roster";
import { detectAdminCapabilities, type AdminCapabilities } from "../matrix/permissions";
import { Button } from "../components/Button";

interface AdminBoardProps {
  client: MatrixClient;
  onClose: () => void;
}

export function AdminBoard({ client, onClose }: AdminBoardProps) {
  const [nets, setNets] = useState<NetSummary[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [caps, setCaps] = useState<AdminCapabilities | null>(null);
  const [selectedNetId, setSelectedNetId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const currentNets = listNets(client);
      setNets(currentNets);
      setRoster(buildRoster(client, currentNets));
    };
    refresh();
    const unsubNets = subscribeToNetsChanges(client, refresh);
    const unsubRoster = subscribeToRosterChanges(client, refresh);
    void detectAdminCapabilities(client).then(setCaps);
    return () => {
      unsubNets();
      unsubRoster();
    };
  }, [client]);

  if (!caps) {
    return <div className="flex h-full items-center justify-center"><p className="text-sm text-slate-400">Loading admin board…</p></div>;
  }

  if (!caps.isAnyAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-slate-300">You don't have admin permissions on any net.</p>
        <p className="text-xs text-slate-500">Power level 100 is required.</p>
        <Button variant="ghost" onClick={onClose}>Back</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-400">Admin Board</h1>
          <p className="text-xs text-slate-500">
            {nets.length} nets · {roster.length} operators
            {caps.isServerAdmin && " · Server admin"}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>Back to Home</Button>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr_300px] overflow-hidden">
        <div className="overflow-auto border-r border-slate-800">
          {/* Net list panel — Task 9 */}
          <div className="p-3 text-sm text-slate-400">Net list (Task 9)</div>
        </div>
        <div className="overflow-auto">
          {/* Roster panel — Task 10 */}
          <div className="p-3 text-sm text-slate-400">Roster (Task 10)</div>
        </div>
        <div className="overflow-auto border-l border-slate-800">
          {/* Detail panel — Task 11 */}
          <div className="p-3 text-sm text-slate-400">Detail (Task 11)</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/AdminBoard.tsx
git commit -m "client: AdminBoard screen scaffold with three-pane layout"
```

---

## Task 9: Net list panel (left pane)

**Files:**
- Create: `client/src/renderer/components/AdminNetList.tsx`
- Modify: `client/src/renderer/screens/AdminBoard.tsx` (wire it in)

Lists all visible nets with: color dot, name, priority badge, member count, active count. Click to select. + button to open CreateNetDialog.

- [ ] **Step 1: Write `client/src/renderer/components/AdminNetList.tsx`**

```tsx
import { useState } from "react";
import type { NetSummary } from "../matrix/nets";
import type { MatrixClient } from "matrix-js-sdk";
import { CreateNetDialog } from "./CreateNetDialog";

interface AdminNetListProps {
  client: MatrixClient;
  nets: NetSummary[];
  selectedNetId: string | null;
  onSelect: (matrixRoomId: string) => void;
}

export function AdminNetList({ client, nets, selectedNetId, onSelect }: AdminNetListProps) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Nets</span>
        <button
          onClick={() => setCreating(true)}
          title="Create net"
          className="rounded border border-dashed border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-brand-400 hover:text-brand-400"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {nets.map((net) => {
          const selected = net.matrixRoomId === selectedNetId;
          return (
            <button
              key={net.matrixRoomId}
              onClick={() => onSelect(net.matrixRoomId)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                selected ? "bg-brand-500/15 text-brand-50" : "hover:bg-slate-800/50 text-slate-200"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: net.properties.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{net.properties.name}</div>
                <div className="text-xs text-slate-500">
                  P{net.properties.priority} · {net.memberCount} members
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {creating && (
        <CreateNetDialog
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(roomId) => {
            onSelect(roomId);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into AdminBoard.tsx**

Replace the "Net list (Task 9)" placeholder div with `<AdminNetList client={client} nets={nets} selectedNetId={selectedNetId} onSelect={setSelectedNetId} />`.

- [ ] **Step 3: Verify build + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/AdminNetList.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(admin): net list panel with selection + create-net"
```

---

## Task 10: Member roster panel (center pane)

**Files:**
- Create: `client/src/renderer/components/AdminRoster.tsx`
- Modify: `client/src/renderer/screens/AdminBoard.tsx` (wire it in)

Shows the full roster of operators. Each row: presence dot, display name, RSI-verified badge, per-net membership tags, squad-leader chip if applicable. Filterable by net (when a net is selected, show only members of that net + a "show all" toggle). Searchable.

- [ ] **Step 1: Write `client/src/renderer/components/AdminRoster.tsx`**

```tsx
import { useMemo, useState } from "react";
import type { NetSummary } from "../matrix/nets";
import type { RosterMember } from "../matrix/roster";

interface AdminRosterProps {
  roster: RosterMember[];
  nets: NetSummary[];
  filterNetId: string | null;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
}

export function AdminRoster({ roster, nets, filterNetId, selectedUserId, onSelect }: AdminRosterProps) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    let list = roster;
    if (filterNetId && !showAll) {
      list = list.filter((m) => m.joinedNets.has(filterNetId));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (m) => m.displayName.toLowerCase().includes(q) || m.userId.toLowerCase().includes(q),
      );
    }
    return list;
  }, [roster, filterNetId, showAll, query]);

  const netLookup = useMemo(() => {
    const m = new Map<string, NetSummary>();
    nets.forEach((n) => m.set(n.matrixRoomId, n));
    return m;
  }, [nets]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <input
          type="text"
          placeholder="Filter operators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
        />
        {filterNetId && (
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            All
          </label>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No operators match.</p>
        )}
        {filtered.map((m) => {
          const selected = m.userId === selectedUserId;
          const memberNets = Array.from(m.joinedNets).map((id) => netLookup.get(id)).filter(Boolean) as NetSummary[];
          const isSquadLead = Array.from(m.perNetPowerLevel.values()).some((pl) => pl >= 75 && pl < 100);
          const isAdmin = Array.from(m.perNetPowerLevel.values()).some((pl) => pl >= 100);
          return (
            <button
              key={m.userId}
              onClick={() => onSelect(m.userId)}
              className={`grid w-full grid-cols-[16px_1fr_auto] items-center gap-3 border-b border-slate-800 px-3 py-2 text-left text-sm transition-colors ${
                selected ? "bg-brand-500/10" : "hover:bg-slate-800/50"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  m.presence === "online"
                    ? "bg-emerald-400"
                    : m.presence === "unavailable"
                      ? "bg-amber-400"
                      : "bg-slate-600"
                }`}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-slate-100">{m.displayName}</span>
                  {m.rsiVerified && (
                    <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                      ✓ RSI
                    </span>
                  )}
                  {isAdmin && (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      ADMIN
                    </span>
                  )}
                  {isSquadLead && !isAdmin && (
                    <span className="rounded bg-brand-900/40 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                      SQUAD LEAD
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">{m.userId}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {memberNets.slice(0, 3).map((net) => (
                  <span
                    key={net.matrixRoomId}
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{ backgroundColor: `${net.properties.color}30`, color: net.properties.color }}
                  >
                    {net.properties.name}
                  </span>
                ))}
                {memberNets.length > 3 && (
                  <span className="text-[10px] text-slate-500">+{memberNets.length - 3}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into AdminBoard.tsx**

Replace the "Roster (Task 10)" placeholder with `<AdminRoster roster={roster} nets={nets} filterNetId={selectedNetId} selectedUserId={selectedUserId} onSelect={setSelectedUserId} />`.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/AdminRoster.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(admin): member roster panel with filter + search"
```

---

## Task 11: Operator detail panel (right pane)

**Files:**
- Create: `client/src/renderer/components/AdminDetail.tsx`
- Modify: `client/src/renderer/screens/AdminBoard.tsx` (wire it in)

Right pane shows the selected operator's full state and exposes admin actions: assign to net, remove from net, promote/demote, disconnect from voice, ban from server.

- [ ] **Step 1: Write `client/src/renderer/components/AdminDetail.tsx`**

The full component is moderately long. Structure:
- Header with name + RSI badge
- Section: "Assigned nets" — list with per-net PL, remove button per row, "+ Assign to net" button (opens net picker)
- Section: "Actions" — promote/demote (per-net), disconnect from voice, ban from server

```tsx
import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import type { NetSummary } from "../matrix/nets";
import type { RosterMember } from "../matrix/roster";
import type { AdminCapabilities } from "../matrix/permissions";
import { Button } from "./Button";
import { inviteToNet, kickFromNet, setPowerLevel, banFromServer } from "../matrix/memberActions";
import { kickFromVoice } from "../voice/auth";
import { authBaseUrlFromHomeserver } from "../voice/auth";

interface AdminDetailProps {
  client: MatrixClient;
  member: RosterMember | null;
  nets: NetSummary[];
  caps: AdminCapabilities;
}

export function AdminDetail({ client, member, nets, caps }: AdminDetailProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState(false);
  const [assigning, setAssigning] = useState(false);

  if (!member) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        Select an operator to see details + actions.
      </div>
    );
  }

  async function runAction(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const adminableNets = nets.filter((n) => caps.adminNets.has(n.matrixRoomId));
  const notYetAssigned = adminableNets.filter((n) => !member.joinedNets.has(n.matrixRoomId));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 p-4">
        <h2 className="text-base font-semibold text-slate-100">{member.displayName}</h2>
        <p className="mt-1 text-xs text-slate-500">{member.userId}</p>
        {member.rsiVerified && (
          <p className="mt-1 text-xs text-emerald-300">✓ RSI verified · {member.rsiHandle ?? "—"}</p>
        )}
        <p className="mt-1 text-xs text-slate-500">Presence: {member.presence}</p>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned nets</h3>
          {member.joinedNets.size === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Not assigned to any net.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {Array.from(member.joinedNets).map((roomId) => {
                const net = nets.find((n) => n.matrixRoomId === roomId);
                if (!net) return null;
                const pl = member.perNetPowerLevel.get(roomId) ?? 0;
                const canAdmin = caps.adminNets.has(roomId);
                return (
                  <li key={roomId} className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: net.properties.color }} />
                      <span className="text-slate-200">{net.properties.name}</span>
                      <span className="text-xs text-slate-500">PL {pl}</span>
                    </div>
                    {canAdmin && (
                      <div className="flex gap-1">
                        {pl < 75 && (
                          <button
                            className="rounded border border-brand-700 px-2 py-0.5 text-[11px] text-brand-300 hover:bg-brand-700/20"
                            disabled={busy !== null}
                            onClick={() => runAction(`promote:${roomId}`, () => setPowerLevel(client, roomId, member.userId, 75))}
                          >
                            ↑ Sqd Lead
                          </button>
                        )}
                        {pl >= 75 && pl < 100 && (
                          <button
                            className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-700/30"
                            disabled={busy !== null}
                            onClick={() => runAction(`demote:${roomId}`, () => setPowerLevel(client, roomId, member.userId, 0))}
                          >
                            ↓ Demote
                          </button>
                        )}
                        <button
                          className="rounded border border-rose-800 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-800/20"
                          disabled={busy !== null}
                          onClick={() => runAction(`kick:${roomId}`, () => kickFromNet(client, roomId, member.userId, "Removed by admin"))}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {notYetAssigned.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setAssigning(true)}
                className="w-full rounded border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-brand-400 hover:text-brand-400"
              >
                + Assign to net…
              </button>
            </div>
          )}
        </section>

        <section className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Voice</h3>
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={async () => {
              // Disconnect from voice on every net where the requester is an admin
              for (const roomId of member.joinedNets) {
                if (!caps.adminNets.has(roomId)) continue;
                await runAction(`voiceKick:${roomId}`, async () => {
                  const token = client.getAccessToken();
                  if (!token) throw new Error("No access token");
                  await kickFromVoice({
                    hailfreqAuthBaseUrl: authBaseUrlFromHomeserver(client.getHomeserverUrl()),
                    matrixAccessToken: token,
                    matrixRoomId: roomId,
                    targetUserId: member.userId,
                  });
                });
              }
            }}
            className="mt-2 w-full"
          >
            ⚠ Disconnect from voice (chat unaffected)
          </Button>
        </section>

        {caps.isServerAdmin && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">Server admin</h3>
            {!confirmBan ? (
              <Button
                variant="ghost"
                className="mt-2 w-full !border-rose-800 !text-rose-300"
                disabled={busy !== null}
                onClick={() => setConfirmBan(true)}
              >
                ✗ Ban from server…
              </Button>
            ) : (
              <div className="mt-2 rounded border border-rose-800 bg-rose-950/20 p-3">
                <p className="text-xs text-rose-200">
                  Deactivate this account on Synapse. The user cannot authenticate again, cannot fetch
                  tokens, and is fully cut off from the server. Encrypted history they've already
                  decrypted on their devices is unaffected.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    className="!bg-rose-600 !text-white hover:!bg-rose-500"
                    disabled={busy !== null}
                    onClick={() => runAction("ban", () => banFromServer(client, member.userId))}
                  >
                    Confirm ban
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmBan(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="mt-4 rounded border border-rose-800 bg-rose-950/20 p-2 text-xs text-rose-200">
            {error}
          </div>
        )}
      </div>

      {assigning && (
        <NetPickerDialog
          client={client}
          nets={notYetAssigned}
          targetUserId={member.userId}
          onClose={() => setAssigning(false)}
        />
      )}
    </div>
  );
}

interface NetPickerDialogProps {
  client: MatrixClient;
  nets: NetSummary[];
  targetUserId: string;
  onClose: () => void;
}

function NetPickerDialog({ client, nets, targetUserId, onClose }: NetPickerDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign(net: NetSummary) {
    setBusy(true);
    setError(null);
    try {
      await inviteToNet(client, net.matrixRoomId, targetUserId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-80 rounded-lg border border-slate-800 bg-slate-900 p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-brand-400">Assign to net</h3>
        <ul className="mt-3 flex flex-col gap-1">
          {nets.map((net) => (
            <li key={net.matrixRoomId}>
              <button
                disabled={busy}
                onClick={() => handleAssign(net)}
                className="flex w-full items-center gap-2 rounded border border-slate-800 px-3 py-2 text-left text-sm hover:border-brand-500"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: net.properties.color }} />
                <span>{net.properties.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-3 text-right">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into AdminBoard.tsx**

Replace the "Detail (Task 11)" placeholder with:

```tsx
<AdminDetail
  client={client}
  member={selectedUserId ? roster.find((m) => m.userId === selectedUserId) ?? null : null}
  nets={nets}
  caps={caps}
/>
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/AdminDetail.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(admin): operator detail panel with all admin actions"
```

---

## Task 12: Net properties editor

**Files:**
- Create: `client/src/renderer/components/NetPropertiesEditor.tsx`
- Modify: `client/src/renderer/components/AdminNetList.tsx` (gear icon → opens editor)

When a net is selected and the user is admin in it, expose: rename, priority slider, color picker, delete.

- [ ] **Step 1: Write `client/src/renderer/components/NetPropertiesEditor.tsx`**

(Standard form modal with rename/priority/color and a "Delete net" danger button — uses renameNet, updateNetProperties, deleteNet from matrix/nets.ts.)

- [ ] **Step 2: Add a gear button to each net row in AdminNetList** (only when user is admin in that net) that opens the editor.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/NetPropertiesEditor.tsx client/src/renderer/components/AdminNetList.tsx
git commit -m "client(admin): net properties editor (rename/priority/color/delete)"
```

---

## Task 13: User search dialog for inviting unknown users

**Files:**
- Create: `client/src/renderer/components/UserSearchDialog.tsx`

The current NetPickerDialog only assigns members who are already in the roster (i.e., already in some visible net). To invite a member who isn't yet in any net we need a search-by-name flow.

- [ ] **Step 1: Write `client/src/renderer/components/UserSearchDialog.tsx`** — uses `searchUsers` from `matrix/userSearch.ts`. On selection, calls `inviteToNet`.

- [ ] **Step 2: Add a header button on AdminBoard** ("+ Invite user") that opens this dialog when a net is selected.

- [ ] **Step 3: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/UserSearchDialog.tsx client/src/renderer/screens/AdminBoard.tsx
git commit -m "client(admin): user search dialog for inviting unknown members"
```

---

## Task 14: Show CitizenID RSI verified status in roster

**Files:**
- Create: `client/src/renderer/matrix/profileCache.ts`
- Modify: `client/src/renderer/matrix/roster.ts` (look up rsiVerified from cache)

After a user logs in via CitizenID, we receive `rsi.profile` claims in the OIDC userinfo. The Hailfreq client can cache that per-user (mapping Matrix user ID → RSI handle + verified flag) by storing it as a Matrix profile state event when the user signs in. Other clients then read it from that user's Matrix profile.

For v1, simpler approach: each client publishes its OWN RSI info to a special profile state event in its own user account. Other clients query `/profile/<userId>/org.hailfreq.citizenid` to fetch the verified RSI handle.

- [ ] **Step 1: Write `client/src/renderer/matrix/profileCache.ts`**

```ts
import type { MatrixClient } from "matrix-js-sdk";

interface CitizenIdProfileClaim {
  rsiHandle?: string;
  rsiVerified?: boolean;
}

/** Publish the local user's CitizenID-derived RSI info to their Matrix profile (account-data). */
export async function publishOwnCitizenIdProfile(client: MatrixClient, claim: CitizenIdProfileClaim): Promise<void> {
  await client.setAccountData("org.hailfreq.citizenid" as any, claim);
}

/** Look up another user's published CitizenID profile (cached client-side). */
const cache = new Map<string, CitizenIdProfileClaim>();
export async function fetchCitizenIdProfile(client: MatrixClient, userId: string): Promise<CitizenIdProfileClaim | null> {
  if (cache.has(userId)) return cache.get(userId) ?? null;
  try {
    // Matrix account_data is private; for cross-user reads we'd need a profile field instead.
    // For v1 simplicity, store the claim in the user's profile presence content or in their
    // Matrix display name suffix. Alternative: each user publishes a public profile state
    // event using m.profile extensions.
    const url = `${client.getHomeserverUrl()}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${client.getAccessToken()}` },
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { "org.hailfreq.citizenid"?: CitizenIdProfileClaim };
    const claim = body["org.hailfreq.citizenid"] ?? null;
    if (claim) cache.set(userId, claim);
    return claim;
  } catch {
    return null;
  }
}
```

**Implementer note:** the Matrix spec doesn't formally support custom profile fields, but Synapse stores arbitrary keys in the profile JSON. If this approach doesn't work against the installed Synapse, fall back to storing the info in account-data (private to the user, can only be self-published) and adjusting the lookup pattern. For v1 of Plan 5, populating the cache by reading from CitizenID claims at login is sufficient even if cross-user lookup doesn't fully work — the roster's own rsiVerified flag stays false for other users until the cross-user lookup is settled.

- [ ] **Step 2: Wire into login flow**

In `client/src/renderer/screens/Login.tsx` (CitizenID success path), after `loginWithToken` succeeds, fetch the OIDC userinfo to extract the `rsi.profile` claim, then call `publishOwnCitizenIdProfile`.

(This requires accessing the OIDC userinfo endpoint with the access token — the implementer can wire this up via a small helper or skip the publish for v1 if the auth flow doesn't have the OIDC userinfo handy. The roster will still display the badge for the local user.)

- [ ] **Step 3: Wire `fetchCitizenIdProfile` calls into `buildRoster`** — for each member, attempt to look up their profile and populate `rsiVerified` + `rsiHandle`.

- [ ] **Step 4: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/profileCache.ts client/src/renderer/matrix/roster.ts client/src/renderer/screens/Login.tsx
git commit -m "client: CitizenID profile cache for RSI-verified badge in roster"
```

---

## Task 15: Header button in Home — open Admin Board

**Files:**
- Modify: `client/src/renderer/screens/Home.tsx`
- Modify: `client/src/renderer/AppState.tsx`

Add an "Admin" button to the Home header (visible only when `detectAdminCapabilities().isAnyAdmin` is true). Clicking opens the AdminBoard as a full-screen overlay (or routes via AppState's screen kind).

Simplest design: Home tracks a `showAdmin: boolean` state. When true, render `<AdminBoard onClose={() => setShowAdmin(false)} />` instead of the normal Home contents.

- [ ] **Step 1: Modify Home.tsx**

Add `const [adminCaps, setAdminCaps] = useState<AdminCapabilities | null>(null)` + `useEffect` to populate. Add `const [showAdmin, setShowAdmin] = useState(false)`. If `adminCaps?.isAnyAdmin`, render an "Admin" button in the header. When `showAdmin`, render `<AdminBoard client={client} onClose={() => setShowAdmin(false)} />` instead of the NetListPanel.

- [ ] **Step 2: Verify + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npm run build 2>&1 | tail -5
```

```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/Home.tsx
git commit -m "client(home): Admin button + full-screen AdminBoard overlay"
```

---

## Task 16: Unit tests for permissions + roster

**Files:**
- Create: `client/tests/unit/permissions.test.ts`
- Create: `client/tests/unit/roster.test.ts`

Light unit tests for the pure-data parts (PL detection, roster aggregation).

- [ ] **Step 1: Write `client/tests/unit/permissions.test.ts`**

Mock a MatrixClient with a `getRooms` that returns fake nets with various PLs. Verify `detectAdminCapabilities` correctly populates `isAnyAdmin`, `adminNets`, `squadLeaderNets`.

- [ ] **Step 2: Write `client/tests/unit/roster.test.ts`**

Mock nets + members. Verify `buildRoster` correctly aggregates per-net PL, joinedNets, presence.

- [ ] **Step 3: Run tests + commit**

```bash
cd /home/shreen/code/tactical-radio/client
npx vitest run 2>&1 | tail -10
# Expect: 16 previous + ~6 new = ~22 tests passing
```

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/unit/permissions.test.ts client/tests/unit/roster.test.ts
git commit -m "client(test): unit tests for permissions + roster aggregation"
```

---

## Task 17: E2E test for admin board (best-effort)

**Files:**
- Create: `client/tests/e2e/admin-board.spec.ts`

End-to-end test: provision two users (admin + regular), admin logs in, opens admin board, kicks regular user from a net, verifies the change.

The implementer should fall back to DONE_WITH_CONCERNS if the test infrastructure is too fragile for the full flow. The unit tests + manual verification cover the basics.

- [ ] **Step 1: Write the test scaffold**

(Same structure as Plan 4's voice E2E — multi-level acceptance. Level 1: admin can reach the admin board. Level 2: admin can click "Kick" on a member. Level 3: the kick state event is visible in Matrix.)

- [ ] **Step 2: Run + report**

```bash
cd /home/shreen/code/tactical-radio/client
npx playwright test admin-board 2>&1 | tail -15
```

- [ ] **Step 3: Commit**

```bash
cd /home/shreen/code/tactical-radio
git add client/tests/e2e/admin-board.spec.ts
git commit -m "client(e2e): admin board scaffold (best-effort, multi-level acceptance)"
```

---

## Task 18: Rebuild installers

```bash
cd /home/shreen/code/tactical-radio/client
npm run dist:linux 2>&1 | tail -5
npm run dist:windows 2>&1 | tail -5
ls -lh release/Hailfreq-*
```

No commit needed unless something broke.

---

## Task 19: README + spec markers

- [ ] **Step 1: Add to `client/README.md` feature list**:

```markdown
- Admin / squad-leader board (net management, member assignment, voice disconnect, server-level ban)
- RSI-verified badge from CitizenID surfaced in the roster
```

- [ ] **Step 2: Mark spec §6 as implemented**:

In `docs/superpowers/specs/2026-05-26-hailfreq-design.md` §6.3, add:

```markdown
**Implementation status:** Shipped in Plan 5. See `docs/superpowers/plans/2026-05-28-hailfreq-admin-board.md`.
```

- [ ] **Step 3: Commit**

```bash
git add client/README.md docs/superpowers/specs/2026-05-26-hailfreq-design.md
git commit -m "docs: admin board shipped; mark spec §6 as implemented in Plan 5"
```

---

## Task 20: Carry-forward cleanups from earlier reviews

Address the small backlog from Plans 3 + 4 final reviews:

- [ ] Wire `servers:setActive` IPC call inside `handleSelectServer` in AppState.tsx (Plan 3 review #3 — currently a dead channel)
- [ ] Delete the dead `FirstRun.tsx` and the unused `{ kind: "error" }` variant from the ServerInstance Screen union (Plan 3 review #5, #6)
- [ ] Add a JWT-expiry detection + re-fetch path in `VoiceEngine.ts` for sessions over 6 hours (Plan 4 review #7) — the simplest version: on `connectionStateChanged("disconnected")`, try a single re-monitor of all nets that were monitored at disconnect time
- [ ] Replace the 100ms blind sleep on `isBeingDecrypted()` in `sframeKeys.ts` and `keyRotationCoordinator.ts` with the SDK's `decrypted` event (Plan 4 review #5)
- [ ] Wire `window.__voiceEngine` test-mode hook in NetListPanel so the Plan 4 E2E can reach Level 2/3 (Plan 4 review #8)

```bash
cd /home/shreen/code/tactical-radio
git add -A
git commit -m "client(cleanup): carry-forward fixes from Plans 3 + 4 final reviews"
```

---

## Done

After Task 20, the v1 product is feature-complete per the original spec:

- A working admin / squad-leader board with all the actions from spec §6.2
- RSI-verified badges in the roster
- Server-side LiveKit kick endpoint
- All carry-forward cleanups landed
- 22+ unit tests passing
- E2E admin-board scaffold present (best-effort)

**Next plans:**

- **Plan 6** — Polish bundle: chirps + QR verification + drag-to-reorder + tray + OS notifications + UI polish (~12-15 tasks)
- **Plan 7** — Star Citizen integration: Game.log tailing + ship-net data model + auto-create + cross-client coordination via CitizenID lookup (~16-20 tasks) — needs Game.log path + sample snippet from you
- **Plan 8** — Focused-app PTT + screen sharing + Net Bridges (~15-18 tasks)
- **v1.5 design phase** — Multi-server voice (architectural design first, then a plan)
