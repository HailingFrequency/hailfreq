import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { playTestTone } from "../../audio/testTone";

interface Props {
  initialDeviceId: string | undefined;
  onNext: (deviceId: string) => void;
  onBack: () => void;
  onSkip: () => void;
}

export function OutputStep({ initialDeviceId, onNext, onBack, onSkip }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState<string>(initialDeviceId ?? "");

  useEffect(() => {
    void (async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outs = all.filter((d) => d.kind === "audiooutput");
      setDevices(outs);
      if (!selected && outs[0]) setSelected(outs[0].deviceId);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Step 2 of 3 — Output</h2>
      <p className="text-sm text-slate-400">
        Pick where Hailfreq should play audio. Click "Test tone" to hear a quick beep.
      </p>

      <label className="block text-sm">
        <span className="block text-xs uppercase tracking-wider text-slate-400">Output device</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2"
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "(default output)"}
            </option>
          ))}
        </select>
      </label>

      <div>
        <Button onClick={() => void playTestTone(selected)}>Test tone</Button>
      </div>

      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onSkip}>Skip setup</Button>
          <Button disabled={!selected} onClick={() => onNext(selected)}>Next →</Button>
        </div>
      </div>
    </div>
  );
}
