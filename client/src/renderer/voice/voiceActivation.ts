export interface VoiceActivationConfig {
  audioCtx: AudioContext;
  micSource: MediaStreamAudioSourceNode;
  /** Threshold in dBFS (negative). Typical: -45. Higher (less negative) = less sensitive. */
  thresholdDb: number;
  /** Frames above threshold required to trigger start (~30ms at 60fps polling). Default: 2. */
  triggerFrames?: number;
  /** Hangover delay in ms before stop. Default: 400. */
  hangoverMs?: number;
  /** Called when audio crosses threshold and stays above for triggerFrames. */
  onStart: () => void;
  /** Called after hangover when audio falls below threshold. */
  onStop: () => void;
}

export class VoiceActivationDetector {
  private readonly analyser: AnalyserNode;
  private readonly buffer: Uint8Array<ArrayBuffer>;
  private triggered = false;
  private framesAboveThreshold = 0;
  private hangoverTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private readonly thresholdLinear: number;
  private readonly triggerFrames: number;
  private readonly hangoverMs: number;
  private readonly onStart: () => void;
  private readonly onStop: () => void;
  private stopped = false;

  constructor(cfg: VoiceActivationConfig) {
    this.analyser = cfg.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buffer = new Uint8Array(this.analyser.fftSize) as Uint8Array<ArrayBuffer>;
    cfg.micSource.connect(this.analyser);

    // dBFS to linear amplitude: 10^(dB/20)
    this.thresholdLinear = Math.pow(10, cfg.thresholdDb / 20);
    this.triggerFrames = cfg.triggerFrames ?? 2;
    this.hangoverMs = cfg.hangoverMs ?? 400;
    this.onStart = cfg.onStart;
    this.onStop = cfg.onStop;
  }

  start(): void {
    if (!this.stopped && this.rafId !== null) return; // already running
    this.stopped = false;

    const tick = () => {
      if (this.stopped) return;

      this.analyser.getByteTimeDomainData(this.buffer);
      const rms = computeRms(this.buffer);

      if (rms > this.thresholdLinear) {
        this.framesAboveThreshold++;
        // Cancel any pending hangover when signal comes back above threshold
        if (this.hangoverTimer !== null) {
          clearTimeout(this.hangoverTimer);
          this.hangoverTimer = null;
        }
        if (this.framesAboveThreshold >= this.triggerFrames && !this.triggered) {
          this.triggered = true;
          this.onStart();
        }
      } else {
        this.framesAboveThreshold = 0;
        if (this.triggered && this.hangoverTimer === null) {
          this.hangoverTimer = setTimeout(() => {
            this.triggered = false;
            this.hangoverTimer = null;
            this.onStop();
          }, this.hangoverMs);
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.stopped = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.hangoverTimer !== null) {
      clearTimeout(this.hangoverTimer);
      this.hangoverTimer = null;
    }

    // If we were transmitting, fire onStop so the caller can clean up
    if (this.triggered) {
      this.triggered = false;
      this.onStop();
    }

    this.analyser.disconnect();
  }
}

/** Compute RMS of an 8-bit unsigned time-domain buffer (128 = silence centre). */
function computeRms(buffer: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buffer.length);
}
