import { useEffect, useState } from "react";
import { Button } from "../../components/Button";

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

  async function playTestTone() {
    const ctx = new AudioContext();
    // Pipe through an audio element so we can use setSinkId
    // (AudioContext itself doesn't support setSinkId directly)
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
      // setSinkId is non-standard but supported by Chromium/Electron
      if (selected && "setSinkId" in audio) {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(selected);
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
        <Button onClick={() => void playTestTone()}>Test tone</Button>
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
