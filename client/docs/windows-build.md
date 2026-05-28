# Building the Windows installer

## Native (recommended)

On a Windows machine with Node.js 20+:

```cmd
git clone https://github.com/your-org/tactical-radio.git
cd tactical-radio\client
npm ci
npm run build
npm run dist:windows
```

Output: `release\Hailfreq-<version>-x64.exe`

## Cross-compile from Linux

Requires `wine` (best effort — some electron-builder features may not work). Install on Fedora/Nobara:

```bash
sudo dnf install wine
```

On Debian/Ubuntu:

```bash
sudo apt-get install wine
```

Then:

```bash
npm run dist:windows
```

If you hit `Error: Cannot find module 'app-builder-bin/win/x64/app-builder.exe'` or similar, the cross-build environment isn't fully set up. Native Windows build is more reliable.

## Code signing

To sign, set environment variables before the build:

```bash
export CSC_LINK=/path/to/certificate.pfx
export CSC_KEY_PASSWORD='your password'
npm run dist:windows
```

See electron-builder code-signing docs: https://www.electron.build/code-signing
