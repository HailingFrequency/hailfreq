import type { MatrixClient } from "matrix-js-sdk";
import { OperationState } from "./operationTypes";
import type { Operation, Roster, RosterEntry } from "./operationTypes";

export const OPERATION_EVENT = "org.hailfreq.operation";
export const ROSTER_EVENT = "org.hailfreq.roster";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map raw state-event content to an Operation, given the room ID.
 * Does NOT validate that required fields are present — callers must guard.
 */
function contentToOperation(
  operationId: string,
  content: Record<string, unknown>,
): Operation {
  const knownStates = Object.values(OperationState) as string[];
  if (!knownStates.includes(String(content.state))) {
    throw new Error(`[operations] Unknown operation state: ${content.state}`);
  }

  return {
    id: operationId,
    name: String(content.name ?? ""),
    description: String(content.description ?? ""),
    state: content.state as OperationState,
    commanderId: String(content.commanderId ?? ""),
    scheduledStart: content.scheduledStart as string | undefined,
    actualStart: content.actualStart as string | undefined,
    actualEnd: content.actualEnd as string | undefined,
  };
}

/**
 * Reads the org.hailfreq.roster state event content from a room.
 * Returns the entries array (may be empty), or null if the event is absent.
 */
function readRosterEntries(
  client: MatrixClient,
  operationId: string,
): RosterEntry[] | null {
  const room = (client as any).getRoom(operationId);
  if (!room) return null;

  const ev = room.currentState.getStateEvents(ROSTER_EVENT, "");
  if (!ev) return null;

  const entries = ev.getContent().entries;
  if (!Array.isArray(entries)) return [];
  return entries as RosterEntry[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an E2EE Matrix Space representing a new operation.
 * Sets the org.hailfreq.operation state event with initial metadata.
 * Returns the new Operation.
 */
export async function createOperation(
  client: MatrixClient,
  name: string,
  description: string,
  scheduledStart?: string,
): Promise<Operation> {
  const commanderId = (client as any).getUserId() as string;
  const createdAt = new Date().toISOString();

  const opContent: Record<string, unknown> = {
    name,
    description,
    state: OperationState.PLANNING,
    commanderId,
    createdAt,
  };

  if (scheduledStart !== undefined) {
    opContent.scheduledStart = scheduledStart;
  }

  const create = await (client as any).createRoom({
    preset: "private_chat" as any,
    name,
    creation_content: { type: "m.space" },
    initial_state: [
      {
        type: "m.room.encryption",
        state_key: "",
        content: { algorithm: "m.megolm.v1.aes-sha2" },
      },
      {
        type: OPERATION_EVENT,
        state_key: "",
        content: opContent,
      },
    ],
  });

  const operationId: string = create.room_id;

  return contentToOperation(operationId, opContent);
}

/**
 * Fetch an operation's current metadata by room ID.
 * Throws a descriptive Error if the room is missing or carries no operation event.
 */
export async function getOperation(
  client: MatrixClient,
  operationId: string,
): Promise<Operation> {
  const room = (client as any).getRoom(operationId);
  if (!room) {
    throw new Error(
      `[operations] Room not found for operation id: ${operationId}`,
    );
  }

  const ev = room.currentState.getStateEvents(OPERATION_EVENT, "");
  if (!ev) {
    throw new Error(
      `[operations] Room ${operationId} is missing the ${OPERATION_EVENT} state event`,
    );
  }

  return contentToOperation(operationId, ev.getContent() as Record<string, unknown>);
}

/**
 * Synchronously scan all joined rooms and return those carrying the
 * org.hailfreq.operation state event, mapped to Operation objects.
 */
export function listOperations(client: MatrixClient): Operation[] {
  const rooms = (client as any).getRooms() as any[];
  const ops: Operation[] = [];

  for (const room of rooms) {
    const ev = room.currentState.getStateEvents(OPERATION_EVENT, "");
    if (!ev) continue;
    ops.push(contentToOperation(room.roomId as string, ev.getContent() as Record<string, unknown>));
  }

  return ops;
}

/**
 * Transition the operation's state. Sets:
 *   - actualStart (ISO now) when transitioning → ACTIVE (only if not already set)
 *   - actualEnd   (ISO now) when transitioning → COMPLETED
 * Existing actualStart is preserved when completing.
 */
export async function updateOperationState(
  client: MatrixClient,
  operationId: string,
  newState: OperationState,
): Promise<void> {
  const room = (client as any).getRoom(operationId);
  if (!room) {
    throw new Error(
      `[operations] Room not found for operation id: ${operationId}`,
    );
  }

  const ev = room.currentState.getStateEvents(OPERATION_EVENT, "");
  if (!ev) {
    throw new Error(
      `[operations] Room ${operationId} is missing the ${OPERATION_EVENT} state event`,
    );
  }

  const current = ev.getContent() as Record<string, unknown>;
  const now = new Date().toISOString();

  // Build updated content immutably
  const updated: Record<string, unknown> = { ...current, state: newState };

  if (newState === OperationState.ACTIVE && !updated.actualStart) {
    updated.actualStart = now;
  }

  if (newState === OperationState.COMPLETED) {
    updated.actualEnd = now;
    // Preserve existing actualStart — do NOT overwrite
    if (current.actualStart) {
      updated.actualStart = current.actualStart;
    }
  }

  await (client as any).sendStateEvent(
    operationId,
    OPERATION_EVENT as any,
    updated,
    "",
  );
}

/**
 * Read the current roster for an operation.
 * Returns { operationId, entries: [] } if the state event is absent or the
 * room cannot be resolved.
 */
export function getRoster(client: MatrixClient, operationId: string): Roster {
  const room = (client as any).getRoom(operationId);
  if (!room) {
    return { operationId, entries: [] };
  }

  const ev = room.currentState.getStateEvents(ROSTER_EVENT, "");
  if (!ev) {
    return { operationId, entries: [] };
  }

  const entries = ev.getContent().entries;
  return {
    operationId,
    entries: Array.isArray(entries) ? (entries as RosterEntry[]) : [],
  };
}

/**
 * Add a new entry to the operation's roster.
 * Rejects with a descriptive Error if the userId is already present.
 *
 * NOTE: This is a read-modify-write operation on a Matrix state event; concurrent writers will silently lose updates; a single admin writer is assumed.
 */
export async function addRosterEntry(
  client: MatrixClient,
  operationId: string,
  entry: RosterEntry,
): Promise<void> {
  const existing = readRosterEntries(client, operationId) ?? [];

  const duplicate = existing.find((e) => e.userId === entry.userId);
  if (duplicate) {
    throw new Error(
      `[operations] User ${entry.userId} is already in the roster for operation ${operationId}`,
    );
  }

  // Immutably build new entries array
  const newEntries = [...existing, entry];

  await (client as any).sendStateEvent(
    operationId,
    ROSTER_EVENT as any,
    { entries: newEntries },
    "",
  );
}

/**
 * Update specific fields on a roster entry identified by userId.
 * Throws a descriptive Error if the userId is not found in the roster.
 * Builds a new array/object — does not mutate existing data.
 *
 * NOTE: This is a read-modify-write operation on a Matrix state event; concurrent writers will silently lose updates; a single admin writer is assumed.
 */
export async function updateRosterEntry(
  client: MatrixClient,
  operationId: string,
  userId: string,
  updates: Partial<RosterEntry>,
): Promise<void> {
  const existing = readRosterEntries(client, operationId) ?? [];

  const idx = existing.findIndex((e) => e.userId === userId);
  if (idx === -1) {
    throw new Error(
      `[operations] User ${userId} not found in the roster for operation ${operationId}`,
    );
  }

  // Immutably build new entries: copy array, replace matching entry
  const newEntries = existing.map((entry, i) =>
    i === idx ? { ...entry, ...updates } : { ...entry },
  );

  await (client as any).sendStateEvent(
    operationId,
    ROSTER_EVENT as any,
    { entries: newEntries },
    "",
  );
}

/**
 * Invite a list of users to the operation Space.
 * For each user:
 *   - Calls client.invite(operationId, userId)
 *   - Adds a pending roster entry (userName from profile if cheaply available)
 *
 * Continues on per-user failure, logs each failure, then throws an aggregate
 * Error listing all failed user IDs if any failed.
 */
export async function inviteToOperation(
  client: MatrixClient,
  operationId: string,
  userIds: string[],
): Promise<void> {
  const failures: string[] = [];

  for (const userId of userIds) {
    try {
      // Skip users that are already in the roster — re-inviting is a no-op on
      // Matrix, but addRosterEntry would throw; silently skip instead.
      const existingEntries = readRosterEntries(client, operationId) ?? [];
      if (existingEntries.some((e) => e.userId === userId)) {
        console.debug(
          `[operations] Skipping invite for ${userId} — already in roster for operation ${operationId}`,
        );
        continue;
      }

      // Attempt to get display name cheaply; fall back to userId on any error
      let userName = userId;
      try {
        const profile = await (client as any).getProfileInfo(userId);
        if (profile?.displayname) {
          userName = profile.displayname as string;
        }
      } catch {
        // Non-critical — use userId as fallback
      }

      // Invite the user to the Matrix Space
      await (client as any).invite(operationId, userId);

      // Add a pending roster entry
      const entry: RosterEntry = {
        userId,
        userName,
        strikeGroupId: "",
        shipId: "",
        circuitId: "",
        role: "",
        status: "pending",
      };

      // Intentionally re-read the roster each iteration to pick up prior writes
      await addRosterEntry(client, operationId, entry);
    } catch (err) {
      console.error(
        `[operations] Failed to invite ${userId} to operation ${operationId}:`,
        err,
      );
      failures.push(userId);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[operations] Failed to invite the following users to operation ${operationId}: ${failures.join(", ")}`,
    );
  }
}
