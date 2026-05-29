import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";

interface Props {
  initialDeviceId: string | undefined;
  onNext: (deviceId: string) => void;
  onSkip: () => void;
}

export function InputStep({ initialDeviceId, onNext, onSkip }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<string>(initialDeviceId ?? "");
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  // Enumerate input devices (requires permission — request getUserMedia first to unlock labels)
  useEffect(() => {
    void (async () => {
      try {
        // Request once to unlock labels
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        const all = await navigator.mediaDevices.enumerateDevices();
        const inputs = all.filter((d) => d.kind === "audioinput");
        setDevices(inputs);
        if (!selected && inputs[0]) setSelected(inputs[0].deviceId);
      } catch (err) {
        console.error("input step: enumerate failed", err);
      }
    })();
  }, []);

  // Hot-swap capture stream to the selected device + render level meter
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      try {
        // Tear down any prior stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        await ctxRef.current?.close();

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: selected } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
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
        console.error("input step: getUserMedia failed", err);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
    };
  }, [selected]);

  const pct = Math.min(100, Math.round(Math.pow(level, 0.5) * 130));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 1 of 3 — Microphone</h2>
      <p className="text-sm text-slate-400">Pick your input device and speak. The bar below shows your mic level.</p>

      <label className="block text-sm">
        <span className="block text-xs uppercase tracking-wider text-slate-400">Input device</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "(unnamed device)"}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-xs uppercase tracking-wider text-slate-400">Mic level</span>
        <div className="mt-1 h-3 w-full rounded bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">Speak — you should see the bar move.</p>
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onSkip}>Skip setup</Button>
        <Button disabled={!selected} onClick={() => onNext(selected)}>Next →</Button>
      </div>
    </div>
  );
}
