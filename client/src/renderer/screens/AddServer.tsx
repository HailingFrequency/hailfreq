import { useState } from "react";
import type { ServerEntry } from "@shared/types";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { normalizeUrl } from "./firstRunUtils";

interface AddServerProps {
  onAdded: (entry: ServerEntry) => void;
  onCancel?: () => void;
  cancellable: boolean;
}

async function probeHomeserver(url: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${url}/_matrix/client/versions`, { method: "GET" });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const body = await r.json();
    if (!Array.isArray(body?.versions)) return { ok: false, reason: "not a Matrix homeserver" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unreachable" };
  }
}

function deriveLabel(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host.split(".");
    const root = parts.length >= 2 ? parts[parts.length - 2] : host;
    return root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return url;
  }
}

export function AddServer({ onAdded, onCancel, cancellable }: AddServerProps) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const normalized = normalizeUrl(url);
      const probe = await probeHomeserver(normalized);
      if (!probe.ok) throw new Error(`Could not reach Matrix homeserver at ${normalized}: ${probe.reason}`);
      const finalLabel = label.trim() || deriveLabel(normalized);
      const entry = await window.hailfreq.invoke("servers:add", {
        label: finalLabel,
        serverUrl: normalized,
      });
      onAdded(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">
          {cancellable ? "Add a server" : "Welcome to Hailfreq"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your guild's Hailfreq server address.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Server URL"
          placeholder="radio.your-guild.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (!labelTouched) setLabel(deriveLabel(normalizeUrl(e.target.value || "x")));
          }}
          autoFocus
          required
        />
        <Input
          label="Display label"
          placeholder="My Guild"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
          hint="Shown in the server sidebar."
          error={error || undefined}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={!url.trim() || busy}>
            {busy ? "Checking…" : "Add server"}
          </Button>
          {cancellable && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
