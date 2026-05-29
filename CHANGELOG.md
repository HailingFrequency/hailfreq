# Changelog

All notable changes to Hailfreq are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
