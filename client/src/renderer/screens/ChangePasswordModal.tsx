import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { validateNewPassword, mapPasswordChangeError } from "../matrix/passwordErrors";

interface Props {
  /** Performs the change; rejects with a Matrix/MatrixError on failure. */
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
  onClose: () => void;
}

export function ChangePasswordModal({ onSubmit, onClose }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    const v = validateNewPassword(next, confirm);
    if (v) { setError(v); return; }
    if (!current) { setError("Enter your current password"); return; }
    setBusy(true);
    setError("");
    try {
      await onSubmit(current, next);
      setDone(true);
    } catch (err) {
      setError(mapPasswordChangeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-brand-400">Change password</h2>
        {done ? (
          <>
            <p className="mt-3 text-sm text-green-400">Password changed. Use it next time you sign in.</p>
            <div className="mt-4">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3">
              <Input label="Current password" type="password" value={current}
                onChange={(e) => { setCurrent(e.target.value); setError(""); }} disabled={busy} autoFocus />
              <Input label="New password" type="password" value={next}
                onChange={(e) => { setNext(e.target.value); setError(""); }} disabled={busy} />
              <Input label="Confirm new password" type="password" value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }} disabled={busy}
                error={error} />
            </div>
            <div className="mt-4 flex gap-3">
              <Button onClick={() => void handleSave()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
