# Hailfreq — Design Spec (v1)

**Status:** Draft, awaiting review
**Date:** 2026-05-26
**Owner:** Shreen (GitHub: ShanktuaryGolf)

## 1. Summary

Hailfreq is a privacy-first, self-hostable tactical-radio voice application for gaming communities — initially targeting Star Citizen orgs. It replicates the multi-net push-to-talk UX of Star Comms, but built on a fully end-to-end encrypted Matrix substrate so that no operator — including the guild running the server — can read message content or listen to voice.

The product motivation: Star Comms is a closed-source backend operated by an unknown party. Members and guild leadership have no way to audit what gets stored, logged, or shared. Hailfreq closes that trust gap by being open source end-to-end, self-hosted, and architecturally incapable of operator-side content access.

## 2. Goals and Non-Goals

### 2.1 Goals

- **Tactical-radio UX**: multi-net simultaneous voice monitor, per-net PTT with global keybinds, priority ducking, squad-leader assignment board, radio chirps.
- **End-to-end encrypted voice and chat content** (server cannot decrypt).
- **Self-hostable on a single cloud VPS** for guilds of 100–500 concurrent members.
- **Generic distributable client** — any guild can deploy their own server and use the same Hailfreq binary, configured to point at their server.
- **Multi-server support** in v1 — Discord-style sidebar of multiple guild servers in one client.
- **CitizenID OIDC SSO** as the primary auth path, with verified RSI badge.
- **Local Synapse account fallback** so users without CitizenID can still join.
- **Cross-platform desktop**: Windows + Linux for v1.

### 2.2 Non-Goals (v1)

- macOS or web/PWA client (SC doesn't run on macOS; browsers can't capture global hotkeys).
- Hiding metadata from the server operator (server still sees who-connects-when; this is irreducible — see §3.2).
- Federation with public Matrix network (island server only; reduces metadata footprint).
- Server-side message search or transcription (would defeat E2E).
- Bridges to Discord/Slack/IRC (drops E2E for bridged rooms unless rebuilt).
- Anonymity (users are authenticated; privacy ≠ anonymity).
- Native mobile client (members install Element X for mobile chat).

## 3. Threat Model

### 3.1 Adversaries we protect against

| Adversary | What they can see | What they cannot see | Mitigation |
|---|---|---|---|
| Random network snoop | TLS-encrypted streams | Anything inside | TLS + SFrame, defaults |
| Malicious server operator (or breach) | Membership, presence, room counts, ciphertext | Plaintext, voice content, keys | E2E; keys live on user devices only |
| Compromised member device | Whatever that member could see | Pre-compromise messages | Megolm forward secrecy; device-verification surfaces unverified devices |
| Malicious org member | Rooms they're invited to | Rooms they're not invited to | Power levels + room membership |
| CitizenID compromise | Login events; can issue impersonation tokens | History (no keys); voice (no SFrame keys) | Cross-signing — impersonated devices appear unverified |
| LiveKit SFU operator | Routing patterns, who-talks-when | Voice content | SFrame on top of WebRTC |
| Subpoena against operator | Encrypted store, membership lists, presence logs | Plaintext (operator cannot produce it) | Structural deniability |
| TURN relay adversary | Relay timing | Content | DTLS-SRTP + SFrame |

### 3.2 Irreducible metadata (server-visible no matter what)

These are inherent to running a client-server system. Disclose to members.

- Who has an account on the server.
- Who's online when.
- Who's in which voice room when, for how long.
- Matrix room membership.
- Encrypted-message cadence (timing patterns).
- Connection IP addresses (mitigable user-side via VPN, see §8.3).

### 3.3 What we do NOT promise

- Hiding metadata from the operator — operator is a trust dependency, but the server is open source and auditable.
- Protection against rubber-hose attacks on members.
- Protection against voluntary leaks (screenshots, recordings, key sharing).
- Anonymity. Authenticated users only.

### 3.4 What "Tier 3 privacy" means for Hailfreq

> The content of voice and chat is end-to-end encrypted between members. No one between sender and recipient — not Hailfreq, not the server operator, not CitizenID, not the VPS provider, not a subpoena recipient — can read it.

We do not promise invisibility. Server-visible metadata exists; we minimize where possible and document honestly.

## 4. Architecture

