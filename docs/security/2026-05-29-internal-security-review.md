# Hailfreq — Internal Security Review

> ⚠️ **CONFIDENTIAL — DO NOT COMMIT TO THE PUBLIC REPO UNTIL C1 & C2 ARE FIXED.**
> This document describes two **unpatched critical vulnerabilities** with enough
> detail to exploit them. The `docs/security/` directory has been added to
> `.gitignore` to prevent accidental publication of the public AGPL repository.

| | |
|---|---|
| **Date** | 2026-05-29 |
| **Repo** | HailingFrequency/hailfreq @ `master` (commit `503e1a5`) |
| **Reviewer** | Claude Code (manual + multi-agent review), complementing Intercept |
| **Scope** | Electron client (`client/`), livekit-auth server + self-host kit (`server/`) |
| **Method** | Manual code review across 4 domains: Electron process/IPC, auth server + infra, E2EE/crypto/trust, input/injection/supply-chain. Two CRITICALs independently re-verified by reading the source. |

## Why this complements Intercept / Snyk

Intercept ran signature/CVE scanners (opengrep SAST, grype SBOM, trivy, checkov)
and the repo is clean against them. Snyk will cover similar ground (dependency
CVEs, some SAST, IaC). **Neither class of tool can find the two most serious
issues below** — they are *logic / trust-boundary / runtime-config* flaws:

- **C1** is a missing authorization check on a trust boundary (who is allowed to
  set the voice-encryption key). No CVE, no taint-flow signature.
- **C2** is a Docker Compose variable-interpolation vs. secret-source mismatch
  that only manifests at deploy time.

Use this report alongside the automated scans, not instead of them.

---

## Severity summary

| ID | Severity | Title | Component | Verified |
|----|----------|-------|-----------|----------|
| C1 | 🔴 CRITICAL | Any net member can hijack the SFrame voice-encryption key | client (voice) | ✅ source-confirmed |
| C2 | 🔴 CRITICAL | v0.3 kit: LiveKit & coturn boot with empty secrets | server (compose) | ✅ source-confirmed |
| H1 | 🟠 HIGH | `shell.openExternal` scheme not validated | client (main/oidc) | ✅ |
| H2 | 🟠 HIGH | `serverId` path traversal in token IPC | client (main/tokens) | ✅ (2 agents) |
| H3 | 🟠 HIGH | No rate limiting on `/token` & `/kick` | server (livekit-auth) | ✅ |
| H4 | 🟠 HIGH | CORS wildcard incl. privileged `/kick` | server (livekit-auth) | ✅ |
| H5 | 🟠 HIGH | `/_synapse/admin/*` exposed to public internet | server (Caddy) | ✅ |
| M1 | 🟡 MEDIUM | `sandbox:false`, no Electron fuses | client (main/window) | ✅ (2 agents) |
| M2 | 🟡 MEDIUM | No Content-Security-Policy on renderer | client | ✅ |
| M3 | 🟡 MEDIUM | `will-navigate` allows any `file://` | client (main/index) | ✅ |
| M4 | 🟡 MEDIUM | LiveKit JWT 6h TTL (re-entry after kick) | server (livekit-auth) | ✅ |
| M5 | 🟡 MEDIUM | `/kick` target not validated as MXID | server (livekit-auth) | ✅ |
| M6 | 🟡 MEDIUM | `rsiVerified` self-published / spoofable | client (matrix) | ✅ (UI-only today) |
| M7 | 🟡 MEDIUM | `restoreFromRecoveryKey` takes first SSSS key id | client (matrix/crypto) | ✅ |
| M8 | 🟡 MEDIUM | Test runner needs real Synapse shared secret, undocumented | server (tests) | ✅ |
| M9 | 🟡 MEDIUM | LiveKit `:7880` host-bound, absent from firewall docs | server (compose/docs) | ✅ |
| L1 | 🟢 LOW | `HAILFREQ_TEST` not compiled out → token/cred exposure if set in prod | client | ✅ (2 agents) |
| L2 | 🟢 LOW | coturn `verbose` logs call metadata (privacy) | server (compose) | ✅ |
| L3 | 🟢 LOW | Federation endpoints reachable (version leak) | server (Caddy) | ✅ |
| L4 | 🟢 LOW | No log-line length cap before regex parse | client (sc) | ✅ |
| L5 | 🟢 LOW | SSO loopback server brief post-callback window | client (main/oidc) | ✅ (impact ~nil) |
| L6 | 🟢 LOW | Parsed SC values into room name unsanitized (no sink today) | client (matrix/nets) | ✅ |

