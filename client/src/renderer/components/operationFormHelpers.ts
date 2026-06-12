/**
 * Pure logic helpers for operation form validation and member filtering.
 * These have no React/DOM dependencies and are covered by Node-environment
 * unit tests in tests/unit/operationFormHelpers.test.ts.
 */

// ---------------------------------------------------------------------------
// validateOperationForm
// ---------------------------------------------------------------------------

export interface OperationFormInput {
  name: string;
  description: string;
  scheduledStart?: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validates the create-operation form fields.
 *
 * Rules:
 * - name: required, trimmed length 1–64 chars
 * - description: required, trimmed length 1–500 chars
 * - scheduledStart (optional): if present, must parse as a valid date that is
 *   strictly after `now` (defaults to `new Date()` for production use; pass
 *   an explicit value in tests for deterministic results)
 *
 * Returns { ok: true } on success, or { ok: false; errors: string[] } with
 * one error message per failing field. All fields are checked; errors are
 * accumulated rather than short-circuited.
 */
export function validateOperationForm(
  input: OperationFormInput,
  now: Date = new Date(),
): ValidationResult {
  const errors: string[] = [];

  // -- name --
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    errors.push("Name is required.");
  } else if (trimmedName.length > 64) {
    errors.push("Name must be 64 characters or fewer.");
  }

  // -- description --
  const trimmedDesc = input.description.trim();
  if (trimmedDesc.length === 0) {
    errors.push("Description is required.");
  } else if (trimmedDesc.length > 500) {
    errors.push("Description must be 500 characters or fewer.");
  }

  // -- scheduledStart (optional) --
  if (input.scheduledStart !== undefined) {
    const parsed = new Date(input.scheduledStart);
    if (isNaN(parsed.getTime())) {
      errors.push("Scheduled start must be a valid date and time.");
    } else if (parsed.getTime() <= now.getTime()) {
      errors.push("Scheduled start must be a future date and time.");
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// filterInvitableMembers
// ---------------------------------------------------------------------------

export interface InvitableMember {
  userId: string;
  displayName: string;
  alreadyInvited: boolean;
}

/**
 * Filters a member list by a search query and marks already-invited members.
 *
 * Behaviour:
 * - Matching is a case-insensitive substring check against EITHER `displayName`
 *   OR `userId`.
 * - An empty query matches all members.
 * - Already-invited members are NOT removed; they are included in results with
 *   `alreadyInvited: true` so the UI can render them as greyed-out.
 * - Input order is preserved.
 * - The input `members` array and its objects are never mutated.
 */
export function filterInvitableMembers(
  members: ReadonlyArray<{ userId: string; displayName: string }>,
  query: string,
  alreadyInvited: ReadonlySet<string>,
): InvitableMember[] {
  const normalizedQuery = query.toLowerCase();

  return members
    .filter((m) => {
      if (normalizedQuery === "") return true;
      return (
        m.displayName.toLowerCase().includes(normalizedQuery) ||
        m.userId.toLowerCase().includes(normalizedQuery)
      );
    })
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      alreadyInvited: alreadyInvited.has(m.userId),
    }));
}
