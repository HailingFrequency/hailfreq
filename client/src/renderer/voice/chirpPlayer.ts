const decodedCache = new Map<string, AudioBuffer>();

/**
 * Load a chirp by ID, decoding it via the Web Audio API.
 * Results are cached so repeated loads of the same ID do no IPC work.
 * Returns null for "builtin:none" or if the chirp has zero bytes.
 */
export async function loadChirp(audioCtx: AudioContext, id: string): Promise<AudioBuffer | null> {
  if (id === "builtin:none") return null;
  const cached = decodedCache.get(id);
  if (cached !== undefined) return cached;

  const bytes = await window.hailfreq.invoke("chirps:read", { id });
  if (bytes.length === 0) return null;

  // Slice to own ArrayBuffer — the Uint8Array from IPC may share a backing buffer
  // (SharedArrayBuffer in Electron's IPC context), which decodeAudioData requires
  // to be a detachable ArrayBuffer owned by the call.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const decoded = await audioCtx.decodeAudioData(ab);
  decodedCache.set(id, decoded);
  return decoded;
}

/**
 * Play a previously-loaded AudioBuffer through the given gain node.
 * Creates a one-shot BufferSource with a local gain stage for volume control.
 */
export function playChirp(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  gainNode: GainNode,
  volume = 0.7,
): void {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const localGain = audioCtx.createGain();
  localGain.gain.value = volume;
  source.connect(localGain);
  localGain.connect(gainNode);
  source.start();
}

/** Flush the decoded-audio cache (useful for testing). */
export function clearChirpCache(): void {
  decodedCache.clear();
}