### 4.1 Server side (single cloud VPS)

Reference deployment: one Hetzner CCX23 or DigitalOcean 4vCPU/8GB box. Sized for 100–500 concurrent voice users.

| Service | Purpose | Notes |
|---|---|---|
| Caddy or nginx | TLS termination, reverse proxy | Let's Encrypt automation |
| Synapse | Matrix homeserver — chat ciphertext, identity, OIDC SSO | Federation disabled |
| PostgreSQL | Synapse storage | Stores ciphertext + metadata |
| LiveKit SFU | Routes encrypted voice + screen-share tracks | E2EE mode enabled (SFrame) |
| coturn | TURN relay for restrictive NATs | UDP — cannot be Cloudflare-proxied; see §8.2 |

No custom server-side application code is required for v1. All tactical-radio state (net priorities, squad-leader assignments, member rosters) lives as Matrix rooms, room memberships, power levels, and custom state events. Clients read and reconcile this state directly.

### 4.2 Client side

Electron desktop application for Windows and Linux. Single generic binary, configured per-run with a server URL.

Internal modules:

| Module | Purpose |
|---|---|
| matrix-js-sdk | Matrix login, rooms, chat, E2E key management (Olm/Megolm/cross-signing) |
| livekit-client | Voice + screen share with SFrame E2EE on top |
| Net manager | Pairs Matrix rooms with LiveKit rooms; manages subscriptions per monitored net |
| Audio engine | Multi-net mixer, per-net volume, priority ducking, mic capture, Opus encode/decode |
| Hotkey manager | Global PTT keybind capture (per-OS native), maps keys to nets |
| Admin board | Reads room state from all visible nets; offers admin actions via Matrix APIs |
| Server switcher | Manages multiple homeserver accounts; routes UI to currently selected server |
| Tactical UI | React frontend tying it all together |

### 4.3 External dependencies

| Dependency | Trust level | What they see |
|---|---|---|
| CitizenID | Soft trust during login only | Login events + linked identities the user chose to expose |
| User's VPS provider | Standard hosting trust | Encrypted traffic, IP-level routing |
| Optional: Cloudflare | Operator's discretion | If used, sees plaintext HTTP after TLS termination; cannot proxy voice |
| Optional: User VPN | User's choice | Hides user IP from server and Cloudflare |

## 5. Multi-Net Voice Design

### 5.1 Net model

A **net** = one Matrix room paired with one LiveKit room. The pairing is by convention: the LiveKit room name is the UUID portion of the Matrix room ID, so given the Matrix room ID `!a1b2c3...:server` the LiveKit room is `a1b2c3...`. The Matrix room handles membership, identity, text chat, and E2E key distribution via Megolm. The LiveKit room handles voice routing with SFrame E2EE.

**Net properties** stored as Matrix state events:

- `org.hailfreq.net.priority` (integer, 0–100): priority for ducking.
- `org.hailfreq.net.name`: display name.
- `org.hailfreq.net.color`: UI color hint.

