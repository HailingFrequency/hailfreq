/**
 * Play a brief two-tone "bridge active" chirp on a target audio destination.
 * Uses Web Audio so no asset bundling is needed. Best-effort — silent if
 * AudioContext creation fails.
 */
export function playBridgeChirp(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 440;
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain1.gain.linearRampToValueAtTime(0, now + 0.075);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.08);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 880;
    gain2.gain.setValueAtTime(0, now + 0.075);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.085);
    gain2.gain.linearRampToValueAtTime(0, now + 0.15);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.075);
    osc2.stop(now + 0.16);

    setTimeout(() => void ctx.close(), 250);
  } catch (err) {
    console.error("[bridgeChirp] playback failed:", err);
  }
}
