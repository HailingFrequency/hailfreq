import type { DesktopCaptureSource } from "@shared/ipc";

/**
 * Acquire a MediaStream from a chosen desktopCapturer source. Uses the
 * legacy `chromeMediaSource: "desktop"` constraints because Electron's
 * Chromium does not implement the standard getDisplayMedia source picker
 * (we provide our own picker via desktopCapturer.getSources).
 *
 * captureAudio: also requests the audio track. On Linux/Windows this works
 * for "entire screen" sources; on individual windows it's typically silent.
 * macOS does not support system-audio capture via this API.
 */
export async function acquireDisplayStream(
  source: DesktopCaptureSource,
  captureAudio: boolean,
): Promise<MediaStream> {
  const constraints: MediaStreamConstraints & {
    video: { mandatory: Record<string, unknown> };
    audio?: { mandatory: Record<string, unknown> };
  } = {
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  };
  if (captureAudio) {
    constraints.audio = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
      },
    };
  }
  return navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints);
}
