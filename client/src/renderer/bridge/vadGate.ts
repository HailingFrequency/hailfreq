/**
 * Voice-activity gate. Polls the audio track's RMS level via an
 * AnalyserNode and emits open/close events with hysteresis.
 *
 * - Opens immediately when RMS exceeds `threshold`
 * - Closes after `hangoverMs` of continuous below-threshold audio
 *
 * Hysteresis ensures brief pauses don't chop the relay.
 */
export interface VadGateOptions {
  threshold: number;      // 0..1 RMS
  hangoverMs: number;     // default 800
  pollIntervalMs: number; // default 60
}

export interface VadGateEvents {
  onOpen?: () => void;
  onClose?: () => void;
}

const DEFAULT_HANGOVER_MS = 800;
const DEFAULT_POLL_MS = 60;

export class VadGate {
  private readonly audioContext: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly opts: Required<VadGateOptions>;
  private listeners: VadGateEvents = {};

  private isOpen = false;
  private belowSinceMs: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private rmsBuffer: Float32Array<ArrayBuffer>;

  constructor(
    sourceMediaStreamTrack: MediaStreamTrack,
    opts: Partial<VadGateOptions> = {},
  ) {
    this.opts = {
      threshold: opts.threshold ?? 0.02,
      hangoverMs: opts.hangoverMs ?? DEFAULT_HANGOVER_MS,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,
    };
    this.audioContext = new AudioContext();
    const stream = new MediaStream([sourceMediaStreamTrack]);
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);
    this.rmsBuffer = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
  }

  on(events: VadGateEvents): this {
    this.listeners = { ...this.listeners, ...events };
    return this;
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.tick(), this.opts.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.isOpen) {
      this.isOpen = false;
      this.listeners.onClose?.();
    }
    void this.audioContext.close();
  }

  isCurrentlyOpen(): boolean {
    return this.isOpen;
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.rmsBuffer);
    let sumSquares = 0;
    for (let i = 0; i < this.rmsBuffer.length; i++) {
      sumSquares += this.rmsBuffer[i] * this.rmsBuffer[i];
    }
    const rms = Math.sqrt(sumSquares / this.rmsBuffer.length);
    const now = Date.now();

    if (rms >= this.opts.threshold) {
      this.belowSinceMs = null;
      if (!this.isOpen) {
        this.isOpen = true;
        this.listeners.onOpen?.();
      }
    } else {
      if (this.isOpen) {
        if (this.belowSinceMs === null) {
          this.belowSinceMs = now;
        } else if (now - this.belowSinceMs >= this.opts.hangoverMs) {
          this.isOpen = false;
          this.belowSinceMs = null;
          this.listeners.onClose?.();
        }
      }
    }
  }
}
