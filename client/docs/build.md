# Building Hailfreq

## Prerequisites

- Node.js 20+ and npm
- For Linux builds: native build tools (`build-essential` on Debian/Ubuntu, `base-devel` on Arch)
- For Windows cross-builds from Linux: `wine` (best effort; native Windows is more reliable)

## Quick start

```bash
npm ci
npm run build
npm run dist:linux       # produces release/Hailfreq-*.AppImage
npm run dist:windows     # produces release/Hailfreq-*.exe (nsis)
```

## Outputs

- **Linux:** `release/Hailfreq-<version>-x86_64.AppImage` — single-file portable executable
- **Windows:** `release/Hailfreq-<version>-x64.exe` — nsis installer

## Code signing

Not yet wired up. To sign Windows builds, set `CSC_LINK` and `CSC_KEY_PASSWORD` env vars per electron-builder docs.
Linux AppImages are not commonly signed; AppImageHub will SHA-256 manifest them on upload.
