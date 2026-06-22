export type HierarchyNodeType = "net" | "text" | "voice" | "strike-group" | "ship" | "circuit";

export interface HierarchyNode {
  id: string;
  name: string;
  type: HierarchyNodeType;
  children: HierarchyNode[];
  priority?: number; // For nets: sort priority
  isBroadcast?: boolean; // Broadcast nets (1MC, Fleet All-Hands)
  /** Parent net's Matrix room ID — set on text/voice channel nodes so the UI
   *  can look up LiveKit participants keyed by net ID. */
  netId?: string;
}

export interface LoungeSidebarState {
  ships: HierarchyNode[];
  yourNets: HierarchyNode[]; // monitored net bubbled to top
  availableToJoin: HierarchyNode[];
}

export interface OperationSidebarState {
  broadcastNets: HierarchyNode[];
  admiralsNet?: HierarchyNode;
  strikeGroups: HierarchyNode[];
}
