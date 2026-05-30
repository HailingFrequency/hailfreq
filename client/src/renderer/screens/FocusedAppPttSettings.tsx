import { useEffect, useState } from "react";
import type { FocusedAppPttSettings as FocusedAppPttSettingsType } from "@shared/types";
import type { FocusedAppInfo } from "@shared/ipc";
import { Button } from "../components/Button";

interface ModalProps {
  /** Current global focused-app PTT settings (may be undefined if never set). */
  focusedAppPtt?: FocusedAppPttSettingsType;
  onSave: (value: FocusedAppPttSettingsType) => Promise<void>;
  onClose: () => void;
}

interface ContentProps {
  /** Current global focused-app PTT settings (may be undefined if never set). */
  focusedAppPtt?: FocusedAppPttSettingsType;
  onSave: (value: FocusedAppPttSettingsType) => Promise<void>;
  /**
   * Optional. When provided (modal usage) the form closes after a successful
   * save and the Cancel button is shown. When omitted (embedded usage) the form
   * stays open after save and no Cancel button is rendered.
   */
  onClose?: () => void;
}

const DEFAULT_SETTINGS: FocusedAppPttSettingsType = {
  enabled: false,
  allowlistEntries: [],
};

/**
 * The inner form for focused-app PTT settings. Contains all state + handlers and
 * the form JSX, with no modal overlay/header chrome. Embeddable inside the
 * SettingsMenu, or wrapped by the FocusedAppPttSettings modal below.
 */
export function FocusedAppPttSettingsContent({ focusedAppPtt, onSave, onClose }: ContentProps) {
  const initial = focusedAppPtt ?? DEFAULT_SETTINGS;

  const [enabledDraft, setEnabledDraft] = useState(initial.enabled);
  const [allowlistDraft, setAllowlistDraft] = useState<string[]>(initial.allowlistEntries);
  const [entryInput, setEntryInput] = useState("");
  const [entryError, setEntryError] = useState("");
  const [currentFocus, setCurrentFocus] = useState<FocusedAppInfo | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleShowCurrentFocus() {
    setFocusBusy(true);
    try {
      const focus = await window.hailfreq.invoke("focus:get");
      setCurrentFocus(focus);
    } catch (err) {
      setCurrentFocus(null);
      setSaveError(err instanceof Error ? err.message : "Failed to read focus");
    } finally {
      setFocusBusy(false);
    }
  }

  // Seed currentFocus on mount so the Wayland banner shows immediately
  // for Wayland users without requiring them to click "Show current focus".
  useEffect(() => {
    window.hailfreq.invoke("focus:get").then(setCurrentFocus).catch(() => {});
  }, []);

  function handleAddEntry() {
    const trimmed = entryInput.trim();
    if (!trimmed) {
      setEntryError("Entry cannot be empty");
      return;
    }
    if (allowlistDraft.some((e) => e.toLowerCase() === trimmed.toLowerCase())) {
      setEntryError("This entry is already in the list");
      return;
    }
    setAllowlistDraft((prev) => [...prev, trimmed]);
    setEntryInput("");
    setEntryError("");
  }

  function handleRemoveEntry(entry: string) {
    setAllowlistDraft((prev) => prev.filter((e) => e !== entry));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ enabled: enabledDraft, allowlistEntries: allowlistDraft });
      onClose?.();
    } catch (err) {
      setSaveError(err instanceof Error ? `Save failed: ${err.message}` : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Description */}
      <p className="text-xs text-slate-400">
        Only fire the PTT key when one of these apps has window focus. Leave disabled to keep
        the global &ldquo;PTT works everywhere&rdquo; behavior. Match is a case-insensitive
        substring on the focused window&apos;s process name or title.
      </p>

      {/* Wayland warning — shown when we know we are on a Wayland session */}
      {currentFocus?.isWayland && (
        <div className="rounded border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-200">
          Wayland has no portable focused-window API. Focus gating is disabled on this session;
          the PTT key will fire as if always permitted. X11 sessions work normally.
        </div>
      )}

      {/* Section 1: Enable toggle */}
      <section>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={enabledDraft}
            onChange={(e) => setEnabledDraft(e.target.checked)}
          />
          <span className="text-sm text-slate-200">Enable focus gating</span>
        </label>
        {enabledDraft && allowlistDraft.length === 0 && (
          <p className="mt-2 ml-6 text-xs text-amber-400">
            Add at least one allowlist entry — otherwise PTT will be blocked in every app.
          </p>
        )}
      </section>

      {/* Section 2: Allowlist editor */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Allowlist (process name or window title substrings)
        </p>
        <p className="mb-3 text-xs text-slate-400">
          PTT fires only when the focused window&apos;s process name or title contains one of
          these strings (case-insensitive).
        </p>
        {allowlistDraft.length > 0 ? (
          <ul className="mb-3 rounded border border-slate-700 bg-slate-800 divide-y divide-slate-700">
            {allowlistDraft.map((entry) => (
              <li key={entry} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm font-mono text-slate-200">{entry}</span>
                <button
                  className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                  onClick={() => handleRemoveEntry(entry)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-xs text-slate-500 italic">No entries in the allowlist.</p>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
            placeholder="e.g. StarCitizen"
            value={entryInput}
            onChange={(e) => {
              setEntryInput(e.target.value);
              setEntryError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddEntry();
              }
            }}
          />
          <Button variant="ghost" onClick={handleAddEntry} className="shrink-0 text-sm">
            Add
          </Button>
        </div>
        {entryError && (
          <p className="mt-1 text-xs text-rose-400">{entryError}</p>
        )}
      </section>

      {/* Section 3: Show current focus debug */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Debug
        </p>
        <Button
          variant="ghost"
          onClick={() => void handleShowCurrentFocus()}
          disabled={focusBusy}
          className="text-xs px-3 py-1.5"
        >
          {focusBusy ? "Reading…" : "Show current focus"}
        </Button>
        {currentFocus && (
          <div className="mt-2 rounded border border-slate-700 bg-slate-800 p-2 text-xs text-slate-300">
            <p>
              Process:{" "}
              <code className="font-mono text-slate-100">
                {currentFocus.processName ?? "(none)"}
              </code>
            </p>
            <p className="mt-1">
              Title:{" "}
              <code className="font-mono text-slate-100">
                {currentFocus.title ?? "(none)"}
              </code>
            </p>
          </div>
        )}
      </section>

      {saveError && (
        <p className="text-xs text-rose-400">{saveError}</p>
      )}

      {/* Footer actions */}
      <div className="flex gap-3 border-t border-slate-800 pt-4">
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {onClose && (
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Standalone modal wrapper: renders the overlay + header chrome and delegates
 * the form to FocusedAppPttSettingsContent.
 */
export function FocusedAppPttSettings({ focusedAppPtt, onSave, onClose }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex w-[30rem] max-h-[90vh] flex-col rounded-lg border border-slate-800 bg-slate-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold text-brand-400">Focused-app PTT</h2>
          <p className="mt-1 text-xs text-slate-500">Global PTT focus-gate settings</p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          <FocusedAppPttSettingsContent
            focusedAppPtt={focusedAppPtt}
            onSave={onSave}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
