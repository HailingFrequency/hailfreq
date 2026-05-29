import { useEffect, useRef, useState } from "react";
import type { VoiceEngine } from "../voice/VoiceEngine";

interface Props {
  voiceEngine: VoiceEngine | null;
  className?: string;
}

export function MicLevelBar({ voiceEngine, className }: Props) {
  const [level, setLevel] = useState(0);
  const targetRef = useRef(0);
  const displayRef = useRef(0);

  useEffect(() => {
    if (!voiceEngine) return;
    const unsub = voiceEngine.subscribeMicLevel((rms) => {
      targetRef.current = rms;
    });
    // Smooth the displayed value for a more natural meter feel:
    // fast attack, slow decay.
    const render = setInterval(() => {
      const t = targetRef.current;
      const d = displayRef.current;
      const next = t > d ? t * 0.5 + d * 0.5 : t * 0.1 + d * 0.9;
      displayRef.current = next;
      setLevel(next);
    }, 33);
    return () => {
      unsub();
      clearInterval(render);
    };
  }, [voiceEngine]);

  // Apply square-root gamma to compress the lower range into visible space,
  // then multiply by 130 so full-scale speech fills the bar.
  const pct = Math.min(100, Math.round(Math.pow(level, 0.5) * 130));

  return (
    <div
      className={`h-2 w-16 rounded bg-slate-800 overflow-hidden ${className ?? ""}`}
      title={`Mic level: ${pct}%`}
    >
      <div
        className="h-full bg-emerald-400 transition-[width] duration-75"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
