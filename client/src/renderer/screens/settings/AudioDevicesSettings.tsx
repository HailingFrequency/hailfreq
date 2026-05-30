import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { useMicLevel } from "../../audio/useMicLevel";
import { playTestTone } from "../../audio/testTone";

interface Props {
  inputDeviceId?: string;
  outputDeviceId?: string;
  onChange: (devices: { inputDeviceId?: string; outputDeviceId?: string }) => void;
}

export function AudioDevicesSettings({ inputDeviceId, outputDeviceId, onChange }: Props) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState(inputDeviceId ?? "");
  const [output, setOutput] = useState(outputDeviceId ?? "");
  const level = useMicLevel(input || undefined);

  useEffect(() => {
    void (async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch { /* labels stay blank without permission */ }
      const all = await navigator.mediaDevices.enumerateDevices();
      setInputs(all.filter((d) => d.kind === "audioinput"));
      setOutputs(all.filter((d) => d.kind === "audiooutput"));
    })();
  }, []);

  const pct = Math.min(100, Math.round(Math.pow(level, 0.5) * 130));

  function pickInput(id: string) { setInput(id); onChange({ inputDeviceId: id, outputDeviceId: output || undefined }); }
  function pickOutput(id: string) { setOutput(id); onChange({ inputDeviceId: input || undefined, outputDeviceId: id }); }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Microphone</h3>
        <select value={input} onChange={(e) => pickInput(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm">
          <option value="">System default</option>
          {inputs.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label || "(unnamed device)"}</option>))}
        </select>
        <div className="h-3 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-500">Speak — the bar should move.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Speakers / output</h3>
        <select value={output} onChange={(e) => pickOutput(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm">
          <option value="">System default</option>
          {outputs.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label || "(default output)"}</option>))}
        </select>
        <Button onClick={() => void playTestTone(output || undefined)}>Test tone</Button>
      </div>
    </div>
  );
}
