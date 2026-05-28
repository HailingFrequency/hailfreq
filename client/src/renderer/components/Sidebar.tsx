import type { ServerEntry } from "@shared/types";

interface Props {
  servers: ServerEntry[];
  activeServerId: string;
  onSelect: (id: string) => void;
  onAddClicked: () => void;
}

export function Sidebar(_props: Props) {
  return <aside className="w-20 border-r border-slate-800">Sidebar (Task 7)</aside>;
}
