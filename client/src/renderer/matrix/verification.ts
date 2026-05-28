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
