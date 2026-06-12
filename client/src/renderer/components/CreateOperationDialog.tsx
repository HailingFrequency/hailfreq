import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";
import { Input } from "./Input";
import { createOperation } from "../matrix/operations";
import type { Operation } from "../matrix/operationTypes";
import { validateOperationForm } from "./operationFormHelpers";

interface CreateOperationDialogProps {
  client: MatrixClient;
  open: boolean;
  onClose: () => void;
  onCreated: (operation: Operation) => void;
}

/**
 * Modal dialog for creating a new Operation (Hailfreq formal event).
 *
 * Follows the same overlay/form pattern as CreateNetDialog:
 * - Clicking the backdrop closes the dialog
 * - Submit is disabled while the request is in-flight
 * - Service errors are shown inline in user-friendly form (no stack traces)
 * - Field validation errors are shown per-field via the Input `error` prop
 */
export function CreateOperationDialog({
  client,
  open,
  onClose,
  onCreated,
}: CreateOperationDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function getFieldError(pattern: RegExp): string | undefined {
    const match = fieldErrors.find((e) => pattern.test(e));
    return match;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServiceError(null);

    const validation = validateOperationForm({
      name,
      description,
      scheduledStart: scheduledStart.trim() !== "" ? scheduledStart : undefined,
    });

    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors([]);
    setBusy(true);

    try {
      const operation = await createOperation(
        client,
        name.trim(),
        description.trim(),
        scheduledStart.trim() !== "" ? new Date(scheduledStart).toISOString() : undefined,
      );
      onCreated(operation);
      onClose();
    } catch (err) {
      setServiceError(
        err instanceof Error ? err.message : "Failed to create operation. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (!busy) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-[28rem] rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-brand-400">Create an operation</h2>
        <p className="mt-1 text-xs text-slate-500">
          A new encrypted Matrix Space representing a formal tactical event.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Name"
            placeholder="Operation Alpha, Exercise Bravo…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={getFieldError(/name/i)}
            autoFocus
            required
          />

          <Input
            label="Scheduled start (optional)"
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            error={getFieldError(/scheduled|date|start|future|past/i)}
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-300">Description</span>
            <textarea
              placeholder="Objectives, area of operations, notes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none resize-none"
            />
            {getFieldError(/description/i) && (
              <span className="text-xs text-rose-400">{getFieldError(/description/i)}</span>
            )}
          </label>

          {serviceError && (
            <p className="text-xs text-rose-400">{serviceError}</p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={!name.trim() || !description.trim() || busy}>
            {busy ? "Creating…" : "Create operation"}
          </Button>
          <Button type="button" variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
