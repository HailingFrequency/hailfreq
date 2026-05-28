import { useEffect, useState } from "react";
import { VerifierEvent } from "matrix-js-sdk/lib/crypto-api/verification";
import type {
  VerificationRequest,
  Verifier,
  ShowSasCallbacks,
  EmojiMapping,
} from "matrix-js-sdk/lib/crypto-api/verification";

type Phase =
  | { kind: "accepting" }
  | { kind: "starting" }
  | { kind: "waiting-sas" }
  | { kind: "show-sas"; callbacks: ShowSasCallbacks; emojis: EmojiMapping[] }
  | { kind: "confirming" }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface EmojiVerificationProps {
  request: VerificationRequest;
  onDone: () => void;
}

/**
 * Overlay component that drives an SAS (emoji) cross-device verification flow.
 *
 * Flow:
 *   1. Accept the request (sends m.key.verification.ready).
 *   2. Start verification via m.sas.v1 (sends m.key.verification.start).
 *   3. Call verifier.verify() in the background to pump the protocol.
 *   4. Wait for VerifierEvent.ShowSas — the payload is ShowSasCallbacks.
 *   5. Display the 7 emojis from callbacks.sas.emoji.
 *   6. Confirm (callbacks.confirm()) or mismatch (callbacks.mismatch()).
 *   7. Dismiss the overlay via onDone().
 *
 * SDK: matrix-js-sdk 35.x / Rust crypto.
 * EmojiMapping = [emoji: string, name: string] tuple.
 */
export function EmojiVerification({ request, onDone }: EmojiVerificationProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "accepting" });

  useEffect(() => {
    let verifier: Verifier | undefined;
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        // Step 1: accept the request (if not already accepted)
        await request.accept();
        if (cancelled) return;

        // Step 2: start SAS verification — returns a Verifier
        setPhase({ kind: "starting" });
        verifier = await request.startVerification("m.sas.v1");
        if (cancelled) return;

        // Step 3: listen for ShowSas event before calling verify()
        setPhase({ kind: "waiting-sas" });

        verifier.once(VerifierEvent.ShowSas, (callbacks: ShowSasCallbacks) => {
          if (cancelled) return;
          const emojis = callbacks.sas.emoji ?? [];
          setPhase({ kind: "show-sas", callbacks, emojis });
        });

        verifier.once(VerifierEvent.Cancel, () => {
          if (cancelled) return;
          setPhase({ kind: "error", message: "Verification was cancelled by the other device." });
        });

        // Step 4: pump the protocol — resolves when done or rejects on cancel
        await verifier.verify();

        if (!cancelled) {
          setPhase({ kind: "done" });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Verification failed.";
          setPhase({ kind: "error", message });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (verifier && !verifier.hasBeenCancelled) {
        verifier.cancel(new Error("Component unmounted"));
      }
    };
  }, [request]);

  const handleConfirm = async (): Promise<void> => {
    if (phase.kind !== "show-sas") return;
    setPhase({ kind: "confirming" });
    try {
      await phase.callbacks.confirm();
      setPhase({ kind: "done" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Confirm failed.";
      setPhase({ kind: "error", message });
    }
  };

  const handleMismatch = (): void => {
    if (phase.kind !== "show-sas") return;
    phase.callbacks.mismatch();
    setPhase({ kind: "error", message: "You indicated the emojis did not match." });
  };

  const handleDismiss = (): void => {
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">
          Verify Device
        </h2>
        <p className="mb-4 text-sm text-slate-400">
          From:{" "}
          <span className="font-mono text-slate-300">
            {request.otherUserId}
            {request.otherDeviceId ? ` / ${request.otherDeviceId}` : ""}
          </span>
        </p>

        {phase.kind === "accepting" && (
          <StatusMessage>Accepting verification request…</StatusMessage>
        )}

        {phase.kind === "starting" && (
          <StatusMessage>Starting emoji verification…</StatusMessage>
        )}

        {phase.kind === "waiting-sas" && (
          <StatusMessage>Waiting for emoji data from the other device…</StatusMessage>
        )}

        {phase.kind === "show-sas" && (
          <>
            <p className="mb-3 text-sm text-slate-300">
              Compare these emojis with the other device. They must match exactly.
            </p>
            <EmojiGrid emojis={phase.emojis} />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => void handleConfirm()}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 active:bg-green-700"
              >
                They Match
              </button>
              <button
                onClick={handleMismatch}
                className="flex-1 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 active:bg-red-800"
              >
                They Don&apos;t Match
              </button>
            </div>
          </>
        )}

        {phase.kind === "confirming" && (
          <StatusMessage>Confirming…</StatusMessage>
        )}

        {phase.kind === "done" && (
          <>
            <p className="mb-4 text-sm text-green-400">
              Verification complete. This device is now trusted.
            </p>
            <button
              onClick={handleDismiss}
              className="w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500"
            >
              Close
            </button>
          </>
        )}

        {phase.kind === "error" && (
          <>
            <p className="mb-4 text-sm text-red-400">{phase.message}</p>
            <button
              onClick={handleDismiss}
              className="w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EmojiGrid({ emojis }: { emojis: EmojiMapping[] }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {emojis.map(([symbol, name], idx) => (
        <div
          key={idx}
          className="flex flex-col items-center rounded-lg bg-slate-700 p-2"
        >
          <span className="text-3xl leading-none" role="img" aria-label={name}>
            {symbol}
          </span>
          <span className="mt-1 text-xs text-slate-400">{name}</span>
        </div>
      ))}
    </div>
  );
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-slate-400">{children}</p>
  );
}
