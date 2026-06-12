export type HierarchyNodeType = "net" | "text" | "voice" | "strike-group" | "ship" | "circuit";

export interface HierarchyNode {
  id: string;
  name: string;
  type: HierarchyNodeType;
  children: HierarchyNode[];
  priority?: number; // For nets: sort priority
  isBroadcast?: boolean; // Broadcast nets (1MC, Fleet All-Hands)
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
