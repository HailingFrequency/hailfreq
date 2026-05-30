# Hailfreq

> Privacy-first tactical comms for Star Citizen guilds. Matrix + LiveKit, end-to-end encrypted, self-hostable.

Hailfreq is what Star Comms could be if it were built privacy-first. Multi-net tactical voice with three PTT modes, organized like Discord (multi-server sidebar), encrypted like Signal (SFrame E2EE for voice + screen sharing), and integrated with Star Citizen (Game.log-driven ship-net auto-creation, CitizenID OIDC SSO).

Built for guilds that want their own infrastructure instead of trusting a third party with everything their pilots say.

## Status

**Client v0.3.0 · server kit-v0.3.1 — testing, security-hardened.** The full planned feature set is shipped (server kit, multi-net voice, admin board, Star Citizen integration, focused-app PTT, screen sharing, cross-server net bridges), plus a security-hardening pass: voice-E2EE key authorization, Electron sandbox/CSP/fuses, and a hardened, podman-compatible server kit. Expect rough edges; report what breaks.

## Quick start

### Join a server (use the client)

1. Download the latest client from the **[Releases page](../../releases/latest)**:
   - **Linux:** `Hailfreq-<version>-x86_64.AppImage` → `chmod +x Hailfreq-*.AppImage && ./Hailfreq-*.AppImage`
   - **Windows:** `Hailfreq-<version>-x64.exe` → run it (unsigned, so SmartScreen warns → **More info → Run anyway**)
2. On first launch, enter your server's domain (e.g. `rpk.chat`) and sign in (CitizenID SSO or a local account).
3. Save the **Recovery Key** when prompted (you need it to read encrypted history on a new device), finish the audio setup wizard, then create or join a net and talk.

### Host your own server (~30 min)

Needs a VPS with a public IPv4, a domain, and **Docker Compose v2 or podman-compose**.

```bash
mkdir -p ~/hailfreq && cd ~/hailfreq

# 1. Download + extract the server kit
curl -L https://github.com/HailingFrequency/hailfreq/releases/latest/download/hailfreq-server-kit.tar.gz | tar xz --strip-components=1

# 2. Point DNS A records for your domain + server hostname at the VPS, then:
cat > .env <<EOF
HAILFREQ_DOMAIN=your-domain.com
HAILFREQ_SERVER_HOSTNAME=server.your-domain.com
HAILFREQ_ADMIN_EMAIL=admin@your-domain.com
HAILFREQ_PUBLIC_IP=$(curl -s ifconfig.me)
EOF

# 3. Bring it up (secrets auto-generate on first start)
docker compose up -d          # or: podman-compose up -d
```

Then create your first admin user and sign in. Full walkthrough (firewall ports, admin user, onboarding, backups): **[`server/README.md`](server/README.md)**.

## Features

**Voice**
- Multi-net simultaneous monitoring with SFrame end-to-end encryption
- Three PTT modes per net: tap-to-toggle, press-and-hold, voice activation
- Priority ducking — when a high-priority net keys, lower-priority audio ducks
- Active SFrame key rotation on member kicks (forward secrecy)
- Focused-app PTT — gate the global PTT key on Star Citizen having window focus, so the key passes through to chat/browser when the game isn't active

**Comms**
- Discord-style multi-server sidebar — be in multiple guilds simultaneously
- Per-server unread badges, per-server encryption isolation
- CitizenID OIDC SSO or local-account login
- Cross-signing + key backup + Recovery Key
- SAS device verification (emoji + QR code)
- Drag-to-reorder sidebar, system tray, OS-level notifications

**Admin**
- Squad-leader board: create / rename / recolor / delete nets; invite / kick / promote / demote
- Disconnect operators from voice; ban accounts from the server
- Per-net properties editor (priority, color, name)
- Radio chirps on PTT (built-in tones + custom files)

**Star Citizen integration**
- Auto-create ship-nets when you board your ship as pilot
- Detect crew boarding your ship via Game.log; one-click invite using CitizenID-verified RSI handle lookup
- Auto-close ship-net on ship destruction

**Screen sharing**
- Share a screen or window to one net at a time, SFrame E2EE same as voice
- Optional system audio capture
- Subscribers see a 📺 indicator and open a viewer pane

