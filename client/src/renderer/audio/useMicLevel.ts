import { useEffect, useRef, useState } from "react";

/**
 * Open the given input device and report a live RMS level (0..1). Re-opens on
 * deviceId change; tears down on unmount. Returns 0 until a device is selected.
 */
export function useMicLevel(deviceId: string | undefined): number {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!deviceId) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = setInterval(() => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          setLevel(Math.sqrt(s / buf.length));
        }, 50);
      } catch (err) {
        console.error("useMicLevel: getUserMedia failed", err);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      const s = streamRef.current; streamRef.current = null;
      const c = ctxRef.current; ctxRef.current = null;
      s?.getTracks().forEach((t) => t.stop());
      void c?.close();
    };
  }, [deviceId]);

  return level;
}
