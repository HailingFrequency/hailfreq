# In-App Change Password (per-server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-server "Change password" item (right-click server menu, local-login accounts only) that changes the user's Synapse password via `MatrixClient.setPassword` user-interactive auth, from inside the Hailfreq client.

**Architecture:** A pure validation/error-mapping module + a thin matrix helper (`changePassword`) form the unit-tested core; a `ChangePasswordModal` (mirroring the existing per-server SC-integration modal) collects current/new/confirm and is opened from `ServerContextMenu` via Sidebar state, with `AppState` resolving the target server's `MatrixClient`.

**Tech Stack:** Electron + React + TypeScript, matrix-js-sdk 38.4.0 (`setPassword(authDict, newPassword, logoutDevices?)` — signature verified), Vitest (node env).

**Spec:** `/home/shreen/code/tactical-radio/docs/superpowers/specs/2026-05-30-change-password-design.md`

**Branch:** create `feat/change-password` off `master` at execution time. NOTE: the WASM dev-fix commit `ad1e387` currently lives only on `feat/citizenid-onboarding`; land that on master first (its own PR) so a `master`-based branch can run `npm run dev`. Do NOT branch while a dev server is running on `feat/citizenid-onboarding` (checking out master reverts `vite.config.ts`).

**Critical workflow note:** Do NOT run `npm run build` (emits stale `.js` shadowing `.ts`). Use `npx vitest run <file>` + `npx tsc --noEmit`. If tests act strange, `git clean -Xfd src`.

---

## File structure

- `client/src/renderer/matrix/passwordErrors.ts` (new) — pure: `validateNewPassword`, `mapPasswordChangeError`.
- `client/src/renderer/matrix/client.ts` (modify) — add `changePassword` helper.
- `client/src/renderer/screens/ChangePasswordModal.tsx` (new) — the modal UI.
- `client/src/renderer/components/ServerContextMenu.tsx` (modify) — gated "Change password" item.
- `client/src/renderer/components/Sidebar.tsx` (modify) — `changePasswordFor` state + modal render + prop threading.
- `client/src/renderer/AppState.tsx` (modify) — `handleChangePassword` + pass to `<Sidebar>`.
- Tests: `client/tests/unit/passwordErrors.test.ts`, `client/tests/unit/changePassword.test.ts`.

---

### Task 1: Pure validation + error mapping

**Files:**
- Create: `client/src/renderer/matrix/passwordErrors.ts`
- Test: `client/tests/unit/passwordErrors.test.ts`

- [ ] **Step 1: Write the failing test**

`client/tests/unit/passwordErrors.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateNewPassword, mapPasswordChangeError } from "@/renderer/matrix/passwordErrors";

describe("validateNewPassword", () => {
  it("rejects an empty new password", () => {
    expect(validateNewPassword("", "")).toBe("Enter a new password");
  });
  it("rejects a mismatch", () => {
    expect(validateNewPassword("abc", "abd")).toBe("Passwords do not match");
  });
  it("accepts a matching non-empty password", () => {
    expect(validateNewPassword("hunter2", "hunter2")).toBeNull();
  });
});

describe("mapPasswordChangeError", () => {
  it("maps M_FORBIDDEN to a current-password message", () => {
    expect(mapPasswordChangeError({ errcode: "M_FORBIDDEN" })).toBe("Current password is incorrect.");
  });
  it("surfaces the server's message for a policy rejection", () => {
    expect(mapPasswordChangeError({ errcode: "M_PASSWORD_TOO_SHORT", data: { error: "Password too short" } }))
      .toBe("Password too short");
  });
  it("falls back to a generic message for unknown errors", () => {
    expect(mapPasswordChangeError(new Error("network"))).toBe("Couldn't change password. Please try again.");
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `cd client && npx vitest run tests/unit/passwordErrors.test.ts`
Expected: FAIL — cannot resolve `@/renderer/matrix/passwordErrors`.

- [ ] **Step 3: Implement**

`client/src/renderer/matrix/passwordErrors.ts`:
```ts
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
```

- [ ] **Step 4: Run it (passes)**

Run: `cd client && npx vitest run tests/unit/passwordErrors.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**
```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/passwordErrors.ts client/tests/unit/passwordErrors.test.ts
git commit -m "feat(client): pure password validation + Matrix error mapping for change-password"
```

