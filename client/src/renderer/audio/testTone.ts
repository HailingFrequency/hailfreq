/**
 * Play a short 660 Hz beep to a specific output device. Uses an <audio> element
 * + setSinkId because AudioContext can't target an arbitrary sink directly.
 * No-ops the sink (plays on default) if deviceId is empty or setSinkId is unsupported.
 */
export async function playTestTone(deviceId?: string): Promise<void> {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 660;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  osc.connect(gain).connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);

  const audio = new Audio();
  audio.srcObject = dest.stream;
  try {
    if (deviceId && "setSinkId" in audio) {
      await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
    }
  } catch (err) {
    console.error("setSinkId failed:", err);
  }
  void audio.play();
  setTimeout(() => {
    void ctx.close();
    audio.srcObject = null;
  }, 400);
}
