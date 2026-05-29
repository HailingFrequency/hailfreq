# Contributing to Hailfreq

Thanks for the interest. Hailfreq is a small project and most decisions go through a single maintainer, but contributions are welcome — especially bug reports, focused feature PRs, and documentation improvements.

## Before you start

1. **Open an issue first** for non-trivial work. Spend 5 minutes describing what you want to change and why. Saves both of us from a wasted afternoon.
2. **Read the design specs** in [`docs/superpowers/specs/`](docs/superpowers/specs/) for the area you're touching. Hailfreq has a strong design discipline — knowing the threat model and the architectural shape matters.
3. **Read the relevant plan** in [`docs/superpowers/plans/`](docs/superpowers/plans/). Each major feature has a plan doc with task-by-task implementation notes.

## What's most welcome

- **Bug fixes with regression tests.** If you find a bug, add a vitest unit test that fails before your fix and passes after.
- **Documentation improvements.** Especially the public README, getting-started guides, and self-hosting instructions.
- **Polish PRs against the deferred items.** The deferred list lives in `docs/superpowers/specs/` known-limitations sections; small fixes against those are easy yes votes.
- **Translations.** Not currently set up but would be welcome — open an issue first.

## What's a hard sell

- **Architectural rewrites.** The codebase is the way it is because of specific design decisions; if you want to change the architecture, the conversation starts with the spec, not the code.
- **Feature additions to areas marked "out of scope"** in the spec. Voice messages, video calls, file sync, bots, public room directory — these are intentionally not in scope. The reasons are in §10 of the design spec.
- **Dependencies on new third-party services.** Hailfreq is meant to run on infrastructure the operator controls. New SaaS dependencies need a strong justification.

## Dev setup

The repo has two layers:

- **`client/`** — Electron + React + TypeScript desktop app
- **`server/`** — Docker Compose kit (Synapse + LiveKit + coturn + Caddy + livekit-auth)

### Client dev loop

See [`client/README.md`](client/README.md) for the full dev setup. Quick start:

```bash
cd client
npm ci
npm run dev          # development with HMR
npm run build        # production build
npm run dist:linux   # AppImage installer
npm run dist:windows # NSIS installer
npx vitest run       # unit tests
```

The client is Vite-bundled (renderer + main + preload as three separate Vite targets). Electron 42 with LiveKit 2.x and matrix-js-sdk 35.x.

### Server dev loop

See [`server/README.md`](server/README.md). The kit is Docker Compose plus a `Makefile` that wraps the common operations. Operators run it; contributors don't usually need to.

## Code conventions

- **TypeScript strict mode.** No `any`, no implicit casts. The few `as never` / `as unknown` escapes are for LiveKit overload mismatches and are documented inline.
- **Immutability for state.** React state goes through immutable spreads; engine state goes through helpers like `patchServer`.
- **Files focused, generally 200–400 lines, 800 max.** New responsibilities mean new files.
- **Pure functions for testable logic.** The decision functions (focusGate, audio relay teardown, share dedupe) are all pure for a reason — they're trivially testable.
- **Each significant feature gets a design doc** under `docs/superpowers/`. Plans 1 through 8c are the precedent.
- **Conventional Commits** for the subject line: `client(area): summary`, `server: summary`, `docs: summary`, `test: summary`. Body explains the why.
- **No noise in commits.** Don't include emoji unless the user explicitly asked for them; don't include "Co-Authored-By: Claude" or similar attribution lines.

## Pull requests

- One logical change per PR. If you find a related-but-different issue while working, open a separate PR for it.
- Reference the issue you're closing (`Closes #N`).
- Describe the change in plain English in the PR body. Don't make me read the diff to figure out what you were trying to do.
- Tests pass. Build is green. If the PR touches UI, post a screenshot.
- Review may be slow. Sorry; one-maintainer projects are like that.

## Reporting bugs

[GitHub Issues](../../issues) with the **Bug report** template. Include:

- Hailfreq version (find in Settings → About, or the installer filename)
- OS + version
- Steps to reproduce — ideally a minimal repro
- What you expected vs what actually happened
- Console output if there's an error

## Reporting security issues

Don't. See [`SECURITY.md`](SECURITY.md) for the private disclosure channel.

## Code of conduct

Be decent. Disagree without being a jerk. Take disagreements off-thread if they're getting heated. The maintainer reserves the right to close PRs/issues that don't meet that bar.
