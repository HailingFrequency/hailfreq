/**
 * Pure helpers for the change-password modal: client-side validation and
 * mapping Synapse/MatrixError shapes to user-friendly messages. No SDK import
 * (duck-typed) so they unit-test in the node environment.
 */

/** Returns an error string, or null if the new password is acceptable client-side. */
export function validateNewPassword(next: string, confirm: string): string | null {
  if (!next) return "Enter a new password";
  if (next !== confirm) return "Passwords do not match";
  return null;
}

interface MatrixishError {
  errcode?: string;
  data?: { error?: string };
}

/** Map a setPassword rejection to a friendly message. */
export function mapPasswordChangeError(err: unknown): string {
  const e = (err ?? {}) as MatrixishError;
  if (e.errcode === "M_FORBIDDEN") return "Current password is incorrect.";
  // Server policy message (e.g. too short / weak), capped so a malformed/hostile
  // homeserver can't flood the UI; trimmed so a whitespace-only error falls through.
  const serverMsg = e.data?.error?.trim();
  if (e.errcode && serverMsg) return serverMsg.slice(0, 200);
  return "Couldn't change password. Please try again.";
}
