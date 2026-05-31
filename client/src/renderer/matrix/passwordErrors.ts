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
  if (e.errcode && e.data?.error) return e.data.error; // server policy message (e.g. too short / weak)
  return "Couldn't change password. Please try again.";
}
