import { useState } from "react";
import type { FocusedAppPttSettings as FocusedAppPttSettingsType } from "@shared/types";
import { AudioDevicesSettings } from "./settings/AudioDevicesSettings";
import { FocusedAppPttSettingsContent } from "./FocusedAppPttSettings";
import { ScGameLogSettings } from "./settings/ScGameLogSettings";

type Section = "audio" | "ptt" | "sc";

interface Props {
  inputDeviceId?: string;
  outputDeviceId?: string;
  onChangeAudioDevices: (devices: { inputDeviceId?: string; outputDeviceId?: string }) => void;
  scInstallPath?: string;
  enabledServerNames: string[];
  onChangeScInstallPath: (path: string | undefined) => Promise<void> | void;
  focusedAppPtt?: FocusedAppPttSettingsType;
  onSaveFocusedAppPtt: (value: FocusedAppPttSettingsType) => Promise<void>;
  onClose: () => void;
}

export function SettingsMenu(props: Props) {
  const [section, setSection] = useState<Section>("audio");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="flex h-[32rem] w-full max-w-3xl overflow-hidden rounded border border-slate-700 bg-slate-900">
        <nav className="w-48 shrink-0 border-r border-slate-800 p-3">
          <div className="mb-2 px-2 text-xs uppercase tracking-wider text-slate-500">Settings</div>
          {([["audio", "Audio devices"], ["ptt", "PTT focus"], ["sc", "Star Citizen"]] as [Section, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`block w-full rounded px-2 py-1.5 text-left text-sm ${section === id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:bg-slate-800/50"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 p-4">
            <h2 className="text-base font-semibold text-slate-100">{section === "audio" ? "Audio devices" : section === "ptt" ? "PTT focus" : "Star Citizen"}</h2>
            <button onClick={props.onClose} className="text-slate-400 hover:text-slate-200">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {section === "audio" && (
              <AudioDevicesSettings
                inputDeviceId={props.inputDeviceId}
                outputDeviceId={props.outputDeviceId}
                onChange={props.onChangeAudioDevices}
              />
            )}
            {section === "ptt" && (
              <FocusedAppPttSettingsContent focusedAppPtt={props.focusedAppPtt} onSave={props.onSaveFocusedAppPtt} />
            )}
            {section === "sc" && (
              <ScGameLogSettings
                scInstallPath={props.scInstallPath}
                enabledServerNames={props.enabledServerNames}
                onChange={props.onChangeScInstallPath}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
