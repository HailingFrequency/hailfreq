import { useState } from "react";
import { InputStep } from "./audioSetup/InputStep";
import { OutputStep } from "./audioSetup/OutputStep";
import { PttStep } from "./audioSetup/PttStep";

interface Props {
  onComplete: () => void;
}

export function AudioSetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<"input" | "output" | "ptt">("input");
  const [inputDeviceId, setInputDeviceId] = useState<string>("");
  const [outputDeviceId, setOutputDeviceId] = useState<string>("");

  async function persistAndFinish(_opts?: { defaultMode?: string; defaultKey?: string | null }) {
    await window.hailfreq.invoke("settings:setAudioDevices", {
      inputDeviceId: inputDeviceId || undefined,
      outputDeviceId: outputDeviceId || undefined,
    });
    await window.hailfreq.invoke("settings:setAudioSetupComplete", { value: true });
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900 p-6">
        {step === "input" && (
          <InputStep
            initialDeviceId={inputDeviceId || undefined}
            onNext={(id) => {
              setInputDeviceId(id);
              setStep("output");
            }}
            onSkip={() => void persistAndFinish()}
          />
        )}
        {step === "output" && (
          <OutputStep
            initialDeviceId={outputDeviceId || undefined}
            onNext={(id) => {
              setOutputDeviceId(id);
              setStep("ptt");
            }}
            onBack={() => setStep("input")}
            onSkip={() => void persistAndFinish()}
          />
        )}
        {step === "ptt" && (
          <PttStep
            onFinish={(cfg) => void persistAndFinish(cfg)}
            onBack={() => setStep("output")}
            onSkip={() => void persistAndFinish()}
          />
        )}
      </div>
    </div>
  );
}
