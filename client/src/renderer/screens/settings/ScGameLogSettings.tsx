import { useEffect, useRef, useState } from "react";
import type { ScInstallCandidate } from "@shared/ipc";
import { Button } from "../../components/Button";
import { deriveScWatchStatus, formatActivity } from "../../sc/watchStatus";

interface Props {
  /** Current global Game.log path (undefined if never set). */
  scInstallPath?: string;
  /** Display names of servers that currently have Ship Link enabled. */
  enabledServerNames: string[];
  /** Persist a new path (or undefined to clear). */
  onChange: (path: string | undefined) => Promise<void> | void;
}

interface WatchStatus {
  watching: boolean;
  lastLineAt: number | null;
}

export function ScGameLogSettings({ scInstallPath, enabledServerNames, onChange }: Props) {
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [candidates, setCandidates] = useState<ScInstallCandidate[] | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [pickError, setPickError] = useState("");
  const [status, setStatus] = useState<WatchStatus>({ watching: false, lastLineAt: null });
  const [now, setNow] = useState(() => Date.now());

  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate the configured path (debounced) whenever it changes.
  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    setPathValid(null);
    const p = scInstallPath?.trim();
    if (!p) return;
    validateTimer.current = setTimeout(() => {
      void window.hailfreq
        .invoke("sc:validatePath", { path: p })
        .then((valid) => setPathValid(valid))
        .catch(() => setPathValid(false));
    }, 300);
    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [scInstallPath]);

  // Poll watch status every 2s; refresh immediately on log activity / tailer change.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.hailfreq
        .invoke("sc:watchStatus")
        .then((s) => {
          if (!cancelled) setStatus({ watching: s.watching, lastLineAt: s.lastLineAt });
        })
        .catch(() => {
          if (!cancelled) setStatus({ watching: false, lastLineAt: null });
        });
    };
    refresh();
    const poll = setInterval(refresh, 2000);
    const offLine = window.hailfreq.onScLogLine(() => refresh());
    const offReplaced = window.hailfreq.onScTailerReplaced(() => refresh());
    return () => {
      cancelled = true;
      clearInterval(poll);
      offLine();
      offReplaced();
    };
  }, []);

  // Tick "now" once a second so the relative activity time stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleBrowse() {
    setPickError("");
    try {
      const picked = await window.hailfreq.invoke("sc:pickGameLog");
      if (picked) {
        setCandidates(null);
        setDetectError("");
        await onChange(picked);
      }
    } catch {
      setPickError("Could not open file picker");
    }
  }

  async function handleAutoDetect() {
    setDetectBusy(true);
    setDetectError("");
    setCandidates(null);
    try {
      const found = await window.hailfreq.invoke("sc:findInstall");
      setCandidates(found);
      if (found.length === 0) setDetectError("No Star Citizen installation found automatically.");
    } catch {
      setDetectError("Auto-detect failed. Try browsing manually.");
    } finally {
      setDetectBusy(false);
    }
  }

  async function handleSelectCandidate(candidate: ScInstallCandidate) {
    setCandidates(null);
    setDetectError("");
    await onChange(candidate.gameLogPath);
  }

  async function handleClear() {
    setCandidates(null);
    setDetectError("");
    setPickError("");
    await onChange(undefined);
  }

  const kind = deriveScWatchStatus({ scInstallPath, enabledServerNames, watching: status.watching });
  const statusLine = (() => {
    switch (kind) {
      case "unset":
        return { text: "No Game.log selected.", tone: "text-slate-400" };
      case "disabled":
        return {
          text: "Path set, but Ship Link isn't enabled on any server. Enable it from a server's Star Citizen Integration menu.",
          tone: "text-amber-400",
        };
      case "watching":
        return { text: `Watching ✓ — last activity ${formatActivity(status.lastLineAt, now)}`, tone: "text-green-400" };
      case "not-watching":
        return { text: "Not watching — Game.log not found at the configured path.", tone: "text-rose-400" };
    }
  })();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Star Citizen Game.log</h3>
        <p className="text-xs text-slate-500">
          Point Hailfreq at your Game.log so Ship Link can spin up a voice net (or invite your crew) when you board your ship.
        </p>
        <div className="rounded border border-slate-700 bg-slate-900 p-2 text-xs break-all">
          {scInstallPath ? (
            <span className="text-slate-200">{scInstallPath}</span>
          ) : (
            <span className="text-slate-500 italic">Not set</span>
          )}
        </div>
        {scInstallPath && pathValid === true && <p className="text-xs text-green-400">Path looks valid.</p>}
        {scInstallPath && pathValid === false && (
          <p className="text-xs text-rose-400">Path not found or not a valid Game.log file.</p>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void handleAutoDetect()} disabled={detectBusy} className="text-xs px-3 py-1.5">
            {detectBusy ? "Detecting…" : "Auto-detect"}
          </Button>
          <Button variant="ghost" onClick={() => void handleBrowse()} className="text-xs px-3 py-1.5">
            Browse…
          </Button>
          {scInstallPath && (
            <Button variant="ghost" onClick={() => void handleClear()} className="text-xs px-3 py-1.5">
              Clear
            </Button>
          )}
        </div>
        {pickError && <p className="text-xs text-rose-400">{pickError}</p>}
        {detectError && <p className="text-xs text-rose-400">{detectError}</p>}
        {candidates !== null && candidates.length > 0 && (
          <ul className="rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
            {candidates.map((c) => (
              <li key={c.gameLogPath}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors"
                  onClick={() => void handleSelectCandidate(c)}
                >
                  <span className="block text-xs text-brand-300 font-medium">
                    {c.branch} <span className="text-slate-500">({c.source})</span>
                  </span>
                  <span className="block text-xs text-slate-400 break-all">{c.gameLogPath}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-200">Ship Link status</h3>
        <p className={`text-xs ${statusLine.tone}`}>{statusLine.text}</p>
      </div>
    </div>
  );
}
