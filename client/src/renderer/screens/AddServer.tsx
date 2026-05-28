import type { ServerEntry } from "@shared/types";

interface Props {
  onAdded: (e: ServerEntry) => void;
  onCancel?: () => void;
  cancellable: boolean;
}

export function AddServer(_props: Props) {
  return <div className="p-6">AddServer (Task 6)</div>;
}
