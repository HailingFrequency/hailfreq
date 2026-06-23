# Changelog

All notable changes to Hailfreq are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note: client and server kit version independently. Kit releases use the `kit-vX.Y.Z` tag prefix.

## [0.3.1] - 2026-06-22

Major feature release: text + voice channels, Discord-style participant display, settings, in-app password change, and security dependency updates.

### Added

- **Text + voice channels per net** — nets now create a `#general` text channel and a `voice` channel on formation; channels render in the Lounge sidebar just like Discord
- **Discord-style participant sidebar** — connected users appear as sub-rows under the voice channel node with speaking indicators (🎤 green when active)
- **Operations mode** — full PLANNING → ACTIVE → COMPLETED → ARCHIVED lifecycle; `⚡` tab opens an operations sidebar with roster, auto-placement on activation, and `+ New Operation` quick-action
- **VoiceChannelView** — dedicated focused view for a voice channel (PTT button, monitor toggle, MicLevelBar, per-speaker list)
- **RosterPanel** — right-side member list with live speaking indicators (polls every 250 ms)
- **+ Channel button** — create additional text channels under any net from the sidebar
- **Settings menu** — unified `⚙` panel with audio device picker (mic/speaker), live MicLevelBar, test tone, PTT focus toggle; persists and applies immediately
- **Star Citizen section in Settings** — single home for `Game.log` path with Browse/Auto-detect/Clear; live Ship Link status line
- **In-app change password** — per-server right-click → "Change password…" modal (local accounts only; hidden for CitizenID)
- **CI: SLSA provenance** — every release binary now ships with a keyless `*.intoto.jsonl` attestation verifiable with `gh attestation verify`
- **CI: PR lint + unit tests** — lint and 362-test suite run on every PR to master

### Changed

- Net creation now makes a Matrix Space with `#general` text + `voice` child channels (old nets use a backwards-compat `#voice` fallback)
- Mode tabs 🏠 / ⚡ separate Lounge and Operations views; `LoungeSidebar` and `OperationsSidebar` replace the old flat channel list
- MainPanel toggles between text channel view and voice channel view per selection

### Security / Fixes

- **matrix-js-sdk 38 → 41** — pulls in `matrix-sdk-crypto-wasm v18.3.1` security update
- **react 18 → 19** — latest stable React
- **fix: CWE-134** — replaced `console.error(formatString, ...args)` calls with separate argument form to eliminate format-string injection risk
- **fix: esbuild** — pinned `esbuild ≥ 0.25.0` to clear dev-server SSRF advisory (not shipped in production builds)
- **LiveKit server v1.7 → v1.12.0** (server-side; client AppImage unaffected)

### Dependency bumps

- vitest 2 → 4, electron-builder 25 → 26, GitHub Actions tooling (checkout, setup-node, upload/download-artifact, attest-build-provenance)

[0.3.1]: https://github.com/HailingFrequency/hailfreq/releases/tag/v0.3.1

## [kit-0.3.1] - 2026-05-30

Security-hardening + portability patch for the kit (internal security review). **Fixes a critical deploy bug (C2)** and makes the kit actually deployable on podman/podman-compose. Operators on kit-0.3.0 should redeploy from this kit.

### Packaging — now multi-file (podman-compatible)

kit-0.3.0 delivered all config via Compose `configs:` with inline `content:` — a **docker-compose-only** feature. **podman-compose does not materialize it**, so a fresh deploy on podman never started (every service was missing its config). The kit now ships config as **real files** (`Caddyfile`, `synapse/`, `livekit/`, `coturn/`, `postgres/`) bind-mounted via `volumes:`, which works on both docker compose and podman-compose.

