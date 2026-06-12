import type { Operation } from "../matrix/operationTypes";
import { OperationState } from "../matrix/operationTypes";
import { sortOperationsForSelector, operationStateBadge, abbreviateOpName } from "./sidebarModeHelpers";

export type SidebarMode = "lounge" | "ops";

export interface ModeTabBarProps {
  mode: SidebarMode;
  onSetMode: (mode: SidebarMode) => void;
  operations: Operation[];
  selectedOperationId: string | null;
  onSelectOperation: (id: string) => void;
  onCreateOperation: () => void;
}

/**
 * Rail-width mode tab bar (~60 px wide).
 *
 * Renders two stacked icon tab buttons:
 *   🏠 Lounge
 *   ⚡ Ops
 *
 * When mode === 'ops', also renders the operation list below the tabs.
 * The list is ALWAYS shown (even when there is only one operation).
 * Archived operations appear dimmed at the bottom.
 * A "＋ New Op" button is always rendered at the list foot.
 *
 * Operation chips show an abbreviated name (≤6 chars) with the full name
 * in the title attribute, following the pattern from ServerIcon.tsx.
 */
export function ModeTabBar({
  mode,
  onSetMode,
  operations,
  selectedOperationId,
  onSelectOperation,
  onCreateOperation,
}: ModeTabBarProps) {
  const sorted = sortOperationsForSelector(operations);
  const nonArchived = sorted.filter((op) => op.state !== OperationState.ARCHIVED);
  const archived = sorted.filter((op) => op.state === OperationState.ARCHIVED);

  return (
    <div className="flex w-16 flex-col items-center gap-1 border-r border-slate-800 bg-slate-950 py-2">
      {/* Lounge tab */}
      <button
        type="button"
        title="Lounge"
        onClick={() => onSetMode("lounge")}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-all",
          mode === "lounge"
            ? "bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/50"
            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
        ].join(" ")}
        aria-pressed={mode === "lounge"}
      >
        🏠
      </button>

      {/* Ops tab */}
      <button
        type="button"
        title="Operations"
        onClick={() => onSetMode("ops")}
        className={[
          "flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-all",
          mode === "ops"
            ? "bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/50"
            : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
        ].join(" ")}
        aria-pressed={mode === "ops"}
      >
        ⚡
      </button>

      {/* Operation list — only when Ops mode is active */}
      {mode === "ops" && (
        <div className="mt-1 flex w-full flex-col items-center gap-1 overflow-y-auto px-1">
          {/* Non-archived operations */}
          {nonArchived.map((op) => (
            <OperationChip
              key={op.id}
              operation={op}
              selected={op.id === selectedOperationId}
              dimmed={false}
              onSelect={onSelectOperation}
            />
          ))}

          {/* Archived operations — rendered dimmed at the bottom */}
          {archived.length > 0 && (
            <>
              {archived.map((op) => (
                <OperationChip
                  key={op.id}
                  operation={op}
                  selected={op.id === selectedOperationId}
                  dimmed={true}
                  onSelect={onSelectOperation}
                />
              ))}
            </>
          )}

          {/* New Op button */}
          <button
            type="button"
            onClick={onCreateOperation}
            title="New Operation"
            className="mt-1 flex h-8 w-10 items-center justify-center rounded border border-dashed border-slate-700 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-400"
          >
            ＋
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperationChip — one entry in the rail operation list
// ---------------------------------------------------------------------------

interface OperationChipProps {
  operation: Operation;
  selected: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
}

function OperationChip({ operation, selected, dimmed, onSelect }: OperationChipProps) {
  const badge = operationStateBadge(operation.state);
  const abbrev = abbreviateOpName(operation.name);

  return (
    <button
      type="button"
      title={operation.name}
      onClick={() => onSelect(operation.id)}
      className={[
        "flex w-10 flex-col items-center rounded-lg py-1.5 transition-all",
        selected
          ? "bg-brand-500/20 ring-1 ring-brand-500/50"
          : "hover:bg-slate-800",
        dimmed ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-selected={selected}
    >
      {/* Abbreviated name chip */}
      <span
        className={[
          "text-[0.55rem] font-bold leading-none tracking-tight",
          selected ? "text-brand-200" : "text-slate-300",
        ].join(" ")}
      >
        {abbrev}
      </span>
      {/* State badge dot */}
      <span
        className={`mt-0.5 rounded px-0.5 text-[0.45rem] font-semibold leading-tight ${badge.colorClass}`}
      >
        {badge.label.slice(0, 3)}
      </span>
    </button>
  );
}