---

## 🔴 CRITICAL

### C1 — Any net member can hijack the SFrame voice-encryption key (E2EE bypass)

**Files:** `client/src/renderer/voice/sframeKeys.ts` (`fetchSframeKey` L45-81, `listSframeKeys` L87-122), `client/src/renderer/voice/keyRotationCoordinator.ts` (`timelineHandler` L86-121)

**Issue.** Hailfreq distributes the SFrame media-encryption key as a Megolm-encrypted
timeline event (`org.hailfreq.net.sframe-key`) in the net's Matrix room. The
**generation/rotation** path correctly restricts who may *create* a key —
`keyRotationCoordinator.ts:70-71` returns early unless the local user is PL≥50.
But the **receive/adoption** path applies whatever it finds with **no sender
authorization check**:

- `timelineHandler` (L86-121) ignores only the user's *own* events
  (`event.getSender() === client.getSafeUserId()`, L94), then calls
  `listSframeKeys()` and adopts `latest` via `events.onNewKey(...)`.
- `listSframeKeys` (L87-122) and `fetchSframeKey` (L45-81) filter solely on
  `event type === SFRAME_KEY_EVENT` and `typeof content.key === "string"`.
  **Neither inspects the sender's power level.**

**Exploitability.** Any user who is a *member* of the net's Matrix room — including
the lowest privilege level (PL 0) — can `sendEvent("org.hailfreq.net.sframe-key", {key: <attacker-chosen>})`.
Because adoption picks the newest such event by timeline position, every other
participant's client silently switches its `ExternalE2EEKeyProvider` to the
attacker's key. The attacker then:
- knows the key all participants encrypt voice with → **passive eavesdrop**, or
- supplies a key others can't agree on → **denial of voice**.

This defeats the central privacy guarantee of the product. Threat actor = any
invited net member (an insider), not an anonymous internet attacker — but in a
guild with many PL-0 members, any one of them can compromise everyone's calls.

**Related (fold into the same fix):**
- *No decryption-failure guard.* After awaiting Megolm decryption, the code reads
  `getContent()` without checking `isDecryptionFailure()`. A server replaying an
  event with a stripped Megolm session, or a late-joiner, can feed
  garbage/undecryptable content into the adoption path.
- *Silent unencrypted fallback.* `VoiceEngine.ts:184-192` — if `fetchSframeKey`
  returns `null`, the client joins LiveKit with **no SFrame E2EE** and only a
  `console.warn`. An actor who can suppress key delivery downgrades the call to
  plaintext silently.

**Remediation.**
1. In `timelineHandler`, `fetchSframeKey`, and `listSframeKeys`, resolve the
   sender's power level and **ignore any key event from a sender with PL < 50**:
   ```ts
   const room = client.getRoom(roomId);
   const senderPl = room?.getMember(ev.getSender() ?? "")?.powerLevel ?? 0;
   if (senderPl < 50) continue; // or `return` in the single-event handler
   ```
2. Skip events where `ev.isDecryptionFailure()` is true.
3. Decide policy for "no key available": either block the connection or require
   explicit user confirmation before joining unencrypted; do not silently degrade.
4. Add unit tests: PL-0 sender key is rejected; PL-50 sender key is adopted;
   decryption-failure event is skipped.

---

### C2 — v0.3 server kit: LiveKit and coturn boot with empty secrets

**Files:** `server/compose.yml` — `livekit` service (L111-125, `configs: livekit_yaml` → `/etc/livekit.yaml`), `coturn` service (L127-140, `configs: turnserver_conf`), config blocks referencing `${LIVEKIT_API_KEY}` (L274, L291) and `${TURN_SHARED_SECRET}` (L310); Synapse's working pattern in `synapse_entrypoint` (L357-370).