- **Distribution change:** the kit is no longer a single `compose.yml` — it's `compose.yml` + the config files. Deploy by extracting the release tarball (or `git clone`), creating `.env`, and `compose up -d`.
- `bootstrap` now stays running + healthy and dependents use `service_healthy` (podman rejects `service_completed_successfully` on an Exited one-shot).
- Generated secrets are `chmod 644` (coturn runs as `nobody`, synapse as uid 991 — couldn't read 600).
- The synapse entrypoint chowns `/data` to uid 991 on first start (fresh rootless volumes are root-owned → `signing.key` write failed). Replaces the old `setup.sh` chown step.
- Verified end-to-end via a full local `podman-compose` bring-up (bootstrap + postgres + synapse + livekit + coturn all healthy).

### Security — server kit

- **C2 (CRITICAL) — livekit & coturn started with empty secrets.** Their inline configs referenced `${LIVEKIT_API_KEY}` / `${TURN_SHARED_SECRET}`, which Compose interpolated from the *host env* — but those secrets live in the bootstrap-generated `hailfreq-secrets` volume, so on a fresh deploy they rendered empty (LiveKit signed against an empty key → all voice tokens rejected; coturn accepted any TURN credential). Both services now have a `sed`-based entrypoint that renders their config from `/run/secrets/` at start (mirroring Synapse); the secret vars are placeholder tokens so Compose leaves them untouched.
- **H5 — Synapse admin API blocked at the edge.** Caddy now returns 403 for `/_synapse/admin/*` (operators use the container-internal `localhost:8008`; the admin API is never exposed publicly).
- **L3 — federation endpoints not exposed.** Caddy returns 403 for `/_matrix/federation/*` (federation is disabled; avoids version/existence leak).
- **L2 — coturn `verbose` removed** (it logged per-session peer/client IPs — call metadata at odds with the privacy model).
- **livekit-auth image hardened** (`docker.io/hailfreq/lk-auth:latest`): per-IP rate limiting on `/token` (20/min) and `/kick` (10/min), configurable CORS (`LK_AUTH_CORS_ORIGIN`), JWT TTL 6h → 1h, and Matrix-user-ID validation on `/kick`.

### Docs

- Firewall table documents that `tcp/7880` must stay closed (LiveKit signaling is reached only via Caddy on 443).
- Integration-test docs note the Synapse shared secret must be a throwaway, never a production secret.

[kit-0.3.1]: https://github.com/HailingFrequency/hailfreq/releases/tag/kit-v0.3.1

## [kit-0.3.0] - 2026-05-29

Turnkey single-file server kit. Operator now downloads one `compose.yml` and creates a 4-line `.env` to deploy the full stack — no `git clone`, no `setup.sh`, no template files. Secrets auto-generate on first run into a managed Docker volume.

### Server kit — single-file model

- **All service configs inlined into `compose.yml`** via Compose v2 `configs:` blocks. The Caddyfile, livekit.yaml, turnserver.conf, synapse/homeserver.yaml, synapse/log.config, postgres init-db.sh no longer exist as separate template files. Compose substitutes `${VAR}` at parse time, so the rendered configs are operator-specific without per-deployment files.
- **`bootstrap` container** runs once on first start, generates 7 cryptographic secrets (postgres password, Synapse macaroon/registration/form, LiveKit API key/secret, TURN shared secret) into a `hailfreq-secrets` Docker volume. Subsequent runs detect the `.bootstrap-complete` sentinel and exit immediately.
- **Synapse custom inline entrypoint** reads the 5 Synapse-relevant secrets from `/run/secrets/`, runs `envsubst` over the inline homeserver.yaml template, then exec's the original `/start.py`. Installs `gettext-base` on demand (matrixdotorg/synapse ships without it).
- **Postgres** uses standard `POSTGRES_PASSWORD_FILE` env convention pointing at the secrets volume — no custom entrypoint needed.
- **livekit-auth** now reads `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` from `/run/secrets/livekit_api_*` files with env-var fallback for backwards compat. New image published.
- **Caddy, livekit, coturn** consume their inline configs directly via the `configs:` mount mechanism — no entrypoint changes needed.

### Server kit — registry distribution

- **livekit-auth published to Docker Hub** as `docker.io/hailfreq/lk-auth:latest` alongside the GHCR `ghcr.io/hailingfrequency/livekit-auth:latest`. Both registries receive the same image (identical config SHA) on every push.
- **`compose.yml` defaults the livekit-auth image to Docker Hub** (`docker.io/hailfreq/lk-auth:latest`). Override via `LIVEKIT_AUTH_IMAGE` env var to use GHCR or a local build.
- **`compose.yml` attached as a release asset** via a new GitHub Actions workflow. Operators can deploy via `curl -L https://github.com/HailingFrequency/hailfreq/releases/latest/download/compose.yml`.

### Server kit — removed (replaced by inline configs)

- `server/Caddyfile.template`, `server/livekit/livekit.yaml.template`, `server/coturn/turnserver.conf.template`, `server/synapse/homeserver.yaml.template`, `server/synapse/log.config`, `server/synapse/init-db.sh`, `server/synapse/oidc-citizenid.yaml.snippet`
- `server/scripts/setup.sh`, `server/scripts/generate-secrets.sh`
- `server/.env.example`
- Empty `server/livekit/`, `server/coturn/`, `server/synapse/` directories

`server/scripts/healthcheck.sh` and `server/scripts/create-admin.sh` remain (they still serve operators on a running deployment).

### Server kit — docs

- `server/README.md` rewritten for the single-file deploy model
- `server/docs/deployment.md` updated for download-compose flow
- `server/docs/update.md` updated for `docker compose pull && up -d`
- `server/docs/backup.md` adds the `hailfreq-secrets` volume to the backup table
- `server/docs/troubleshooting.md` + `server/docs/citizenid-setup.md` updated to reference the inline model

### Migration

Existing v0.2 deployments (including the running rpk.chat server) continue to operate. v0.3 is a **fresh-deploy** model — no automatic migration path. Operators with running v0.2 stacks should stay on v0.2 unless they redeploy from scratch.

### Known v0.3 limitations

- CitizenID OIDC is currently a literal `oidc_providers: []` in the inline template. Operators who need OIDC can override via `compose.override.yml`. A future kit release will reintroduce conditional OIDC inline.
- Bootstrap generates secrets ONCE. To rotate, an operator must delete `hailfreq-secrets` and `synapse_data` volumes (the macaroon secret derives session keys).
- Smoke-tested via dry-run + partial bring-up on the dev machine; full end-to-end happens on a fresh VPS deploy.

[kit-0.3.0]: https://github.com/HailingFrequency/hailfreq/releases/tag/kit-v0.3.0

## [0.3.0] - 2026-05-30

Security-hardening release. Remediates the findings from an internal multi-agent security review (complementing Intercept + Snyk). The headline fix is **C1**, a voice-E2EE bypass.

### Security — client

- **C1 (CRITICAL) — SFrame voice-key authorization.** The SFrame media-key *receive* path trusted any room member's key event, so a PL-0 member could publish an attacker-chosen key that every client would adopt — defeating voice end-to-end encryption. The receive path now ignores key events from senders below PL 50 (matching the rotation gate), skips Megolm decryption-failure events, and refuses to join a net rather than silently downgrading to unencrypted voice.
- **Electron hardening:** `sandbox: true` re-enabled (preload rebuilt as CJS) + `@electron/fuses` (RunAsNode off, cookie encryption on, NODE_OPTIONS/inspect off, asar-only); a production Content-Security-Policy; `shell.openExternal` scheme validation; UUID validation on the token IPC (path-traversal fix); `will-navigate` restricted to the app bundle.
- **No test backdoor in prod:** `HAILFREQ_TEST` is compiled out of production builds (it had exposed `window.__matrixHandle`/`__voiceEngine`).
- **Recovery key:** `restoreFromRecoveryKey` selects the validating SSSS key instead of blindly the first.
- **Input hardening:** parsed Game.log fields clamped; log-line length capped; `rsiVerified` documented + de-claimed in the UI as self-reported (not server-verified).

### Dependencies

- **matrix-js-sdk 35 → 38.4.0**, **tar pinned to ^7.5.11** (resolves 6 HIGH path-traversal CVEs), pytest/requests test deps bumped. `npm audit` production-clean.

### Build

- Fixed a packaging bug where the CJS empty-stub leaked into the ESM main bundle (`ReferenceError: module is not defined`) — the app now launches with `sandbox: true`.

[0.3.0]: https://github.com/HailingFrequency/hailfreq/releases/tag/v0.3.0

## [0.2.0] - 2026-05-29

First polish pass after initial deployment. Closes the gaps that prevented a fresh tester from getting end-to-end in a net without finding a second person.

### Client

- **AutoDiscovery** via matrix-js-sdk's `findClientConfig` — clients now consult `.well-known/matrix/client` before connecting (the server-side `/_matrix` proxy at apex stays as defense-in-depth)
- **Admin button** reappears immediately when a user creates a net that promotes them to admin (was: only after app restart)
- **Recovery Key "Copy to Clipboard"** shows "Copied ✓" confirmation for 2 seconds + a success-variant button style, so the user knows the copy landed
- Removed the `localhost:8080` dev default from the initial server list (was a leftover from dev that confused first-run users)
- **Mic input RMS level meter** on each monitored NetRow next to the In control — confirms the mic is being captured before speaking into silence
- **Visible "🔴 LIVE" indicator** with rose-pulse on the NetRow when actively transmitting + rose-border row accent so the PTT key detection is unambiguous
- **Per-net self-monitor toggle** ("Hear yourself when transmitting") — routes mic locally via Web Audio so a single user can verify the full mic→encode→publish→play loop without a second tester
- **First-run audio setup wizard** — 3-step flow (input device + mic level + output device + test tone + PTT mode + key capture) that runs on first sign-in and persists `audioSetupComplete` so it doesn't reappear
- Cleaned up redundant `vite.config.ts` aliases and `src/main/_stubs/` after the npm stub-package approach (in `stubs/empty-package`) proved sufficient for the mock-aws-s3 issue

### Server kit

- `healthcheck.sh` and `create-admin.sh` now dispatch between `docker compose` and `podman compose` automatically — rootless podman supported out of the box, including handling podman's different `ps --format json` shape and lack of a `Health` field (parsed from the `Status` string instead)
- `setup.sh` auto-applies the `podman unshare chown -R 991:991` fix to the synapse_data volume when rootless podman is detected — no manual intervention needed on first run anymore
- New `server/docs/pasta-networking.md` documents the switch to pasta as the default rootless network backend, what it does and does not fix, and the honest limitations around source-IP preservation through port-publishing in rootless podman

### Deployment milestone

This is the version running at https://rpk.chat (delegated to https://server.rpk.chat), the first publicly accessible Hailfreq server.

[0.2.0]: https://github.com/HailingFrequency/hailfreq/releases/tag/v0.2.0

## [0.1.0] - 2026-05-29

First public release. Ships the complete planned feature set for v1.5 from the Hailfreq design spec.

### Added — Server kit (Plan 1)
- Docker Compose stack: Synapse + LiveKit + coturn + Caddy + livekit-auth
- `livekit-auth` service mints LiveKit JWTs against Synapse `whoami` + room membership, exposes `/token` and `/kick` (admin) endpoints
- Federation disabled by default (island server posture)

### Added — Client foundation (Plan 2)
- Electron + React + TypeScript desktop app
- First-run server URL configuration
- Login via CitizenID OIDC or local Synapse accounts
- Full Matrix end-to-end encryption setup: cross-signing + key backup + Recovery Key
- SAS device verification (emoji)
- Auto-resume on relaunch via `safeStorage`

### Added — Multi-server sidebar (Plan 3)
- Discord-style multi-server sidebar; be in multiple guilds simultaneously
- Per-server encryption isolation (each server has its own Recovery Key)
- In-app unread badges from inactive servers
- Per-server logout flow

### Added — Voice engine (Plan 4)
- Multi-net simultaneous voice monitor (LiveKit-backed) with SFrame E2EE
- Three PTT modes per net: tap-to-toggle, press-and-hold, voice activation
- Priority ducking (configurable per-net priority levels)
- Active SFrame key rotation on net-level kicks (forward secrecy)
- Per-net volume controls

### Added — Admin / squad-leader board (Plan 5)
- Three-pane layout: nets, roster, detail
- Create / rename / recolor / delete nets
- Invite + remove members; promote to squad leader / demote
- Disconnect operators from voice; ban accounts from the server
- Full roster view across all visible nets with online-status indicators and RSI-verified badges
- Net properties editor (priority, color, name)

### Added — Polish bundle (Plan 6)
- Radio chirps on PTT (built-in tones + custom files from `userData/chirps/`)
- QR code device verification (alongside SAS emoji)
- Drag-to-reorder server sidebar
- System tray with minimize-to-tray
- OS-level desktop notifications (per-server toggle)

### Added — Star Citizen integration (Plan 7)
- Auto-create ship-nets when you board your ship as pilot via Game.log
- Detect crew boarding your ship; one-click invite with CitizenID-verified RSI handle lookup
- Auto-close ship-net on ship destruction
- Per-server settings for log path + allowlist + auto-close

### Added — Focused-app PTT (Plan 8a)
- OS-level focus gate on the global PTT key; passes through to chat/browser/terminal when the game isn't focused
- Cross-platform via `active-win` (Windows + Linux X11)
- Wayland fail-open (no portable focused-window API on Wayland) with visible warning
- Allowlist editor with case-insensitive substring matching + whitespace normalization

### Added — Screen sharing (Plan 8b)
- Share a screen or window to one net at a time, SFrame E2EE same as voice
- Optional system audio capture
- Source picker modal with thumbnails (screens + windows)
- Receiver pane with track attach/detach + Esc/click-outside to close
- Persistent "Sharing to <net>" status bar across Home
- Per-net 📺 indicator for active remote shares

### Added — Net Bridges (Plan 8c)
- Cross-server audio relay between two nets you're a member of
- Three modes: smart (VAD-driven, default), always-on, ptt-relay
- Bidirectional support with separate forward + reverse runners per bridge
- Bridge-active chirp on operator's local output + `(via <bridge name>)` identity suffix in target net
- Bridges admin tab with status indicators + Enable/Disable/Edit/Delete
- Bridge editor wizard with server + net pickers + mode + smart threshold slider
- Per-net 🌉 indicator for nets that are part of active bridges

### Known limitations
- macOS not supported
- Wayland focused-app PTT fails open
- Windows installers are unsigned (SmartScreen warns)
- Star Citizen destruction parser is best-effort, regex unverified against real crash logs
- Net bridges have no auto-failover, no sequence-number dedup, no cross-machine config sync
- Screen sharing system audio is entire-screen-only (Chromium limitation)
- Bridge chirp plays on operator's local output, not injected into the relayed audio

### Security

The full threat model is documented in [`docs/superpowers/specs/2026-05-26-hailfreq-design.md`](docs/superpowers/specs/2026-05-26-hailfreq-design.md), §3. See [`SECURITY.md`](SECURITY.md) for the private vulnerability disclosure channel.

[0.1.0]: https://github.com/HailingFrequency/hailfreq/releases/tag/v0.1.0
