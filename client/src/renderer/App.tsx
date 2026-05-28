import { useEffect, useState } from "react";
import "@shared/types";

export function App() {
  const [version, setVersion] = useState<string>("…");
  const [platform, setPlatform] = useState<string>("…");

  useEffect(() => {
    void window.hailfreq.invoke("app:version").then(setVersion);
    void window.hailfreq.invoke("app:platform").then(setPlatform);
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-brand-400">Hailfreq</h1>
        <p className="mt-2 text-slate-400">Privacy-first Matrix client</p>
        <p className="mt-6 text-xs text-slate-500">
          v{version} · {platform}
        </p>
      </div>
    </div>
  );
}