---

### Task 2: `changePassword` matrix helper

**Files:**
- Modify: `client/src/renderer/matrix/client.ts`
- Test: `client/tests/unit/changePassword.test.ts`

- [ ] **Step 1: Write the failing test**

`client/tests/unit/changePassword.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { changePassword } from "@/renderer/matrix/client";

describe("changePassword", () => {
  it("calls setPassword with the m.login.password auth dict, new password, logoutDevices=false", async () => {
    const setPassword = vi.fn().mockResolvedValue({});
    const client = { setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await changePassword(client, "@alice:rpk.chat", "oldpw", "newpw");
    expect(setPassword).toHaveBeenCalledWith(
      { type: "m.login.password", identifier: { type: "m.id.user", user: "@alice:rpk.chat" }, password: "oldpw" },
      "newpw",
      false,
    );
  });

  it("propagates the SDK rejection", async () => {
    const setPassword = vi.fn().mockRejectedValue({ errcode: "M_FORBIDDEN" });
    const client = { setPassword } as unknown as import("matrix-js-sdk").MatrixClient;
    await expect(changePassword(client, "@a:hs", "x", "y")).rejects.toMatchObject({ errcode: "M_FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run it (fails — export missing)**

Run: `cd client && npx vitest run tests/unit/changePassword.test.ts`
Expected: FAIL — `changePassword` is not exported.

- [ ] **Step 3: Implement (append to `client/src/renderer/matrix/client.ts`)**

```ts
/**
 * Change the local-account password for a signed-in client. Uses Matrix
 * user-interactive auth: the current password is submitted inline as an
 * m.login.password stage, so the user re-confirms it. logoutDevices=false
 * keeps other sessions signed in.
 */
export async function changePassword(
  client: import("matrix-js-sdk").MatrixClient,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await client.setPassword(
    { type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password: currentPassword },
    newPassword,
    false,
  );
}
```
(If `client.ts` already imports `MatrixClient` at the top, use the bare type instead of the inline `import("matrix-js-sdk").MatrixClient`.)

- [ ] **Step 4: Run it (passes)**

Run: `cd client && npx vitest run tests/unit/changePassword.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**
```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/matrix/client.ts client/tests/unit/changePassword.test.ts
git commit -m "feat(client): changePassword helper (setPassword via UIA, keep other sessions)"
```

---

### Task 3: ChangePasswordModal component

**Files:**
- Create: `client/src/renderer/screens/ChangePasswordModal.tsx`

Node test env has no DOM, so this UI component is verified by `tsc` + the manual test; its logic lives in the Task 1 helpers (already tested). Do NOT add a unit test for it.

- [ ] **Step 1: Write the component**

`client/src/renderer/screens/ChangePasswordModal.tsx`:
```tsx
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
```
(Confirm `Input` supports `type` + `error` props — `ServerContextMenu`/`ScIntegrationSettings` use `Input` with `label`/`error`; the Login screen uses `type="password"`, so both props exist.)

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**
```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/screens/ChangePasswordModal.tsx
git commit -m "feat(client): ChangePasswordModal (current/new/confirm + success state)"
```

---

### Task 4: Wire into context menu → Sidebar → AppState

**Files:**
- Modify: `client/src/renderer/components/ServerContextMenu.tsx`
- Modify: `client/src/renderer/components/Sidebar.tsx`
- Modify: `client/src/renderer/AppState.tsx`

- [ ] **Step 1: Add the gated menu item to `ServerContextMenu.tsx`**

Add to `Props` (after `onOpenScIntegration?`):
```tsx
  onChangePassword?: () => void;
```
Add it to the destructure list in the function signature: `..., onOpenScIntegration, onChangePassword }`.
In the `initial` menu (after the `onOpenScIntegration` block, before "Remove from Hailfreq…"), add — gated on a **local** login:
```tsx
              {onChangePassword && server.lastLoginMethod === "local" && (
                <Button variant="ghost" onClick={onChangePassword}>
                  Change password…
                </Button>
              )}
```