**Net Bridges (cross-server allies coordination)**
- Relay audio between two nets — typically across servers — when you're a member of both
- Three modes: smart (VAD-driven, default), always-on, ptt-relay
- Bidirectional support; bridge-active chirp + `(via <bridge name>)` identity suffix so receivers know audio is bridged

## Install

**Linux (AppImage):**
```bash
chmod +x Hailfreq-*-x86_64.AppImage
./Hailfreq-*-x86_64.AppImage
```

**Windows (NSIS installer):**

Double-click `Hailfreq-<version>-x64.exe`. The installer is unsigned, so Windows SmartScreen will warn — click **More info → Run anyway**. Code-signing certificates are on the roadmap.

**Both:** download the latest build from the [Releases](../../releases/latest) page.

## Connect

The test-server URL is shared privately. If you've been invited to participate, the invite includes the server URL + login method (CitizenID or local account). If you haven't been invited and want to test, open an issue with `[access-request]` in the title.

For self-hosting your own server, see [`server/README.md`](server/README.md).

## Privacy posture

Hailfreq is a **Tier 3 privacy** product. The server operator cannot decrypt voice, text, screen shares, or attachments. Specifically:

- **Voice + screen tracks** are SFrame-encrypted client-side. The LiveKit SFU forwards ciphertext only.
- **Chat** uses Matrix Megolm E2EE. The Synapse homeserver stores ciphertext only.
- **Identity** is verified at login (CitizenID OIDC or local password) and never shared off your machine after.
- **Bridge configs, settings, and Game.log path** never leave your machine.
- **Federation is disabled by default.** Each server is an island unless the operator explicitly opens it.

The threat model is "untrusted server operator should not be able to read content." The operator still sees metadata: who is in which room, when people connect, room names. If hiding metadata from the operator is your concern, Hailfreq is not the tool for that — Tor + private contact discovery is research-grade territory and not what we're trying to build.

Bridges are an exception: the **bridge operator** can decrypt both nets (they hold both SFrame keys). This is intrinsic, by design, and documented in-app via the `(via <bridge name>)` identity suffix in the target net.

## Known limitations (v0.1)

- **macOS not supported** in the foreseeable future. Linux + Windows only.
- **Wayland focused-app PTT** falls open (no portable focused-window API on Wayland). X11 sessions work normally.
- **Star Citizen destruction parser** is best-effort; the regex anchors on `<Vehicle Destruction>` / `<EntityDestroyed>` and may need refinement against real crash logs.
- **Net bridges have no auto-failover or sequence-number dedup** — multiple operators running the same bridge cause brief audio duplicates; coordinate manually via visible status indicators.
- **Screen sharing system audio** works on entire-screen sources only (Chromium constraint); window-specific shares are typically silent.
- **Windows installer is unsigned** — SmartScreen warns; click through.

See [`docs/superpowers/specs/`](docs/superpowers/specs/) for the full design spec including the threat model and the complete list of deferred items.

## Self-hosting

Want to run your own Hailfreq server? See [`server/README.md`](server/README.md). The kit deploys via Docker Compose:

- **Synapse** — Matrix homeserver
- **LiveKit** — SFU for voice + screen
- **coturn** — TURN relay
- **Caddy** — TLS termination + reverse proxy
- **livekit-auth** — token minter + Matrix-room-membership-verifying admin operations

You need: a domain, a server with Docker + Compose, and ~30 minutes for the first deployment.

## Feedback

Bug reports, feature requests, and general feedback: [GitHub Issues](../../issues). Issue templates are provided for each kind.

For security-sensitive vulnerability reports, see [`SECURITY.md`](SECURITY.md) — please use the private disclosure channel rather than a public issue.

## License

[AGPL-3.0](LICENSE). Strong copyleft — if you run Hailfreq as a network service for others, you must offer the source under the same license. This matches the privacy-first ethos: Hailfreq exists because the alternatives are closed-source SaaS; we don't want to enable the next closed-source SaaS fork.

## Contributing

Hailfreq is a small project. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev setup, the design-doc discipline, and what kinds of contributions are most welcome.

## Design history

Hailfreq was built across a series of design + implementation passes (Plans 1 through 8c). The complete specs and plans are checked in under [`docs/superpowers/`](docs/superpowers/) as part of the project's transparency commitment. If you want to understand why a feature works the way it does, that's where the answers live.