**SFrame key distribution:** voice encryption keys are distributed over the paired Matrix room using Matrix's existing encrypted-to-device messaging. The implementation mirrors Element Call's MatrixRTC approach (each member publishes their own sender key over Matrix; recipients use it to decrypt that sender's voice frames). Server cannot observe these key exchanges as cleartext. Membership changes in the Matrix room trigger key rotation, so removed members lose voice access immediately.

### 5.2 Multi-room subscription (the headline feature)

LiveKit's client SDK supports multiple `Room` instances per session. The Hailfreq client maintains one `Room` connection per monitored net (typically 3–6, configurable).

For each subscribed Room, the client subscribes to all remote audio tracks. A local audio mixer combines streams with per-net volume + priority ducking, outputs one mixed PCM stream to the default audio device.

### 5.3 PTT and outbound

- One or more global hotkeys per net (max 3 per net, mirroring Star Comms).
- On keydown: client checks Matrix power level in the target net's room. If ≥ speak threshold (default PL 50), mic capture starts, Opus-encoded, published to that net's LiveKit room only.
- On keyup: stop publishing.
- Only one outbound transmission at a time; pressing a second PTT cancels the first.
- v1.5: focused-app gate — PTT only fires when a specified executable name has window focus (e.g., StarCitizen.exe).

### 5.4 Priority ducking

Each net has a numeric priority. When any participant in a higher-priority net begins publishing, the audio engine attenuates all lower-priority net streams by a configured dB amount (default −35 dB, matching Star Comms). Ducking releases shortly after the higher-priority transmission ends (configurable hangover, default 250 ms).

### 5.5 Capacity envelope (100–500 concurrent users)

- ~64 kbps inbound per user (4 monitored nets × ~2 average simultaneous speakers across system × 32 kbps Opus).
- 500 concurrent × 64 kbps = ~32 Mbps aggregate at SFU. Comfortably within a single 4 vCPU / 1 Gbps VPS.

**Implementation status (v1):** §5.1–5.5 shipped in Plan 4. See `docs/superpowers/plans/2026-05-28-hailfreq-voice-engine.md`. §5.6 (Net Bridges) remains v1.5.

### 5.6 Net Bridges — client-side audio relay (v1.5)

A **Net Bridge** lets a single operator who is a cryptographic member of two nets relay decrypted audio from one into the other, using their own client and account as the bridge. The use case is allied operations: a guild leader who is in both their own guild's Command net and a cross-org Allied Leadership net can pipe Allied traffic into Command so their own squad leaders hear it in real time.

**Mechanism:**

1. Operator is a cryptographic member of both source net (e.g., Allied Leadership) and target net (e.g., own Command).
2. The Hailfreq client already decrypts source audio for monitoring.
3. When the bridge is active, the client takes that decrypted PCM, re-encodes Opus, and publishes it to the target net's LiveKit room — using the operator's existing account in the target net.
4. Target-net members receive audio that appears (cryptographically) to come from the operator, but the UI surfaces a `[RELAY: <source net>]` badge so they understand the origin.

**Why this preserves Tier 3:**

The operator is already authorized in both nets. The server never receives plaintext; the relay happens entirely on the operator's device. Target-net members never receive source-net encryption keys. Cryptographic membership is the only authorization checked — exactly as today.

**Operating modes** (configurable per direction per net pair):

| Mode | Behavior |
|---|---|
| Off | Default. No relay; just monitoring. |
| PTT relay | Operator presses a key — for the hold duration, source audio relays into target. |
| Always-on | Continuous source → target while operator is in both. |
| Smart | Always-on, but ducks while the operator is transmitting their own PTT in the target. |

**Trade-offs:**

- One Opus transcode hop (source decode → mix → target re-encode). Negligible quality loss.
- The bridging operator is a single point of relay failure; if they disconnect, the bridge dies. Multiple operators can relay redundantly, but receivers will hear duplicates unless a deduplication mechanism is added (open question — see §11).
- Bandwidth: bridging operator uses ~2× normal during active relay.
- Bridging is **non-anonymizing for the relayer** — they're publicly the bridge in their target net, as their account is the visible publisher. This is appropriate for leadership use cases.

**Why this is not federation:**

Federation would let one room exist on one server and have native members from other servers. Net Bridges achieve a similar coordination outcome (allied traffic surfaces in own net) without re-enabling Matrix federation between servers. The cost is that the relay is operator-mediated rather than protocol-mediated, but the privacy benefit (no inter-server metadata leakage) is significant.

## 6. Admin / Squad-Leader Board

**Implementation status (v1):** §6 shipped in Plan 5. See `docs/superpowers/plans/2026-05-28-hailfreq-admin-board.md`. All capabilities in §6.2 are implemented.

### 6.1 Matrix-native state

All admin board state lives in Matrix primitives. No custom server-side code.

- **Net membership** = Matrix room membership.
- **Squad Leader** = power level 75 in a net's room.
- **Admin** = power level 100.
- **Speaker** = power level ≥ 50 (default).
- **Net priority** = custom state event in the net's room (§5.1).
- **Online status** = Matrix presence + LiveKit `participant_active_speaker` events.
- **RSI verified badge** = `STATUS_VERIFIED` role from CitizenID OIDC profile, cached client-side.

### 6.2 Admin capabilities

| Action | Mechanism |
|---|---|
| Create net | Create Matrix room + paired LiveKit room |
| Rename / recolor net | Update state events in Matrix room |
| Change net priority | Update `org.hailfreq.net.priority` state event |
| Assign member to net | Invite to net's Matrix room |
| Remove member from net | Kick from net's Matrix room (triggers Megolm rotation) |
| Promote to squad leader | Set power level 75 in net's room |
| Demote | Lower power level |
| Disconnect from voice | LiveKit participant kick API (chat unaffected) |
| Ban from server | Synapse admin API: deactivate user account |

### 6.3 Aggregation

There is no server-side "who's where" aggregate. Each admin client reads the rooms it has access to and computes the view locally. This preserves the property that the server holds only encrypted state and direct membership lists, not derived joins.

## 7. Authentication and Key Management

### 7.1 First-run setup

New install prompts for the homeserver URL (e.g., `radio.your-guild.com`). Stored locally in app data. Subsequent launches go directly to the login screen for that server.

### 7.2 Login

Login screen shows two paths:

1. **Sign in with CitizenID** *(recommended)* — OIDC redirect to citizenid.space, user authorizes, redirect back, token exchange via PKCE, OIDC SSO into Synapse. Synapse auto-creates Matrix account on first login, maps CitizenID `sub` to a stable Matrix localpart.
2. **Sign in with local account** — username + password directly to Synapse.

Both paths converge on the same post-login encryption setup (§7.3).

**Scopes requested from CitizenID:** `openid`, `profile`, `email`, `roles`, `rsi.profile`.

**OAuth client registration:** each server operator registers their own integrator account with CitizenID (free, per CitizenID's model) and configures the resulting `client_id` and `client_secret` in their Synapse `oidc_providers` block. The Hailfreq client itself contains no CitizenID credentials.

### 7.3 First-time encryption setup

After login, the client:

1. Generates Olm device keys (device cryptographic identity).
2. Generates cross-signing master keys (account cryptographic identity).
3. Generates Megolm key backup secret.
4. Encrypts cross-signing private keys + key backup secret with a generated **Recovery Key** (base58, ~28 characters).
5. Presents the Recovery Key to the user with a copy-to-clipboard button. **Mandatory** "I've saved this somewhere safe" confirmation before proceeding.

The Recovery Key is the *only* way to recover encrypted history if all signed-in devices are lost. This trade-off is fundamental to E2E and cannot be backdoor-recovered.

### 7.4 Device verification

When a new device logs in for an existing user, it has no keys. Two recovery paths:

1. **SAS verification from an already-trusted device** — emoji comparison (~15s).
2. **Recovery Key entry** — user enters the key from §7.3; client decrypts cross-signing keys and pulls down key backup (~30s).

Device verification is not dismissible. Unverified devices break the cross-signing chain and weaken Tier 3 — admins can see which members have unverified devices and prompt them.

QR code verification shipped in Plan 6 (moved to v1 from v1.5; see §9.2).

### 7.5 Multi-server (v1)

Discord-style server switcher in the sidebar. Each server is a fully independent Matrix account with its own:

- Server URL.
- Login credentials (CitizenID OAuth tokens or local password).
- Cross-signing key set.
- Recovery Key.
- Device verification state.
- Room list, contacts, presence.

Each server's encryption setup must be completed independently (no shared keys between servers, by design — they're separate trust contexts).

Notification routing: events from all configured servers surface in the UI. Active server context determines which voice nets are monitored at any moment.

**Implementation status:** Shipped in Plan 3. See `docs/superpowers/plans/2026-05-27-hailfreq-multi-server-sidebar.md`.

### 7.6 Member onboarding

Two operator patterns:

1. **CitizenID allowlist** — admin adds a CitizenID UUID or RSI handle to the server's allowlist. Member logs in via CitizenID; account auto-created and auto-joined to baseline rooms (e.g., All-Hands, Lounge).
2. **Local-account invite** — admin generates a one-time registration token, shares it out-of-band, member uses it to register.

Public self-signup is disabled.

## 8. Deployment Topology

### 8.1 Reference deployment

Single VPS, docker-compose orchestrated:

```
caddy ─┬─ synapse ─── postgres
       └─ livekit ─── coturn
```

Memory: ~4 GB for 100 users, ~8 GB for 500. CPU: 4 vCPU comfortable. Bandwidth: ~32 Mbps aggregate at 500 concurrent voice. Static IP required (LiveKit + coturn need it).

Deployment guide and docker-compose template will be part of the v1 release.

### 8.2 Cloudflare guidance (optional)

Cloudflare can front the Synapse HTTP/WebSocket surface for DDoS protection and to hide member IPs from the origin. **It cannot proxy LiveKit media** (WebRTC UDP is not supported by Cloudflare's standard products or by Cloudflare Tunnels; only the Enterprise-only Spectrum product handles UDP). Voice still goes direct to the LiveKit SFU and coturn TURN server, exposing member IPs there.

| Traffic | Cloudflare-frontable | Effect on member IP privacy |
|---|---|---|
| Synapse (chat, control) | ✅ Free tier works | Hidden from origin |
| LiveKit signaling (WebSocket) | ✅ Works | Hidden from origin |
| LiveKit media (voice content) | ❌ UDP, not supported | Visible to SFU |
| coturn TURN relay | ❌ UDP, not supported | Visible to TURN |

Using Cloudflare adds Cloudflare itself as a third-party logger with full HTTP plaintext visibility post-TLS-termination. Operators should weigh this trade-off:

- **Use Cloudflare** if DDoS protection matters and you trust Cloudflare's privacy policy more than your VPS provider's.
- **Skip Cloudflare** for simplest and lowest-trust-dependency deployment.

Default deployment guide: no Cloudflare.

### 8.3 User-side IP privacy

For individual members who want IP privacy beyond what the operator can offer, the standard answer is: use a personal VPN. A VPN hides the member's IP from the operator, from Cloudflare (if used), from the TURN server, and from their ISP — single tool that solves the whole problem. Recommend this in member onboarding docs.

## 9. Scope: v1 / v1.5 / v2

### 9.1 v1 (target: 3–4 months)

- Generic Hailfreq Electron client (Windows + Linux).
- Multi-server Discord-style sidebar.
- CitizenID OIDC SSO + local Synapse account auth, with first-run server URL setup.
- Synapse + LiveKit + coturn + Caddy reference deployment (docker-compose).
- Multi-net simultaneous voice monitor.
- Per-net PTT with global hotkeys (up to 3 slots per net).
- Priority ducking (basic dB attenuation).
- Admin board: net create/rename/priority, member assign/unassign, squad-leader promote/demote, disconnect-from-voice, ban-from-server.
- Text chat per net (inherited from Matrix).
- SAS device verification + Recovery Key + Megolm key backup.
- Operator deployment guide and member onboarding documentation.

### 9.2 v1.5 (months 5–8)

Items marked ✓ were promoted to v1 and shipped in Plan 6 (2026-05-28 polish bundle).

- ✓ Radio chirps (custom WAV/MP3/OGG/FLAC, loaded from local folder, mirroring Star Comms). **Shipped in Plan 6.**
- Focused-app PTT (Win32 focus detection + X11/Wayland focus detection).
- Priority ducking polish (configurable curves, hangover tuning, per-net overrides).
- Voice activity / open-mic mode for designated nets.
- Screen sharing UI exposure (LiveKit supports it; we just expose it).
- ✓ QR code device verification (alongside SAS). **Shipped in Plan 6.**
- ✓ Drag-to-reorder server sidebar. **Shipped in Plan 6.**
- ✓ System tray with minimize-to-tray. **Shipped in Plan 6.**
- ✓ OS-level desktop notifications (per-server toggle). **Shipped in Plan 6.**
- **Net Bridges** — client-side audio relay between two nets the operator is a member of (§5.6). Enables multi-guild alliance coordination without re-enabling federation.
- UI polish, theme support.

### 9.3 v2 (longer-term, demand-driven)

- Cross-instance discovery via CitizenID opt-in role publication.
- macOS client (if Mac-using SC spectators want it).
- Tauri rewrite consideration for smaller footprint.
- Federation gated allowlist mode (talk to specific allied org servers only).
- Native mobile companion (or formalize Element X as the mobile story).

## 10. Out of Scope (intentional)

- Hiding metadata from the server operator. Requires Tor + private contact discovery — research-grade, not a guild app.
- Voice messages / async voice.
- Video calls. Element Call covers this; could be exposed later but not core to tactical-radio identity.
- File sync.
- Bots / external integrations.
- Public room directory.
- Guest mode.
- SSO providers other than CitizenID.

## 11. Open Questions / Decisions Deferred

- **Naming on the wire.** Custom state event prefix is `org.hailfreq.*`. Confirm with CitizenID team whether they want a shared namespace convention if other tactical clients emerge.
- **Megolm-to-SFrame key derivation function** — specific HKDF parameters to be locked during implementation. Element Call has a reference implementation we should mirror unless there's a reason to diverge.
- **Audio engine implementation** — Web Audio API vs. native module via Rust binding via N-API. Web Audio is simpler; native gives lower latency. Defer to implementation phase.
- **Maximum monitored nets** — soft cap to prevent runaway CPU/bandwidth. Suggested: 8. Hard cap: 16.
- **CitizenID outage UX** — if CitizenID is down at login, client should fall back to local-account login path smoothly. Specific UI to be designed.
- **Net Bridge default mode** — PTT-relay vs. Always-on vs. Smart as default for new bridges. Lean toward Smart (least surprising) but defer to user testing in v1.5.
- **Net Bridge redundancy semantics** — when multiple operators relay the same source → target pair, sequence-number-based deduplication is feasible but adds complexity. Decide during v1.5 implementation whether to dedupe or just let receivers hear duplicates briefly.

## 12. References

- **Star Comms** Linux client (the inspiration): https://github.com/GreaseResidue/starcomms-linux-client-oss
- **Fluxer** (considered as base, ultimately not chosen for Tier 3): https://github.com/fluxerapp/fluxer
- **Matrix protocol**: https://spec.matrix.org/
- **Synapse** (Matrix homeserver): https://github.com/element-hq/synapse
- **Element Call** (reference for Matrix+LiveKit integration): https://github.com/element-hq/element-call
- **LiveKit** (SFU): https://livekit.io/
- **LiveKit E2EE / SFrame**: https://docs.livekit.io/home/client/tracks/encryption/
- **CitizenID**: https://citizenid.space/ — Passport strategy: https://github.com/citizenid-space/passport-citizenid
- **MSC3401** (Matrix native group VoIP signaling): https://github.com/matrix-org/matrix-spec-proposals/pull/3401

## 13. Star Citizen Game.log Integration (Hailfreq extension, beyond original spec)

Implemented in Plan 7. This is the killer feature that distinguishes Hailfreq from a generic Matrix/LiveKit comms client: zero-click voice-net management for Star Citizen ships, driven entirely by parsing the local `Game.log`. No cross-client coordination room is required — every event Hailfreq cares about already appears in the affected player's own log.

### Why this works

Star Citizen's in-game chat channel system emits three observable signals in the local `Game.log`:

| In-game action | Log line shape |
|---|---|
| You connect to the game | `<TS> [Notice] <Expect Incoming Connection> ... nickname="<You>" playerGEID=<id>` |
| You join any channel | `<TS> [Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel '<Ship> : <Owner>'.` |
| Another player joins a channel you are in | `<TS> <OtherPlayer> has joined the channel '<Ship> : <Owner>'.` |

The owner field after the colon is the parser anchor — it tells Hailfreq whose ship the channel belongs to, regardless of which player just boarded.

### Behaviors

| When | Hailfreq does |
|---|---|
| You board your own ship | Auto-create (or open) the ship-net Matrix room, auto-monitor voice |
| Crew boards your ship | Look up the crewmate's RSI handle via CitizenID profile cache → either auto-invite (if allowlisted) or surface a toast with one-click invite |
| You board someone else's ship | Out of scope for v1 — operator deprioritized; could be added by detecting `owner != self` and looking up via Matrix room directory |
| Ship destroyed/despawned | If `autoCloseOnDestruction` is set, stop monitoring (the room is not tombstoned; other crew may still want chat history) |

### Privacy / opt-in

- **Per-server "Watch Game.log" toggle** — default off; explicit opt-in
- **Allowlist for auto-invite** — default empty; manual one-click invite is the default UX
- **Game.log path** — local-only; never transmitted; auto-detected for Windows + Linux Wine prefixes (Lutris / Bottles / Steam Proton / `~/.wine`) with manual override
- **Auto-created ship-nets** — encrypted Matrix rooms with the same SFrame E2EE as any other net

### Data model

Ship-nets are regular voice nets with three additional state events:

- `org.hailfreq.ship.type` — ship class name (e.g., "Anvil Asgard")
- `org.hailfreq.ship.owner-rsi` — RSI handle of the owner
- `org.hailfreq.ship.owner-matrix-id` — Matrix user ID of the owner

Room name convention: `🚢 {shipType} — {ownerRsi}`. The NetListPanel renders ship-nets at the top of the list with a "Ships" group header and a cyan border accent.

### Known limitations

- **Ship destruction parser** is best-effort (the operator did not have a destruction log sample at the time of writing); the regex is anchored on `<Vehicle Destruction>` / `<EntityDestroyed>` markers and should be refined against real logs on first encounter.
- **RSI handle lookup** requires the crewmate to have signed in with CitizenID AND opted into publishing their RSI handle to their Matrix profile (Plan 5 Task 14).
- **Cross-server / cross-org coordination** — each Hailfreq server is independent. If a crew member is in a different org's Hailfreq server, the auto-invite cannot find them.

## 14. Focused-app PTT (Hailfreq extension, beyond original spec)

Implemented in Plan 8a. Adds an OS-level "focus gate" to the global PTT key handler so the key only fires when a user-chosen app (typically Star Citizen) has window focus. When the gate is off, PTT works as it did before (always-on global). When the gate is on, the PTT key is a no-op while the user is typing in chat, browser, or terminal — those apps receive the keystroke normally.

### Implementation

- Main-process polling probe via `active-win` (500ms interval), caches focused window's process name + title
- Pure decision function `shouldGatePass({ focus, allowlist })` lives in the renderer, unit-tested
- PttController reads the cache over IPC at key-press time and decides whether to dispatch
- Key-release always fires regardless of focus — guarantees the mic never gets stuck open
- In-flight guard on tap-to-toggle prevents key-repeat double-toggle races
- IPC failure fails open (PTT remains usable during main-process teardown)

### Wayland fallback

Wayland has no portable API for querying the active window (deliberate compositor security model). On Wayland sessions, the focus probe is skipped and the gate fails-open (permits all PTT). The settings panel displays a non-blocking warning so users know their gate config is inactive on this session type. X11 sessions work normally.

### Allowlist semantics

- Case-insensitive substring match against (`processName` + " " + `title`), whitespace-normalized so "StarCitizen" matches "Star Citizen" titles
- Default entry: `"StarCitizen"` — matches both Windows-native and Wine-prefix process names + window titles
- Users can add additional substrings (e.g., `"ElementX"`, `"Firefox"`) via the settings UI
- Empty allowlist = gate effectively disabled (fail-open); whitespace-only entries do not pass

## 15. Screen Sharing (Hailfreq extension, beyond original spec)

Implemented in Plan 8b. Adds Discord-style screen sharing to Hailfreq nets, end-to-end-encrypted via the same SFrame infrastructure that protects voice. Used during ops planning — showing a star map, ship loadout, mission briefing — without trusting the SFU or Matrix homeserver to see the content.

### Architecture

- A `ShareEngine` parallel to `VoiceEngine` reuses the same LiveKit Room objects via `VoiceEngine.getLiveKitRoom(matrixRoomId)`
- Publisher path: Electron `desktopCapturer.getSources` → user picks source → `getUserMedia` (legacy `chromeMediaSource: "desktop"` constraints, required by Electron's Chromium) → `room.localParticipant.publishTrack(...)` with the existing room SFrame key
- Subscriber path: `RoomEvent.TrackSubscribed` filtered to `Track.Source.ScreenShare` and `Track.Source.ScreenShareAudio` → React viewer pane attaches `RemoteVideoTrack` / `RemoteAudioTrack` to `<video>` / `<audio>` elements
- Single concurrent local share (across all nets) to bound bandwidth and UX
- Remote participants can each share independently; multiple viewer panes are not blocked by a local share
- LiveKit room listeners are explicitly tracked and removed on detachRoom / shutdown (no orphan event leaks)
- Audio-before-video race is handled via a `pendingAudio` map so audio tracks arriving before the video track are stashed and merged when the video arrives
- `stopOnUnpublish: false` passed to LiveKit so ShareEngine owns the MediaStreamTrack lifecycle (single-source-of-truth stop)

### UX surfaces

- "Share" button on each monitored net row (disabled when any local share is active)
- "🔴 Sharing" indicator + Stop button when the local user is sharing to that net
- "📺" indicator + click-to-view when a remote share is active in that net
- Persistent "Sharing to <net>" status bar across the top of Home while local share is active (privacy reminder + quick-stop)
- Source picker modal: thumbnails of screens + windows, "share system audio" opt-in checkbox, Esc / backdrop-click cancels

### Privacy posture

- Sharer always sees the OS-level source picker before any frame is captured (Electron's standard desktopCapturer flow)
- Frames are SFrame-encrypted in the sharer's renderer using the room's existing voice key; the LiveKit SFU receives ciphertext and cannot decrypt
- Subscribers decrypt using the same key they already hold for voice
- No source name, window title, or frame data is logged or transmitted off-machine beyond the SFrame-encrypted track payload

### Known limitations

- macOS not tested (no macOS installer per scope)
- System-audio capture works on Linux/Windows entire-screen sources; window-specific sources are typically silent
- No annotation, recording, or remote control
- No admin-board "disable sharing" policy yet — any monitoring member can share
- Bandwidth: screen video over SFrame is heavy. Default constraints cap at 1920x1080 / 30fps; finer control deferred

## 16. Net Bridges (Hailfreq v1.5 feature)

Implemented in Plan 8c. Resolves spec §11 open questions: default mode = smart (VAD-driven), no sequence-number dedup in v1.5 (operators coordinate manually via visible status indicators), receiver attribution = bridge chirp on operator's local output + `(via <bridge name>)` participant identity suffix in the target net.

### Architecture

- A global `BridgeEngine` (one instance, lives at AppState scope — not per-server, because a bridge spans servers) holds active bridge configs and runs the relay loops
- Per direction, a `BridgeRunner` subscribes to the source room's remote audio tracks and, per mode, republishes them to the target room as the bridge operator's `LocalAudioTrack`
- The target room's `ExternalE2EEKeyProvider` re-encrypts on publish using the target net's SFrame key
- Bridge configs are persisted in local Settings (`Settings.bridges: BridgeConfig[]`); no Matrix state, no cross-machine sync in v1.5

### Three modes

| Mode | Behavior | Bandwidth | When to use |
|---|---|---|---|
| `smart` (default) | Open relay when source-net RMS exceeds `smartThreshold` (default 0.02). VAD-driven with 800ms hangover. | Medium | Most cases — natural-sounding allied comms with idle-channel suppression |
| `always-on` | Continuously relay all source audio | High | Tight-knit allied ops where you want zero-friction always-listening |
| `ptt-relay` | RMS-based gate with high threshold (0.08) and short hangover (300ms) — acts as PTT detection | Low | Allied org with high background chatter where you only care about explicit calls |

### Receiver attribution

When a relay opens, the operator's local audio output plays a brief 2-tone "bridge active" chirp (440Hz → 880Hz, 150ms total). Receivers in the target net see the operator's published track named `(via <bridge name>)`, making it visually obvious that the audio is bridged.

The chirp plays on the OPERATOR'S local output (their own audible confirmation), not in the relayed audio. Receiver-side audible attribution (chirp inside the published stream) would require PCM injection into the LocalAudioTrack; the visible identity suffix is sufficient for v1.5.

### Privacy posture

- Bridge operator can decrypt both nets (they hold both SFrame keys). This is intrinsic — bridges are an operator-trust feature.
- Receivers in the target net see clear visual indication that audio is bridged (identity suffix in their participant list).
- Bridge configs never leave the operator's machine.
- A bridge can be disabled (toggle off) at any time without deleting the config.

### Known limitations (v1.5)

- No sequence-number deduplication when multiple operators run the same bridge; receivers hear duplicates briefly. Operators see status indicators and coordinate manually.
- No auto-failover (if operator's machine crashes mid-bridge, another operator's bridge config must be manually enabled)
- No bridge config sync across machines / devices (per-machine local storage only)
- No text-message relay (voice only)
- No screen-share relay
- Bridge-active chirp plays on operator's local output only, not injected into the relayed audio
- Smart-mode and ptt-relay use a shared VAD implementation; LiveKit's native speaking detection is not used to keep the relay independent of remote VAD smoothing
