import { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";
import { Button } from "../components/Button";
import {
  bootstrapCrossSigning,
  bootstrapSecretStorageWithNewKey,
  createKeyBackup,
  hasCrossSigning,
} from "../matrix/crypto";

interface EncryptionSetupProps {
  client: MatrixClient;
  /** Used for UIAA if available (local-login). null for OIDC/CitizenID users. */
  password: string | null;
  onDone: () => void;
  onNeedsExistingRecovery: () => void;
}

type State =
  | { kind: "checking" }
  | { kind: "needs-existing-recovery"; reason: "account-already-bootstrapped" }
  | { kind: "running" }
  | { kind: "showing-key"; recoveryKey: string }
  | { kind: "error"; error: string };

export function EncryptionSetup({
  client,
  password,
  onDone,
  onNeedsExistingRecovery,
}: EncryptionSetupProps) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // If account already has cross-signing keys uploaded by another device,
        // we shouldn't generate fresh ones — instead route to the
        // "verify or restore from Recovery Key" flow (Task 17).
        if (await hasCrossSigning(client)) {
          setState({
            kind: "needs-existing-recovery",
            reason: "account-already-bootstrapped",
          });
          return;
        }

        setState({ kind: "running" });

        await bootstrapCrossSigning(client, async (makeRequest) => {
          // UIAA: Synapse rejects the request and asks for password auth.
          // For OIDC/CitizenID users we cannot satisfy UIAA in v1 —
          // first-time setup requires a local account in this build.
          if (!password) {
            throw new Error(
              "CitizenID-only first-time setup is not yet supported in this build. " +
                "Please use a local account or contact your guild admin.",
            );
          }
          await makeRequest({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: client.getSafeUserId() },
            password,
          });
        });

        const { recoveryKey } = await bootstrapSecretStorageWithNewKey(client);
        await createKeyBackup(client);
        setState({ kind: "showing-key", recoveryKey });
      } catch (err) {
        setState({
          kind: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When in needs-existing-recovery state, delegate to parent immediately
  useEffect(() => {
    if (state.kind === "needs-existing-recovery") {
      onNeedsExistingRecovery();
    }
  }, [state.kind, onNeedsExistingRecovery]);

  switch (state.kind) {
    case "checking":
    case "running":
      return <Centered>Setting up encryption keys…</Centered>;

    case "needs-existing-recovery":
      // Parent is notified via the effect above; show a brief message while transitioning
      return <Centered>Checking encryption status…</Centered>;

    case "error":
      return (
        <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4 p-6">
          <h1 className="text-xl font-semibold text-rose-400">Encryption setup failed</h1>
          <p className="text-sm text-slate-300">{state.error}</p>
          <Button
            variant="ghost"
            onClick={() => setState({ kind: "checking" })}
          >
            Retry
          </Button>
        </div>
      );

    case "showing-key":
      return (
        <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-6 p-6">
          <header>
            <h1 className="text-2xl font-semibold text-brand-400">
              Save your Recovery Key
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              This key is the only way to recover encrypted messages if you lose
              all your signed-in devices. Save it in a password manager or
              somewhere offline.{" "}
              <strong>Hailfreq does not store this key</strong> — there is no
              way to recover it later.
            </p>
          </header>

          <div className="rounded border border-slate-700 bg-slate-800 p-4">
            <code className="block break-all font-mono text-base text-brand-50">
              {state.recoveryKey}
            </code>
            <Button
              variant="ghost"
              className="mt-3 text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(state.recoveryKey);
              }}
            >
              Copy to clipboard
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have saved my Recovery Key somewhere safe
          </label>

          <Button onClick={onDone} disabled={!confirmed}>
            Continue to Hailfreq
          </Button>
        </div>
      );
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}