**Issue.** Secrets are generated by the `bootstrap` service into the
`hailfreq-secrets` volume (`/run/secrets/...`), and the docs explicitly tell
operators *not* to put them in `.env`. Synapse consumes them correctly: its
`entrypoint.sh` reads `/run/secrets/*` and runs `envsubst` on a template at
container start (L364-370).

**LiveKit and coturn do not.** They receive their config via Docker Compose
`configs:` whose content contains `${LIVEKIT_API_KEY}`, `${LIVEKIT_API_SECRET}`,
`${TURN_SHARED_SECRET}`. Compose interpolates those from the **host environment
at `docker compose up` time** — *not* from the secrets volume. Following the
documented flow, the host env has no such variables, so Compose substitutes
**empty strings**. Neither service has an `entrypoint`/`envsubst` step to read the
generated secrets.

**Result on a by-the-docs v0.3 deploy:**
- LiveKit server starts with an empty `api_key`/`api_secret`. Tokens minted by
  `livekit-auth` (which signs with the *real* generated secret) won't validate →
  **all voice broken**, or LiveKit accepts an unauthenticated/empty-key config.
- coturn starts with an empty `static-auth-secret` → **TURN credential validation
  effectively disabled** (any credential matches), an open relay risk.

**Not currently exploited:** the live `rpk.chat` deployment runs the **v0.2**
multi-file kit, not this v0.3 single-file compose. v0.3 has only been
"structurally verified" (partial bring-up; full bring-up was blocked by local
port conflicts), so this was never exercised. It will hit the **first real v0.3
operator**.

**Remediation.** Give `livekit` and `coturn` the same treatment as Synapse: an
entrypoint that `cat`s `/run/secrets/*` into env vars and `envsubst`s a config
template at start (mount the secrets volume `:ro`). Alternatively, document
`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`TURN_SHARED_SECRET` as **required** host
`.env` entries — but the entrypoint approach matches the existing design and the
docs' promise.

---

## 🟠 HIGH

### H1 — `shell.openExternal` scheme not validated
**File:** `client/src/main/oidc.ts:27-33`, `client/src/main/ipc.ts:66-67`
`runSsoFlow` takes `homeserverUrl` from the renderer and builds `new URL(path, homeserverUrl)`, passing the result to `shell.openExternal`. `URL` accepts `file://`, `ftp://`, `http://` (rejects only `javascript:`). A compromised renderer can make the OS open arbitrary non-https URIs.
**Fix:** validate `new URL(homeserverUrl).protocol` is `https:` (or `http:` in dev) before use.

### H2 — `serverId` path traversal in token IPC *(2 agents)*
**File:** `client/src/main/tokens.ts:16-21`, IPC handlers `client/src/main/ipc.ts:60-64`
`serverId` (renderer-supplied, unvalidated) is interpolated into `path.join(credentialsDir(), \`${serverId}.enc\`)`. `..` segments escape the dir. A compromised renderer can `tokens:save` (write arbitrary `.enc`), `tokens:load` (read/decrypt arbitrary `.enc`), `tokens:clear` (delete arbitrary `.enc`/`.json`) outside the credentials directory. Normal callers pass a UUID, but nothing enforces it.
**Fix:** assert `serverId` matches a UUID regex before any token op (also closes part of the M1 blast radius).

### H3 — No rate limiting on `/token` & `/kick`
**File:** `server/livekit-auth/src/index.ts:44-161`
Each `/token` triggers 2 outbound Synapse calls; `/kick` triggers 3. No `express-rate-limit`, no Caddy rate-limit. A flood amplifies load on Synapse and the JWT signer.
**Fix:** add `express-rate-limit` (e.g. 20/min `/token`, 10/min `/kick` per IP).

### H4 — CORS wildcard including privileged `/kick`
**File:** `server/livekit-auth/src/index.ts:35-39`
`Access-Control-Allow-Origin: *` on all routes. Bearer auth prevents classic CSRF today, but any-origin readability is inconsistent with the privacy model and becomes dangerous if cookie auth is ever added.
**Fix:** restrict to known client origin(s); do not wildcard `/kick`.

