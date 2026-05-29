import type { MatrixClient } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent";
import type { VerificationRequest } from "matrix-js-sdk/lib/crypto-api/verification";

/**
 * Subscribe to incoming cross-device verification requests.
 *
 * Listens for `CryptoEvent.VerificationRequestReceived` ("crypto.verificationRequestReceived")
 * on the MatrixClient (which proxies the event from the crypto backend).
 *
 * Returns an unsubscribe function — call it on cleanup (e.g. in a React useEffect return).
 *
 * SDK: matrix-js-sdk 35.x / Rust crypto.
 * Event value: "crypto.verificationRequestReceived"
 * Payload: VerificationRequest
 */
export function subscribeToVerificationRequests(
  client: MatrixClient,
  onIncoming: (request: VerificationRequest) => void,
): () => void {
  const handler = (request: VerificationRequest): void => {
    onIncoming(request);
  };

  // CryptoEvent.VerificationRequestReceived = "crypto.verificationRequestReceived"
  // MatrixClient proxies all CryptoApi events through itself.
  client.on(CryptoEvent.VerificationRequestReceived, handler);

  return () => {
    client.off(CryptoEvent.VerificationRequestReceived, handler);
  };
}

// ---------------------------------------------------------------------------
// QR method helpers
// ---------------------------------------------------------------------------

/**
 * The Matrix method string for QR-show (generate a QR for the other device to scan).
 * We advertise/support this if the Rust-crypto backend can generate QR code bytes.
 */
export const QR_SHOW_METHOD = "m.qr_code.show.v1" as const;

/**
 * The Matrix method string for QR-scan (scan the other device's QR code).
 * We support this via text-paste fallback; camera scanning is not implemented in v1.
 */
export const QR_SCAN_METHOD = "m.qr_code.scan.v1" as const;

/** SAS (emoji comparison) method string. */
export const SAS_METHOD = "m.sas.v1" as const;

export type VerificationMethodChoice = "sas" | "qr-show" | "qr-scan";

/**
 * Given a VerificationRequest (after it has been accepted / in Ready phase),
 * return which UI methods are available to offer the user.
 *
 * Logic:
 * - "sas"      → request.methods includes m.sas.v1
 * - "qr-show"  → other party supports scanning (m.qr_code.scan.v1), so we can show a QR
 * - "qr-scan"  → other party supports showing (m.qr_code.show.v1), so we can scan their QR
 *
 * Note: `request.otherPartySupportsMethod` reflects what the other side declared in
 * their .ready or .start event. `request.methods` is the intersection of both sides.
 */
export function availableMethods(request: VerificationRequest): VerificationMethodChoice[] {
  const result: VerificationMethodChoice[] = [];

  // SAS is available if both sides support it (methods is the intersection).
  if (request.methods.includes(SAS_METHOD)) {
    result.push("sas");
  }

  // QR show: we can show our QR if the other side can scan it.
  if (request.otherPartySupportsMethod(QR_SCAN_METHOD)) {
    result.push("qr-show");
  }

  // QR scan (paste fallback): we can scan/paste if the other side can show it.
  if (request.otherPartySupportsMethod(QR_SHOW_METHOD)) {
    result.push("qr-scan");
  }

  return result;
}
