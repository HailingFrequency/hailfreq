# Getting started with Hailfreq

This guide is for testers who've been granted access to the test server. If you haven't been invited yet, see [test-server access request](../../issues/new?template=access-request.yml).

## 1. Download the installer

Grab the right installer for your OS from the [Releases](../../releases) page.

- **Linux:** `Hailfreq-0.1.0-x86_64.AppImage`
- **Windows:** `Hailfreq-0.1.0-x64.exe`

(macOS is not supported. There's no installer.)

## 2. Install

### Linux

```bash
chmod +x Hailfreq-0.1.0-x86_64.AppImage
./Hailfreq-0.1.0-x86_64.AppImage
```

The AppImage is self-contained — no install step, just run it. If you want it in your launcher, drop it somewhere persistent and create a `.desktop` file (or use AppImageLauncher).

### Windows

Double-click `Hailfreq-0.1.0-x64.exe`. The installer is unsigned, so Windows SmartScreen will show "Windows protected your PC" — click **More info → Run anyway**. This is a one-time thing per installer version. A signed installer is on the roadmap; for now, you're trusting the build directly from this repo's Releases page.

### Both

The first launch shows the "configure server URL" prompt. Use the URL provided in your access invite.

## 3. First sign-in

You have two login methods:

### CitizenID (recommended for SC players)

If you have a CitizenID account linked to your RSI handle, click **Sign in with CitizenID**. Your RSI handle becomes your verified identity in Hailfreq and crew detection (Star Citizen integration) maps directly to your account.

### Local account

If you don't have CitizenID, the server admin will give you a username + password for a local Matrix account. Click **Sign in with username/password** and use those credentials.

## 4. Encryption setup

On first sign-in, Hailfreq sets up Matrix end-to-end encryption automatically:

1. **Cross-signing keys** are generated and uploaded encrypted with your password.
2. **A Recovery Key** is displayed once. **Write it down.** This is the only way to recover your account if you lose your device and forget your password.
3. **Key backup** is initialized.

Storing the Recovery Key safely matters. Encryption protects you from the server operator seeing your messages, but the operator can't help you recover lost keys either.

## 5. Verify another device (optional, recommended)

If you sign in on a second device (or another tester signs in), you can verify each other via either:

- **SAS emoji** — both devices show the same emoji sequence; you confirm verbally
- **QR code** — one device shows a QR; the other scans it

Verification means the messages between you are confirmed end-to-end encrypted with no man-in-the-middle.

## 6. Try the voice features

The test server has some pre-created nets. Click **Monitor** on a net to start listening; the PTT key is configurable per-net via the net's settings.

Three PTT modes, set per-net:

- **Tap-to-toggle** — press once to open mic, again to close
- **Press-and-hold** — mic open while you hold the key
- **Voice activation** — mic opens when you speak (VAD threshold configurable)

If you want PTT to only fire when Star Citizen is the focused window, enable **Focused-app PTT** via the crosshair icon at the bottom of the server sidebar.

## 7. What to test (in priority order)

These are the highest-leverage things for us to learn before shipping wider:

### Voice quality
- Does the audio sound clean over your normal connection?
- Are there glitches when you tap PTT mid-sentence?
- When multiple people in a net speak, does priority ducking feel right or is it annoying?

### Star Citizen integration
- Launch SC, board your ship as pilot. Does Hailfreq auto-create the ship-net within ~1 second?
- Have a friend board your ship (in-game). Does Hailfreq show the boarding toast with the right RSI handle?
- Crash your ship intentionally. Does the ship-net auto-close? (This one is partly to validate the destruction regex, which is a placeholder pending real log data — so any feedback here is valuable.)

### Multi-server
- If you have access to multiple Hailfreq servers, does the sidebar render them all correctly?
- Switching between servers — any voice glitches?

### Net bridges
- Only relevant if you're in an allied-org scenario. Create a bridge between two of your nets via the **Bridges** tab in the admin board. Try each mode (smart / always-on / ptt-relay).

### Screen sharing
- Click **Share** on any monitored net. Pick a screen or window. Can other people in the net see it?
- Try sharing with system audio (check the box in the picker).

## 8. Report what you find

Anything broken or weird: [open a Bug report](../../issues/new?template=bug.yml).

Feature ideas: [open a Feature request](../../issues/new?template=feature.yml).

General impressions, UX confusions, "this works great but...": [open Feedback](../../issues/new?template=feedback.yml).

For security findings, **do not open a public issue.** See [`SECURITY.md`](../SECURITY.md).

## 9. Privacy expectations

- The test server's operator (the project maintainer) can see metadata (who is in which room, when you connect, room names) but cannot decrypt content (voice, chat, screen shares). Full threat model in [`docs/superpowers/specs/2026-05-26-hailfreq-design.md`](superpowers/specs/2026-05-26-hailfreq-design.md), §3.
- The test server has no SLA. If it's down, it's down. Report via Issues with `[test-server-down]` in the title.
- Test data on the server may be wiped between major test cycles. Don't rely on it for anything you can't lose.
