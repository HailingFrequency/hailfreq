import { useEffect, useState } from "react";
import type { DesktopCaptureSource } from "@shared/ipc";

interface Props {
  onPick: (selection: { source: DesktopCaptureSource; captureAudio: boolean } | null) => void;
}

export function SourcePickerModal({ onPick }: Props) {
  const [sources, setSources] = useState<DesktopCaptureSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureAudio, setCaptureAudio] = useState(false);
  const [selected, setSelected] = useState<DesktopCaptureSource | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.hailfreq.invoke("share:listSources");
        setSources(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to enumerate screens");
      }
    })();
  }, []);

  // Esc to cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  const screens = sources?.filter((s) => s.kind === "screen") ?? [];
  const windows = sources?.filter((s) => s.kind === "window") ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={() => onPick(null)}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold text-brand-400">Choose what to share</h2>

        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!sources && !error && <p className="text-sm text-slate-400">Loading sources…</p>}

        {sources && (
          <>
            {screens.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Entire screen
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {screens.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={`rounded border p-2 text-left transition-colors ${
                        selected?.id === s.id
                          ? "border-brand-500 bg-slate-800"
                          : "border-slate-700 hover:border-slate-600"
                      }`}
                    >
                      <img src={s.thumbnailDataUrl} alt={s.name} className="mb-1 w-full rounded" />
                      <p className="text-xs text-slate-200">{s.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {windows.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Window
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {windows.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={`rounded border p-2 text-left transition-colors ${
                        selected?.id === s.id
                          ? "border-brand-500 bg-slate-800"
                          : "border-slate-700 hover:border-slate-600"
                      }`}
                    >
                      <img src={s.thumbnailDataUrl} alt={s.name} className="mb-1 w-full rounded" />
                      <p className="truncate text-xs text-slate-200">{s.name}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={captureAudio}
                  onChange={(e) => setCaptureAudio(e.target.checked)}
                />
                Also share system audio (Linux/Windows only; quality varies)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => onPick(null)}
                  className="text-sm text-slate-300 hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  disabled={!selected}
                  onClick={() => selected && onPick({ source: selected, captureAudio })}
                  className="rounded bg-brand-600 px-3 py-1 text-sm text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  Share
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
