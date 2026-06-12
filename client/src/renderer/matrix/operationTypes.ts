export enum OperationState {
  PLANNING = "planning",
  ACTIVE = "active",
  COMPLETED = "completed",
  ARCHIVED = "archived",
}

export interface Operation {
  id: string; // Matrix Space ID
  name: string;
  description: string;
  state: OperationState;
  commanderId: string;
  scheduledStart?: string; // ISO timestamp
  actualStart?: string;
  actualEnd?: string;
}

export type RosterEntryStatus = "pending" | "assigned" | "joined";

export interface RosterEntry {
  userId: string;
  userName: string;
  strikeGroupId: string;
  shipId: string;
  circuitId: string; // Channel ID they're assigned to
  /** Free-form position title (e.g., "Helm Operator", "Captain"). */
  role: string;
  status: RosterEntryStatus;
}

export interface Roster {
  operationId: string;
  entries: RosterEntry[];
}
