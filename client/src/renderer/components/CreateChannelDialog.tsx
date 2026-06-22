import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "./Button";
import { Input } from "./Input";
import { createTextChannel } from "../matrix/channels";

interface CreateChannelDialogProps {
  client: MatrixClient;
  netId: string;
  netName: string;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

/**
 * Modal dialog for creating a text channel within an existing net.
 *
 * Mirrors the styling of CreateNetDialog: a fixed full-screen scrim with a
 * centered card form. On submit it calls createTextChannel and reports the new
 * channel id back to the caller via onCreated.
 */
export function CreateChannelDialog({
  client,
  netId,
  netName,
  onClose,
  onCreated,
}: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trimmedTopic = topic.trim();
      const channel = await createTextChannel(
        client,
        netId,
        name.trim(),
        trimmedTopic.length > 0 ? trimmedTopic : undefined,
      );
      onCreated(channel.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-96 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-brand-400">Add a text channel</h2>
        <p className="mt-1 text-xs text-slate-500">
          A new encrypted text channel in <span className="text-slate-300">{netName}</span>.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Input
            label="Channel name"
            placeholder="announcements, planning, roster…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <Input
            label="Topic (optional)"
            placeholder="What's this channel for?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create Channel"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
