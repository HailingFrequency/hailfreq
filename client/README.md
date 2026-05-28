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

Tactical-radio voice features (multi-net monitor, PTT, priority ducking, admin board) ship in Plan 4 and will evolve in subsequent plans.

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
