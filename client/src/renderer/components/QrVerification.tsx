import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { VerifierEvent, VerificationPhase, VerificationRequestEvent } from "matrix-js-sdk/lib/crypto-api/verification";
import type {
  VerificationRequest,
  Verifier,
  ShowQrCodeCallbacks,
} from "matrix-js-sdk/lib/crypto-api/verification";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QrMode =
  | "qr-show"  // generate + display our QR code for the other device to scan
  | "qr-scan"; // paste the other device's QR payload as text

type Phase =
  | { kind: "accepting" }
  | { kind: "generating-qr" }
  | { kind: "show-qr"; dataUrl: string }
  | { kind: "waiting-reciprocate" }
  | { kind: "reciprocate"; callbacks: ShowQrCodeCallbacks }
  | { kind: "paste-input" }
  | { kind: "scanning" }
  | { kind: "confirming" }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface QrVerificationProps {
  request: VerificationRequest;
  mode: QrMode;
  onDone: (verified: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * QR-code device verification overlay.
 *
 * Two modes:
 *  - "qr-show":  Accept the request, call generateQRCode() once it reaches Ready phase,
 *                render the resulting bytes as a QR image. When the other side scans it,
 *                a ShowReciprocateQr event arrives; we prompt the user to confirm.
 *
 *  - "qr-scan":  Accept the request, show a textarea for the user to paste the other
 *                device's QR payload (as a raw string). We decode it from Latin-1 bytes,
 *                then call request.scanQRCode(). The returned verifier's verify() pump
 *                completes the flow.
 *
 * SDK: matrix-js-sdk 35.x / Rust crypto.
 * - generateQRCode() → Promise<Uint8ClampedArray | undefined> (returns after Ready phase)
 * - scanQRCode(qrCodeData: Uint8ClampedArray) → Promise<Verifier>
 * - VerifierEvent.ShowReciprocateQr payload → ShowQrCodeCallbacks { confirm(), cancel() }
 */
export function QrVerification({ request, mode, onDone }: QrVerificationProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "accepting" });
  const verifierRef = useRef<Verifier | undefined>(undefined);
  const cancelledRef = useRef(false);
  const [pasteValue, setPasteValue] = useState("");

  // -------------------------------------------------------------------------
  // QR-show flow
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (mode !== "qr-show") return;

    let cancelled = false;
    cancelledRef.current = false;

    const run = async (): Promise<void> => {
      try {
        // Step 1: Accept the request (sends .ready)
        await request.accept();
        if (cancelled) return;

        setPhase({ kind: "generating-qr" });

        // Step 2: generateQRCode() works once the phase reaches Ready.
        // The SDK transitions to Ready after .ready is exchanged.
        // We poll via VerificationRequestEvent.Change to know when it is ready.
        const qrBytes = await waitForQrBytes(request, () => cancelled);
        if (cancelled) return;

        if (!qrBytes) {
          setPhase({
            kind: "error",
            message: "The other device does not support QR code scanning. Try emoji verification instead.",
          });
          return;
        }

        // Step 3: render the bytes as a QR data URL via the qrcode library.
        // generateQRCode() returns the raw Matrix QR payload bytes (not a URL or text string).
        // We must pass the raw bytes directly to QRCode.toDataURL as a Buffer/Uint8Array.
        const dataUrl = await renderQrBytes(qrBytes);
        if (cancelled) return;

        setPhase({ kind: "show-qr", dataUrl });

        // Step 4: Wait for the other side to scan us → ShowReciprocateQr event fires.
        // We need a verifier object to listen on; it appears on request.verifier once
        // the other side sends m.key.verification.start (m.reciprocate.v1).
        const verifier = await waitForVerifier(request, () => cancelled);
        if (cancelled) return;
        if (!verifier) return; // cancelled or error path already set

        verifierRef.current = verifier;
        setPhase({ kind: "waiting-reciprocate" });

        verifier.once(VerifierEvent.ShowReciprocateQr, (callbacks: ShowQrCodeCallbacks) => {
          if (cancelled) return;
          setPhase({ kind: "reciprocate", callbacks });
        });

        verifier.once(VerifierEvent.Cancel, () => {
          if (cancelled) return;
          setPhase({ kind: "error", message: "Verification was cancelled by the other device." });
        });

        await verifier.verify();

        if (!cancelled) {
          setPhase({ kind: "done" });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "QR verification failed.";
          setPhase({ kind: "error", message });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      const v = verifierRef.current;
      if (v && !v.hasBeenCancelled) {
        v.cancel(new Error("Component unmounted"));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, mode]);

  // -------------------------------------------------------------------------
  // QR-scan (paste) flow: accept + show paste UI
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (mode !== "qr-scan") return;

    let cancelled = false;
    cancelledRef.current = false;

    const run = async (): Promise<void> => {
      try {
        await request.accept();
        if (cancelled) return;
        setPhase({ kind: "paste-input" });
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to accept request.";
          setPhase({ kind: "error", message });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      const v = verifierRef.current;
      if (v && !v.hasBeenCancelled) {
        v.cancel(new Error("Component unmounted"));
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, mode]);

  // -------------------------------------------------------------------------
  // Paste-submit handler
  // -------------------------------------------------------------------------

  const handlePasteSubmit = async (): Promise<void> => {
    const raw = pasteValue.trim();
    if (!raw) return;

    setPhase({ kind: "scanning" });
    try {
      // Decode the pasted string into bytes using Latin-1 (matrix QR payloads are binary).
      const bytes = stringToUint8ClampedArray(raw);
      const verifier = await request.scanQRCode(bytes);
      verifierRef.current = verifier;

      setPhase({ kind: "confirming" });

      verifier.once(VerifierEvent.Cancel, () => {
        if (cancelledRef.current) return;
        setPhase({ kind: "error", message: "Verification was cancelled by the other device." });
      });

      await verifier.verify();
      setPhase({ kind: "done" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "QR scan failed.";
      setPhase({ kind: "error", message });
    }
  };

  // -------------------------------------------------------------------------
  // Reciprocate confirm / cancel handlers
  // -------------------------------------------------------------------------

  const handleReciprocateConfirm = (): void => {
    if (phase.kind !== "reciprocate") return;
    phase.callbacks.confirm();
    setPhase({ kind: "confirming" });
  };

  const handleReciprocateCancel = (): void => {
    if (phase.kind !== "reciprocate") return;
    phase.callbacks.cancel();
    setPhase({ kind: "error", message: "Verification cancelled." });
  };

  const handleDismiss = (): void => {
    const verified = phase.kind === "done";
    onDone(verified);
  };

  const handleCancel = async (): Promise<void> => {
    await request.cancel({ reason: "User declined", code: "m.user" }).catch(() => undefined);
    onDone(false);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">
          {mode === "qr-show" ? "Show QR Code" : "Scan QR Code"}
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

        {phase.kind === "generating-qr" && (
          <StatusMessage>Generating QR code…</StatusMessage>
        )}

        {phase.kind === "show-qr" && (
          <>
            <p className="mb-3 text-sm text-slate-300">
              Scan this QR code with the other device to verify.
            </p>
            <div className="flex justify-center rounded-lg bg-white p-4">
              <img
                src={phase.dataUrl}
                alt="Verification QR code"
                className="h-48 w-48"
              />
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Waiting for the other device to scan…
            </p>
            <button
              onClick={() => void handleCancel()}
              className="mt-4 w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500"
            >
              Cancel
            </button>
          </>
        )}

        {phase.kind === "waiting-reciprocate" && (
          <StatusMessage>QR scanned — waiting for confirmation from the other device…</StatusMessage>
        )}

        {phase.kind === "reciprocate" && (
          <>
            <p className="mb-4 text-sm text-slate-300">
              The other device scanned your QR code. Did you initiate this verification from that device?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleReciprocateConfirm}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 active:bg-green-700"
              >
                Yes, Confirm
              </button>
              <button
                onClick={handleReciprocateCancel}
                className="flex-1 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 active:bg-red-800"
              >
                No, Cancel
              </button>
            </div>
          </>
        )}

        {phase.kind === "paste-input" && (
          <>
            <p className="mb-3 text-sm text-slate-300">
              On the other device, find the QR code verification screen and copy the QR payload text. Paste it below.
            </p>
            <textarea
              className="w-full rounded-lg bg-slate-700 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
              placeholder="Paste QR payload here…"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
            />
            <div className="mt-3 flex gap-3">
              <button
                onClick={() => void handlePasteSubmit()}
                disabled={!pasteValue.trim()}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Submit
              </button>
              <button
                onClick={() => void handleCancel()}
                className="flex-1 rounded-lg bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.kind === "scanning" && (
          <StatusMessage>Processing QR code…</StatusMessage>
        )}

        {phase.kind === "confirming" && (
          <StatusMessage>Confirming with the other device…</StatusMessage>
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

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-slate-400">{children}</p>
  );
}

// ---------------------------------------------------------------------------
// SDK helpers
// ---------------------------------------------------------------------------

/**
 * Wait until request.generateQRCode() returns data (requires Ready phase).
 * Polls via VerificationRequestEvent.Change.
 */
async function waitForQrBytes(
  request: VerificationRequest,
  isCancelled: () => boolean,
): Promise<Uint8ClampedArray | undefined> {
  // Try immediately first (may already be in Ready phase)
  const immediate = await request.generateQRCode();
  if (immediate !== undefined || isCancelled()) return immediate;

  return new Promise<Uint8ClampedArray | undefined>((resolve) => {
    const onChange = (): void => {
      if (isCancelled()) {
        request.off(VerificationRequestEvent.Change, onChange);
        resolve(undefined);
        return;
      }
      // Stop if we've moved past Ready (cancelled, done, etc.)
      if (request.phase >= VerificationPhase.Started) {
        request.off(VerificationRequestEvent.Change, onChange);
        resolve(undefined);
        return;
      }
      void request.generateQRCode().then((bytes) => {
        if (bytes !== undefined) {
          request.off(VerificationRequestEvent.Change, onChange);
          resolve(bytes);
        }
      });
    };
    request.on(VerificationRequestEvent.Change, onChange);
  });
}

/**
 * Wait until request.verifier is populated (other side sent .start after scanning our QR).
 */
async function waitForVerifier(
  request: VerificationRequest,
  isCancelled: () => boolean,
): Promise<Verifier | undefined> {
  if (request.verifier) return request.verifier;

  return new Promise<Verifier | undefined>((resolve) => {
    const onChange = (): void => {
      if (isCancelled()) {
        request.off(VerificationRequestEvent.Change, onChange);
        resolve(undefined);
        return;
      }
      if (request.phase >= VerificationPhase.Cancelled) {
        request.off(VerificationRequestEvent.Change, onChange);
        resolve(undefined);
        return;
      }
      if (request.verifier) {
        request.off(VerificationRequestEvent.Change, onChange);
        resolve(request.verifier);
      }
    };
    request.on(VerificationRequestEvent.Change, onChange);
  });
}

/**
 * Convert a string to Uint8ClampedArray using Latin-1 / code-point-per-byte encoding.
 * Matrix QR payloads are binary; pasting them as-is and decoding back this way
 * is the best-effort approach for the text-paste path.
 */
function stringToUint8ClampedArray(str: string): Uint8ClampedArray {
  const result = new Uint8ClampedArray(str.length);
  for (let i = 0; i < str.length; i++) {
    result[i] = str.charCodeAt(i) & 0xff;
  }
  return result;
}

/**
 * Render a Uint8ClampedArray of Matrix QR bytes as a base64 data URL using the qrcode library.
 *
 * NOTE: The matrix QR payload is a *binary* buffer, not a text string. The qrcode library
 * can encode arbitrary binary data when given a Buffer. We pass the bytes as a Node Buffer
 * (available in the Electron renderer) so the library treats it as binary mode.
 */
async function renderQrBytes(bytes: Uint8ClampedArray): Promise<string> {
  // Convert to regular Buffer for the qrcode library
  const buf = Buffer.from(bytes);
  return QRCode.toDataURL(buf as unknown as string, {
    errorCorrectionLevel: "L",
    margin: 2,
    width: 256,
  });
}
