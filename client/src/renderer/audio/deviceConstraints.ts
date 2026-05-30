/** Base mic capture constraints, shared by the wizard, settings, and VoiceEngine. */
export const BASE_MIC_AUDIO = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 48000,
} as const;

/**
 * Build getUserMedia constraints for the mic, optionally pinned to a device.
 * Empty/undefined deviceId → system default.
 */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  if (deviceId) {
    return { audio: { ...BASE_MIC_AUDIO, deviceId: { exact: deviceId } } };
  }
  return { audio: { ...BASE_MIC_AUDIO } };
}
