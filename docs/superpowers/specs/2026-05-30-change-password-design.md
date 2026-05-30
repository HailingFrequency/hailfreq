# In-App Change Password (per-server) — Design

**Date:** 2026-05-30
**Status:** Approved in brainstorming; pending implementation plan.

## Overview

Let a signed-in user change the password of their **local** Matrix account from inside the Hailfreq client, so test users (and any local-account user) never have to use a separate Matrix client (Element) for it. The client today has only a login screen — no signup and no change-password UI — so password changes currently require Element or an admin-side reset. This adds a "Change password" item to the per-server right-click menu that opens a small modal and calls Synapse's standard change-password flow.

Scoped to **local-password accounts only**: CitizenID/SSO accounts have no local password on the Hailfreq server (they manage it at `citizenid.space`), so the item is hidden for them.

## Goals

- A "Change password" entry in the server context menu, shown only for servers signed into with a local password (`ServerEntry.lastLoginMethod === "local"`).
- A modal (current password, new password, confirm) that changes the password via `MatrixClient.setPassword` with user-interactive auth.
- Clear, friendly error handling (wrong current password, server password policy rejection, mismatch).
- No password persisted by the client; the user re-enters their current password each time.

## Non-goals

- Self-service **registration / signup** (tracked separately under the CitizenID-onboarding feature).
- Pre-login / forgot-password reset via email (no email infra).
- Changing a CitizenID/SSO account's password.
- Admin-initiated reset of *another* user's password (that stays server-side; admins already have Deactivate in-app).

## Current state (anchors)

- `client/src/renderer/matrix/client.ts` — `loginWithPassword` (uses `m.login.password`); `getLoginFlows` → `supportsLocalPassword`. `MatrixClient.prototype.setPassword` is available (verified).
- `client/src/shared/types.ts:75` — `ServerEntry.lastLoginMethod: "" | "citizenid" | "local"`.
- `client/src/renderer/components/ServerContextMenu.tsx` — per-server menu (Rename, notifications, `onOpenScIntegration`); rendered from `client/src/renderer/components/Sidebar.tsx` (`contextMenuFor` state), the pattern this feature mirrors (incl. the SC-integration modal triggered the same way).
- The client does **not** cache the login password (it's passed transiently to encryption-setup only) — so the modal must collect the current password.

## Architecture / components

### Pure core (unit-tested) — `client/src/renderer/matrix/passwordErrors.ts` (new)
- `validateNewPassword(next: string, confirm: string): string | null` — returns an error string (`"Enter a new password"`, `"Passwords do not match"`) or `null` if OK. (Server enforces length/strength; we don't duplicate its policy.)
- `mapPasswordChangeError(err: unknown): string` — maps Synapse errors to friendly text: `M_FORBIDDEN` → "Current password is incorrect."; `M_PASSWORD_TOO_SHORT` / `M_WEAK_PASSWORD` / other `M_*` with a message → the server's `error` message; anything else → "Couldn't change password. Please try again."

### Matrix helper — `client/src/renderer/matrix/client.ts` (add)
- `changePassword(client: MatrixClient, userId: string, currentPassword: string, newPassword: string): Promise<void>` — calls:
  ```ts
  await client.setPassword(
    { type: "m.login.password", identifier: { type: "m.id.user", user: userId }, password: currentPassword },
    newPassword,
    false, // logoutDevices: keep other sessions logged in
  );
  ```

### Modal — `client/src/renderer/screens/ChangePasswordModal.tsx` (new)
- Fields: current password, new password, confirm new password (all `type="password"`). Save / Cancel. Mirrors the `ScIntegrationSettings` modal styling.
- On Save: run `validateNewPassword`; if it returns an error, show it inline and stop. Otherwise call the provided `onSubmit(current, next)`; on success close + surface a brief success toast/message; on rejection show `mapPasswordChangeError(err)` inline and keep the modal open.
- Props: `{ onSubmit: (current: string, next: string) => Promise<void>; onClose: () => void }`.

### Wire-up
- **`ServerContextMenu.tsx`** — add an optional `onChangePassword?: () => void` and render a "Change password" item when provided. Sidebar passes it **only** for local-login servers.
- **`Sidebar.tsx`** — add `changePasswordFor` state (mirrors `scIntegrationFor`); the context menu's "Change password" sets it; render `<ChangePasswordModal>` when set. Gate the menu item on `server.lastLoginMethod === "local"`. Thread an `onChangePassword(serverId, current, next)` prop from AppState.
- **`AppState.tsx`** — `handleChangePassword(serverId, current, next)` (useCallback): resolve that server's `MatrixClient` from `state.servers`, call `changePassword(client, client.getUserId()!, current, next)`. Let errors propagate to the modal (which maps them).

## Data flow

Right-click server → (if local) "Change password" → modal → Save → `validateNewPassword` → `handleChangePassword` → `changePassword` → `client.setPassword(authDict{current}, next, false)` → Synapse re-verifies current password (UIA) and sets the new one → success closes the modal; the new password is what the user signs in with next time.

## Error handling / edge cases

- **Wrong current password** → Synapse `M_FORBIDDEN` → "Current password is incorrect." (modal stays open).
- **New password rejected by server policy** → surface the server's error message verbatim.
- **New ≠ confirm / empty** → inline validation, no server call.
- **CitizenID/SSO server** → menu item not shown (no local password).
- **Network/unknown error** → generic "Couldn't change password. Please try again."
- `logoutDevices: false` — other sessions stay logged in (least disruptive; the client already uses fresh in-memory crypto per launch, so this avoids needless re-verification).
- Passwords are never logged and never persisted.

## Testing

- **Unit:** `validateNewPassword` (empty new, mismatch, OK); `mapPasswordChangeError` (M_FORBIDDEN, a policy error with message, unknown error); `changePassword` builds the correct auth dict + passes `newPassword` + `logoutDevices: false` (mock `MatrixClient.setPassword`).
- **Manual:** create a local test user → in-app right-click server → Change password → set a new one → re-login with the new password; wrong current password → friendly error; a CitizenID server shows no "Change password" item.

## Anticipated files

- **New:** `client/src/renderer/matrix/passwordErrors.ts` (+ unit test), `client/src/renderer/screens/ChangePasswordModal.tsx`.
- **Modified:** `client/src/renderer/matrix/client.ts` (`changePassword` helper + unit test), `client/src/renderer/components/ServerContextMenu.tsx` (gated item), `client/src/renderer/components/Sidebar.tsx` (modal state/render + prop threading + local-login gate), `client/src/renderer/AppState.tsx` (`handleChangePassword`).