- [ ] **Step 2: Add modal state + render + prop in `Sidebar.tsx`**

Add the import:
```tsx
import { ChangePasswordModal } from "../screens/ChangePasswordModal";
```
Add to `SidebarProps`:
```tsx
  /** Change the local-account password for a server. */
  onChangePassword?: (serverId: string, currentPassword: string, newPassword: string) => Promise<void>;
```
Destructure `onChangePassword` in the `Sidebar({ ... })` signature.
Add state near `scIntegrationFor`:
```tsx
  const [changePasswordFor, setChangePasswordFor] = useState<ServerEntry | null>(null);
```
In the `<ServerContextMenu ... />` render, add the prop (mirrors `onOpenScIntegration`):
```tsx
          onChangePassword={
            onChangePassword
              ? () => {
                  setChangePasswordFor(contextMenuFor);
                  setContextMenuFor(null);
                }
              : undefined
          }
```
After the `{scIntegrationFor && ...}` modal block, add:
```tsx
      {changePasswordFor && onChangePassword && (
        <ChangePasswordModal
          onSubmit={(current, next) => onChangePassword(changePasswordFor.id, current, next)}
          onClose={() => setChangePasswordFor(null)}
        />
      )}
```

- [ ] **Step 3: Add `handleChangePassword` in `AppState.tsx` + pass to `<Sidebar>`**

Add a useCallback near the other server handlers (it imports `changePassword` from `./matrix/client` — add to that import):
```tsx
  const handleChangePassword = useCallback(
    async (serverId: string, currentPassword: string, newPassword: string): Promise<void> => {
      const client = stateRef.current.servers.get(serverId)?.handle?.client;
      if (!client) throw new Error("Not signed in to this server");
      const userId = client.getUserId();
      if (!userId) throw new Error("No user id for this server");
      await changePassword(client, userId, currentPassword, newPassword);
    },
    [],
  );
```
(Uses `stateRef.current` — confirm `stateRef` exists in AppState (it's used by other closures); if the local handler pattern uses `state.servers` directly with a dep, match that. `changePassword` errors propagate to the modal, which maps them.)
In the `<Sidebar ... />` JSX, add:
```tsx
        onChangePassword={handleChangePassword}
```

- [ ] **Step 4: Typecheck + full suite**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass (incl. Tasks 1–2 + prior suite).

- [ ] **Step 5: Commit**
```bash
cd /home/shreen/code/tactical-radio
git add client/src/renderer/components/ServerContextMenu.tsx client/src/renderer/components/Sidebar.tsx client/src/renderer/AppState.tsx
git commit -m "feat(client): wire Change password into server menu (local accounts only)"
```

---

## Final verification (after all tasks)

- [ ] `cd client && npx tsc --noEmit` — clean.
- [ ] `cd client && npx vitest run` — all pass (new `passwordErrors` + `changePassword` + prior suite).
- [ ] **Manual smoke (user-run, against a live server):** create a local test user (`register_new_matrix_user`), sign into Hailfreq, right-click the server → **Change password…** appears (it does NOT appear for a CitizenID server) → set a new password → success → sign out → sign in with the new password. Wrong current password → "Current password is incorrect." A too-short new password → the server's policy message.

## Self-review notes

- **Spec coverage:** gated per-server menu item (T4, local-only) ✓; modal current/new/confirm (T3) ✓; setPassword UIA + logoutDevices:false (T2) ✓; validation + friendly errors (T1) ✓; no password persisted (modal-local state, never stored) ✓; CitizenID hidden (T4 gate on `lastLoginMethod==="local"`) ✓.
- **Type consistency:** `onChangePassword(serverId, current, next)` signature identical across ServerContextMenu (no serverId — closure supplies it), Sidebar prop, AppState handler; `validateNewPassword`/`mapPasswordChangeError`/`changePassword` names consistent T1↔T3 and T2↔T4.
- **No placeholders:** all steps carry full code. Two "confirm X exists" notes (`Input` type/error props; `stateRef`) are verification cues, not unfinished code.
