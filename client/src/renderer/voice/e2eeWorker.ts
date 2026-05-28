/**
 * Factory for the LiveKit E2EE Web Worker.
 *
 * LiveKit ships its own E2EE worker at the "livekit-client/e2ee-worker" export.
 * Vite resolves the `new URL(specifier, import.meta.url)` pattern at build time
 * and emits the worker as a separate chunk, so it is bundled correctly.
 *
 * Usage:
 *   const worker = createLiveKitE2EEWorker();
 *   // pass worker to NetConnection({ e2ee: { keyBytes, worker } })
 */
export function createLiveKitE2EEWorker(): Worker {
  return new Worker(
    new URL("livekit-client/e2ee-worker", import.meta.url),
    { type: "module" },
  );
}
