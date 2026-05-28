# Hailfreq Client — Development

## Setup

```bash
npm ci
npm run dev           # Vite dev server + Electron with HMR
npm run test:unit     # Vitest unit tests
npm run test:e2e      # Playwright E2E (requires Plan 1 server stack)
npm run lint          # TypeScript strict-check (no emit)
```

## Layout

- `src/main/` — Electron main process (Node.js)
- `src/preload/` — Bridge between main and renderer
- `src/renderer/` — React UI (browser context with contextIsolation)
- `src/shared/` — Types shared between main and renderer
- `tests/unit/` — Pure-TS unit tests (no Electron runtime)
- `tests/e2e/` — Playwright tests driving the built app against a live Synapse

## E2E prerequisites

The E2E suite spins up Plan 1's server (`server/` in the repo root). You'll need:

- `podman` + `podman-compose` (or `docker compose`)
- The first-time rootless-podman uid 991 ownership fix may be required — see `server/docs/troubleshooting.md`

## Adding a new IPC channel

1. Add the channel definition to `src/shared/ipc.ts`
2. Implement the handler in `src/main/ipc.ts`
3. Call from renderer via `window.hailfreq.invoke("channel-name", ...args)`

Type safety flows end-to-end — the renderer call site won't compile if the channel doesn't exist or args don't match.

## matrix-js-sdk caveats

The crypto API surface has changed across recent matrix-js-sdk versions. If a method signature in `src/renderer/matrix/crypto.ts` doesn't match what your installed version exposes, check Element Web's source (https://github.com/element-hq/element-web) for the current reference patterns — they upgrade matrix-js-sdk frequently and their dialogs are the canonical examples.