### H5 — `/_synapse/admin/*` exposed to the public internet
**File:** `server/compose.yml` Caddy config (L217, L230)
Caddy proxies all `/_synapse/*`, including `/_synapse/admin/v1/register` (HMAC registration) and user-admin APIs. The shared secret is 256-bit (not brute-forceable), so not immediately exploitable, but the admin auth surface is needlessly internet-facing.
**Fix:** add a `handle /_synapse/admin/*` block restricting by `remote_ip` to the VPS/admin IPs, before the `/_synapse/*` catch-all.

---

## 🟡 MEDIUM

- **M1 — `sandbox:false`, no Electron fuses** (`client/src/main/window.ts:24`). Renderer runs without Chromium's OS sandbox (ESM-preload workaround). `contextIsolation`/`nodeIntegration` are correct, but a renderer compromise has a larger blast radius (see H1/H2). No `@electron/fuses` hardening in the build. **Fix:** compile preload as CJS and re-enable `sandbox:true`; add fuses (`RunAsNode:false`, `EnableCookieEncryption:true`, `EnableNodeOptionsEnvironmentVariable:false`).
- **M2 — No CSP on the renderer** (`client/src/renderer/index.html`; no `onHeadersReceived`). No layered defence if a Matrix-content sanitisation bypass appears. **Fix:** set a strict `Content-Security-Policy` via `session.defaultSession.webRequest.onHeadersReceived`.
- **M3 — `will-navigate` allows any `file://`** (`client/src/main/index.ts:70-71`). XSS-driven `location='file:///etc/passwd'` would load and could be exfiltrated. **Fix:** restrict to the app bundle path, or `preventDefault()` all navigation.
- **M4 — LiveKit JWT 6h TTL** (`server/livekit-auth/src/index.ts:89`). A kicked user can re-enter the LiveKit room with the still-valid token for up to 6h (no revocation). **Fix:** drop TTL to 15-30 min; clients re-mint.
- **M5 — `/kick` target not validated as MXID** (`index.ts:109-116`). Only truthiness checked before `removeParticipant`. **Fix:** validate `@localpart:domain`.
- **M6 — `rsiVerified` self-published / spoofable** (`client/src/renderer/matrix/profileCache.ts:18-21`, rendered in `AdminRoster.tsx:103`, `AdminDetail.tsx:52`). Any user can set `rsiVerified:true` on their own account-data. **Currently UI-only** (the `publishOwnCitizenIdProfile` call is commented out in `Login.tsx`), but the name implies trust. **Fix:** rename to `rsiHandleClaim` (unverified); never use for authz without server-side proof.
- **M7 — `restoreFromRecoveryKey` takes first SSSS key id** (`client/src/renderer/matrix/crypto.ts:255-261`). `Object.keys(keys)[0]` may be the wrong key when multiple SSSS keys exist → recovery DoS/misleading failure. **Fix:** match the expected key id explicitly.
- **M8 — Test runner needs the real Synapse shared secret, undocumented** (`server/tests/conftest.py:11,34`). `os.environ["SYNAPSE_REGISTRATION_SHARED_SECRET"]` read at import with no guidance and no guard against pointing at production. **Fix:** document safe extraction from the test volume; add a "never a production secret" guard.
- **M9 — LiveKit `:7880` host-bound, absent from firewall docs** (`server/compose.yml:116,262-263`; `docs/deployment.md`). `network_mode: host` + `0.0.0.0:7880`, but 7880 isn't listed as blocked. JWT-gated, but an unintended direct path bypassing Caddy. **Fix:** document "7880 — block, internal only".

---

## 🟢 LOW / INFORMATIONAL

