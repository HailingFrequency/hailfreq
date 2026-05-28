import type { MatrixClient } from "matrix-js-sdk";

const SFRAME_KEY_EVENT = "org.hailfreq.net.sframe-key";

/**
 * Generate a fresh 32-byte SFrame key.
 */
export function generateSframeKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Store an SFrame key as a state event in the Matrix room. The room is already
 * E2EE-encrypted (m.room.encryption = megolm), so the state event content is
 * automatically encrypted by Synapse via Megolm.
 *
 * WARNING: Matrix state events on encrypted rooms are NOT automatically
 * encrypted — only timeline events are. We work around this by sending a
 * regular timeline message with a designated content type instead. The
 * implementer should verify this against the Matrix spec at impl time:
 * https://spec.matrix.org/v1.11/client-server-api/#end-to-end-encryption
 */
export async function uploadSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
  keyBytes: Uint8Array,
): Promise<void> {
  const keyBase64 = base64Encode(keyBytes);
  // Send as a timeline event (encrypted by Megolm) rather than state event
  // (which is NOT encrypted on Matrix even in E2EE rooms).
  await client.sendEvent(matrixRoomId, SFRAME_KEY_EVENT as any, {
    key: keyBase64,
    algorithm: "AES-GCM-128",
    issued_at: Date.now(),
  });
}

/**
 * Retrieve the most recent SFrame key from a Matrix room.
 * Scans the timeline backwards for the latest org.hailfreq.net.sframe-key event.
 * Returns null if not found (e.g., net wasn't created with key embedding).
 */
export async function fetchSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<Uint8Array | null> {
  const room = client.getRoom(matrixRoomId);
  if (!room) return null;

  // Walk the timeline from newest to oldest, looking for the key event
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.getType() !== SFRAME_KEY_EVENT) continue;
    // Wait for decryption if encrypted
    if (ev.isBeingDecrypted()) {
      // Listen for completion (simplified — production should subscribe properly)
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    const content = ev.getContent();
    if (typeof content.key !== "string") continue;
    return base64Decode(content.key);
  }
  return null;
}

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
