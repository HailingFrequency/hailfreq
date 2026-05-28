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
    algorithm: "SFrame-AES-256",
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
      // Wait for Megolm decryption to complete instead of a blind sleep.
      // The SDK emits "Event.decrypted" when decryption finishes (success or error).
      // Fall back to a 50ms poll if the event API is not callable.
      await new Promise<void>((resolve) => {
        try {
          (ev as any).once("Event.decrypted", () => resolve());
        } catch {
          // SDK version doesn't support once() — fall back to polling
          const interval = setInterval(() => {
            if (!ev.isBeingDecrypted()) {
              clearInterval(interval);
              resolve();
            }
          }, 50);
        }
      });
    }
    const content = ev.getContent();
    if (typeof content.key !== "string") continue;
    return base64Decode(content.key);
  }
  return null;
}

/**
 * Return all SFrame keys ever published in this room, ordered oldest → newest.
 * Each entry is { keyIndex, keyBytes, eventId, ts }. keyIndex is `position % 16`.
 */
export async function listSframeKeys(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<Array<{ keyIndex: number; keyBytes: Uint8Array; eventId: string; ts: number }>> {
  const room = client.getRoom(matrixRoomId);
  if (!room) return [];
  const out: Array<{ keyIndex: number; keyBytes: Uint8Array; eventId: string; ts: number }> = [];
  const events = room.getLiveTimeline().getEvents();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.getType() !== SFRAME_KEY_EVENT) continue;
    if (ev.isBeingDecrypted()) {
      await new Promise<void>((resolve) => {
        try {
          (ev as any).once("Event.decrypted", () => resolve());
        } catch {
          const interval = setInterval(() => {
            if (!ev.isBeingDecrypted()) {
              clearInterval(interval);
              resolve();
            }
          }, 50);
        }
      });
    }
    const content = ev.getContent();
    if (typeof content.key !== "string") continue;
    out.push({
      keyIndex: out.length % 16,
      keyBytes: base64Decode(content.key),
      eventId: ev.getId() ?? "",
      ts: ev.getTs(),
    });
  }
  return out;
}

/**
 * Upload a fresh key as a rotation. Returns the new key bytes and its assigned
 * 4-bit index (to pass to LiveKit's ExternalE2EEKeyProvider.setKey).
 *
 * Race safety: multiple eligible members may call this simultaneously after a
 * kick. Each upload succeeds independently; all members will observe all new
 * key events and apply the latest one. LiveKit handles overlapping key indices
 * by keeping the most-recently-applied value for each slot.
 */
export async function rotateSframeKey(
  client: MatrixClient,
  matrixRoomId: string,
): Promise<{ keyBytes: Uint8Array; keyIndex: number }> {
  const existing = await listSframeKeys(client, matrixRoomId);
  const keyBytes = generateSframeKey();
  await uploadSframeKey(client, matrixRoomId, keyBytes);
  // The new key occupies position `existing.length`, so index is existing.length % 16.
  return { keyBytes, keyIndex: existing.length % 16 };
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