- **L1 — `HAILFREQ_TEST` not compiled out** (`renderer/AppState.tsx:1198`, `NetListPanel.tsx:161`, `main/tokens.ts:30-32`). Runtime `process.env.HAILFREQ_TEST==="1"` (not defined in `vite.config.ts`, so not inlined). If ever set in a prod environment, it exposes `window.__matrixHandle` (incl. Matrix access token), `window.__voiceEngine`, and enables plaintext credential storage. **Fix:** `define: { 'process.env.HAILFREQ_TEST': '"0"' }` in prod builds, or use `import.meta.env.DEV`; assert it's unset when `app.isPackaged`.
- **L2 — coturn `verbose` logging** (`server/compose.yml:332`). Logs peer/client IPs and session timing — a who-talked-to-whom metadata trail for a privacy-first tool. **Fix:** remove `verbose` in prod or rotate with short retention.
- **L3 — Federation endpoints reachable** (`server/compose.yml` Caddy). `federation_domain_whitelist: []` blocks federation at Synapse, but `/_matrix/federation/*` still routes through and leaks version/existence. **Fix:** Caddy `handle /_matrix/federation/*` → 404 before the catch-all.
- **L4 — No log-line length cap** (`client/src/main/scLogTail.ts:65-68`). The five Game.log regexes were tested and are *not* ReDoS-vulnerable on V8/irregexp, but an unbounded line could grow the accumulation buffer. **Fix:** cap line length (e.g. 4096) before processing.
- **L5 — SSO loopback server brief post-callback window** (`client/src/main/oidc.ts:36-39`). First-caller-wins is correct; a racing second local request would only get the success HTML. Impact ~nil. **Fix (cosmetic):** add a `responded` flag / 404 after first callback.
- **L6 — Parsed SC values flow into Matrix room name unsanitized** (`client/src/renderer/matrix/nets.ts:187`). `shipType`/`ownerRsi` used verbatim in room name. No HTML sink exists today (sent as plain JSON `name`); parser char-classes bound the values. Hygiene only. **Fix:** clamp extracted string lengths in `parser.ts`.

---

## ✅ Controls confirmed correct (baseline is solid)

- `contextIsolation: true`, `nodeIntegration: false`; preload exposes only a typed `invoke()` via `contextBridge`; `setWindowOpenHandler` denies all new windows.
- Credentials stored via OS keychain (`safeStorage`, files `0o600`, dir `0o700`); hard error (no plaintext) in non-test mode.
- All key material (recovery key, SFrame keys) generated with `crypto.getRandomValues` (CSPRNG).
- Device trust uses `crossSigningVerified` (strict), not loose owner-signed.
- `sc:startWatch` and `chirps:read` validate absolute path + exact basename/extension — no traversal (defense-in-depth: re-checked in both renderer and main).
- No `child_process`/`exec`/`spawn` anywhere; no shell-injection surface.
- `/token` membership authz is sound (uses caller's own token; Synapse enforces visibility); `/kick` enforces PL≥100; `encodeURIComponent` on all outbound Synapse URLs; generic 500s (no stack traces).
- coturn `denied-peer-ip` blocks RFC-1918/loopback/link-local/CGNAT (SSRF hardening); `enable_registration: false` + `registration_requires_token: true`.
- Secrets generated with `openssl rand -hex 32`; volume `chmod 600`, mounted `:ro`.
- GitHub Actions pinned to commit SHAs; Dependabot + gitleaks pre-commit configured; no hardcoded secrets.
- Supply chain: `stubs/empty-package` correctly neuters `mock-aws-s3`/`aws-sdk`/`nock`; `overrides: tar ^7.5.11` resolves to a non-yanked 7.5.15; `npm audit` production-clean (the 5 moderate are dev-only `esbuild`/`vite`, never shipped).

---

## Recommended remediation order

1. **C1** — receive-path PL≥50 check + decryption-failure guard + no-silent-downgrade. *(Blocks production voice E2EE; directly relevant to the queued second-user voice test.)*
2. **C2** — entrypoint/envsubst for livekit + coturn. *(Blocks the first real v0.3 deploy.)*
3. **H2, H1** — UUID-validate `serverId`; scheme-validate `openExternal`. *(Cheap, closes the renderer-compromise blast radius.)*
4. **H3, H4, H5** — rate limiting, CORS tightening, admin-API IP restriction. *(Server hardening.)*
5. **M1** — re-enable `sandbox:true` (CJS preload) + Electron fuses. *(Larger change; highest-value MEDIUM.)*
6. Remaining MEDIUM/LOW as hygiene.

---

*Generated by an internal multi-agent review. Two CRITICALs were independently
re-verified by reading the source. This report should be cross-checked against
Snyk's results — overlap is expected on dependency findings; the C1/C2 logic and
config flaws are not detectable by signature scanners.*
