import { useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { restoreFromRecoveryKey } from "../matrix/crypto";

interface RestoreFromRecoveryKeyProps {
  client: MatrixClient;
  onRestored: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "restoring" }
  | { kind: "error"; error: string };

/**
 * Screen shown when the user logs in on a new device and needs to unlock
 * their encrypted history by providing their Recovery Key.
 *
 * The Recovery Key is used to decrypt SSSS, which in turn holds the Megolm
 * key backup decryption key.  Once the backup is restored the client has
 * access to all previously encrypted messages.
 */
export function RestoreFromRecoveryKey({
  client,
  onRestored,
}: RestoreFromRecoveryKeyProps) {
  const [recoveryKey, setRecoveryKey] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmed = recoveryKey.trim();
    if (!trimmed) {
      setState({ kind: "error", error: "Please enter your Recovery Key." });
      return;
    }

    setState({ kind: "restoring" });
    try {
      await restoreFromRecoveryKey(client, trimmed);
      onRestored();
    } catch (err) {
      setState({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const isRestoring = state.kind === "restoring";

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-400">
          Restore from Recovery Key
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          This device is new. Enter your Recovery Key to restore access to your
          encrypted messages. The key was shown when you first set up Hailfreq
          on another device.
        </p>
      </header>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4">
        <Input
          label="Recovery Key"
          placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX"
          value={recoveryKey}
          onChange={(e) => {
            setRecoveryKey(e.target.value);
            if (state.kind === "error") {
              setState({ kind: "idle" });
            }
          }}
          disabled={isRestoring}
          error={state.kind === "error" ? state.error : undefined}
          autoComplete="off"
          spellCheck={false}
        />

        <Button type="submit" disabled={isRestoring || !recoveryKey.trim()}>
          {isRestoring ? "Restoring…" : "Restore"}
        </Button>
      </form>

      {isRestoring && (
        <p className="text-center text-xs text-slate-500">
          Downloading and decrypting your key backup. This may take a moment…
        </p>
      )}
    </div>
  );
}
