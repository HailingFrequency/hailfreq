# Hailfreq Client

Privacy-first Matrix desktop client. Electron + React + TypeScript. Windows + Linux.

After Plan 2, this client supports:

- First-run server URL configuration
- Login via CitizenID OIDC or local Synapse accounts
- Full Matrix end-to-end encryption setup (cross-signing + key backup + Recovery Key)
- SAS device verification with another signed-in device
- Auto-resume on relaunch
- Discord-style multi-server sidebar — be in multiple guilds simultaneously, switch with one click
- Per-server encryption isolation (each server has its own Recovery Key)
- In-app unread badges from inactive servers
- Logout flow
- Multi-net simultaneous voice monitor (LiveKit-backed) with SFrame E2EE
- Three PTT modes per net: tap-to-toggle, press-and-hold, voice activation
- Priority ducking (configurable per-net priority levels)
- Active SFrame key rotation on net-level kicks (forward secrecy)
- Per-net volume controls
- Admin / squad-leader board (Plan 5): create, rename, recolor, and delete nets; invite and remove members; promote to squad leader / demote; disconnect operators from voice; ban accounts from the server
- Full roster view across all visible nets with online-status indicators and RSI-verified badges
- Net properties editor (priority, color, name) accessible from the admin board
- Radio chirps on PTT (built-in tones + custom files from `userData/chirps/`)
- QR code device verification (alongside SAS emoji)
- Drag-to-reorder server sidebar
- System tray with minimize-to-tray
- OS-level desktop notifications (per-server toggle)
- Star Citizen integration: auto-create ship-nets when you board your ship, detect crew boarding via Game.log, one-click invite with CitizenID-verified RSI handle lookup, auto-close on destruction
- Focused-app PTT — gate the global PTT key on a chosen app (e.g., Star Citizen) having window focus, so the key passes through to chat / browser / terminal when the game isn't active
- Screen sharing — share a screen or window to one net at a time, SFrame E2EE same as voice, optional system audio; subscribers see a 📺 indicator and open a viewer pane
- Net Bridges — relay audio between two nets (typically across servers for allied-org coordination); three modes (smart/always-on/ptt-relay), bidirectional, bridge chirp + identity attribution on the target net so receivers know audio is bridged

## Quick start

```bash
npm ci
npm run dev          # development with HMR
npm run test:unit    # vitest unit tests
npm run test:e2e     # playwright e2e (requires Plan 1 server)
npm run dist:linux   # AppImage
npm run dist:windows # nsis installer
```

See:

- [`docs/build.md`](docs/build.md) — building installers
- [`docs/development.md`](docs/development.md) — dev environment + adding IPC channels
- [`docs/windows-build.md`](docs/windows-build.md) — Windows-specific build notes
