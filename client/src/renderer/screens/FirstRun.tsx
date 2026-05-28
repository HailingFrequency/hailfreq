import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { normalizeUrl } from "./firstRunUtils";

interface FirstRunProps {
  onConfigured: (serverUrl: string) => void;
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

export function FirstRun({ onConfigured }: FirstRunProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const normalized = normalizeUrl(url);
    const probe = await probeHomeserver(normalized);
    setBusy(false);
    if (!probe.ok) {
      setError(`Could not reach Matrix homeserver at ${normalized}: ${probe.reason}`);
      return;
    }
    await window.hailfreq.invoke("settings:set", { serverUrl: normalized });
    onConfigured(normalized);
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">Welcome to Hailfreq</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter your guild's Hailfreq server address to get started.
        </p>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Server URL"
          placeholder="radio.your-guild.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          required
          hint="Your guild admin will share this with you."
          error={error || undefined}
        />
        <Button type="submit" disabled={!url.trim() || busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
