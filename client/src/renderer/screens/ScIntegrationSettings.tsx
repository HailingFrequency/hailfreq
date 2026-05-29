import { useEffect, useRef, useState } from "react";
import type { ScInstallCandidate } from "@shared/ipc";
import type { ScIntegrationSettings as ScIntegrationSettingsType } from "@shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

interface Props {
  serverId: string;
  /** Current per-server SC integration settings (may be undefined if never set). */
  scIntegration?: ScIntegrationSettingsType;
  /** Current global Game.log path (may be undefined if never set). */
  scInstallPath?: string;
  onSave: (patch: {
    scIntegration: ScIntegrationSettingsType;
    scInstallPath: string | undefined;
  }) => Promise<void>;
  onClose: () => void;
}

const DEFAULT_SC_INTEGRATION: ScIntegrationSettingsType = {
  enabled: false,
  autoInviteAllowlist: [],
  autoCloseOnDestruction: true,
};

export function ScIntegrationSettings({
  scIntegration,
  scInstallPath,
  onSave,
  onClose,
}: Props) {
  // --- Local form state (copies of props; only written back on Save) ---
  const [enabled, setEnabled] = useState(scIntegration?.enabled ?? DEFAULT_SC_INTEGRATION.enabled);
  const [allowlist, setAllowlist] = useState<string[]>(
    scIntegration?.autoInviteAllowlist ?? DEFAULT_SC_INTEGRATION.autoInviteAllowlist,
  );
  const [autoClose, setAutoClose] = useState(
    scIntegration?.autoCloseOnDestruction ?? DEFAULT_SC_INTEGRATION.autoCloseOnDestruction,
  );
  const [pathInput, setPathInput] = useState(scInstallPath ?? "");
  const [pathError, setPathError] = useState<string>("");
  const [pathValid, setPathValid] = useState<boolean | null>(null);

  const [allowlistInput, setAllowlistInput] = useState("");
  const [allowlistError, setAllowlistError] = useState("");

  const [candidates, setCandidates] = useState<ScInstallCandidate[] | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [detectError, setDetectError] = useState("");

  const [busy, setSaving] = useState(false);

  // Validate the path in pathInput whenever it changes (debounced).
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    setPathValid(null);
    setPathError("");

    if (!pathInput.trim()) return;

    validateTimer.current = setTimeout(() => {
      void window.hailfreq
        .invoke("sc:validatePath", { path: pathInput.trim() })
        .then((valid) => {
          setPathValid(valid);
          if (!valid) {
            setPathError("Path not found or not a valid Game.log file");
          }
        })
        .catch(() => {
          setPathValid(false);
          setPathError("Could not validate path");
        });
    }, 400);

    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [pathInput]);

  // Auto-detect: call sc:findInstall and render candidate list.
  async function handleAutoDetect() {
    setDetectBusy(true);
    setDetectError("");
    setCandidates(null);
    try {
      const found = await window.hailfreq.invoke("sc:findInstall");
      setCandidates(found);
      if (found.length === 0) {
        setDetectError("No Star Citizen installation found automatically.");
      }
    } catch {
      setDetectError("Auto-detect failed. Try browsing manually.");
    } finally {
      setDetectBusy(false);
    }
  }

  // Browse: open native file picker via sc:pickGameLog.
  async function handleBrowse() {
    try {
      const picked = await window.hailfreq.invoke("sc:pickGameLog");
      if (picked) {
        setPathInput(picked);
        setCandidates(null);
        setDetectError("");
      }
    } catch {
      setPathError("Could not open file picker");
    }
  }

  function handleSelectCandidate(candidate: ScInstallCandidate) {
    setPathInput(candidate.gameLogPath);
    setCandidates(null);
    setDetectError("");
  }

  function handleAddToAllowlist() {
    const handle = allowlistInput.trim();
    if (!handle) {
      setAllowlistError("Handle cannot be empty");
      return;
    }
    const lower = handle.toLowerCase();
    const duplicate = allowlist.some((h) => h.toLowerCase() === lower);
    if (duplicate) {
      setAllowlistError("This handle is already in the list");
      return;
    }
    setAllowlist((prev) => [...prev, handle]);
    setAllowlistInput("");
    setAllowlistError("");
  }

  function handleRemoveFromAllowlist(handle: string) {
    setAllowlist((prev) => prev.filter((h) => h !== handle));
  }

  async function handleSave() {
    setSaving(true);
    setPathError("");
    try {
      await onSave({
        scIntegration: {
          enabled,
          autoInviteAllowlist: allowlist,
          autoCloseOnDestruction: autoClose,
        },
        scInstallPath: pathInput.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setPathError(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const pathUnset = !pathInput.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex w-[30rem] max-h-[90vh] flex-col rounded-lg border border-slate-800 bg-slate-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold text-brand-400">Star Citizen Integration</h2>
          <p className="mt-1 text-xs text-slate-500">Per-server settings</p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Section 1: Enable toggle */}
          <section>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="text-sm text-slate-200">Watch Game.log for this server</span>
            </label>
            {enabled && pathUnset && (
              <p className="mt-2 ml-6 text-xs text-amber-400">
                Set a Game.log path below first — the watcher won&apos;t start until a valid path is configured.
              </p>
            )}
          </section>

          {/* Section 2: Game.log path */}
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Game.log path</p>
            <Input
              label="Path"
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                setCandidates(null);
              }}
              placeholder="/path/to/StarCitizen/LIVE/Game.log"
              error={pathError}
            />
            {pathValid === true && (
              <p className="mt-1 text-xs text-green-400">Path looks valid.</p>
            )}
            <div className="mt-2 flex gap-2">
              <Button variant="ghost" onClick={() => void handleAutoDetect()} disabled={detectBusy} className="text-xs px-3 py-1.5">
                {detectBusy ? "Detecting…" : "Auto-detect"}
              </Button>
              <Button variant="ghost" onClick={() => void handleBrowse()} className="text-xs px-3 py-1.5">
                Browse…
              </Button>
            </div>
            {detectError && (
              <p className="mt-2 text-xs text-rose-400">{detectError}</p>
            )}
            {candidates !== null && candidates.length > 0 && (
              <ul className="mt-2 rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
                {candidates.map((c) => (
                  <li key={c.gameLogPath}>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors"
                      onClick={() => handleSelectCandidate(c)}
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
          </section>

          {/* Section 3: Allowlist */}
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Auto-invite allowlist
            </p>
            <p className="mb-3 text-xs text-slate-400">
              RSI handles added here are auto-invited without a confirmation prompt when they board your ship.
            </p>
            {allowlist.length > 0 ? (
              <ul className="mb-3 rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
                {allowlist.map((handle) => (
                  <li key={handle} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-slate-200">{handle}</span>
                    <button
                      className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                      onClick={() => handleRemoveFromAllowlist(handle)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-slate-500 italic">No handles in the allowlist.</p>
            )}
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                placeholder="RSI handle"
                value={allowlistInput}
                onChange={(e) => {
                  setAllowlistInput(e.target.value);
                  setAllowlistError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddToAllowlist();
                  }
                }}
              />
              <Button variant="ghost" onClick={handleAddToAllowlist} className="shrink-0 text-sm">
                Add
              </Button>
            </div>
            {allowlistError && (
              <p className="mt-1 text-xs text-rose-400">{allowlistError}</p>
            )}
          </section>

          {/* Section 4: Auto-close toggle */}
          <section>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoClose}
                onChange={(e) => setAutoClose(e.target.checked)}
              />
              <span className="text-sm text-slate-200">Auto-close ship-net on destruction</span>
            </label>
            <p className="mt-1 ml-6 text-xs text-slate-500">
              Automatically leaves the ship net when Game.log reports your ship was destroyed.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-slate-800 p-4">
          <Button onClick={() => void handleSave()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
