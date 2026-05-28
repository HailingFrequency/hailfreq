import type { MatrixClient } from "matrix-js-sdk";
import type { UIAuthCallback } from "matrix-js-sdk/lib/interactive-auth";
import type { BootstrapCrossSigningOpts } from "matrix-js-sdk/lib/crypto-api";

/**
 * Returns true if the account has cross-signing master keys published on the
 * homeserver, meaning at least one device has bootstrapped cross-signing.
 *
 * Uses `userHasCrossSigningKeys` which performs a `/keys/query` request to
 * check the server. The plan's pseudocode referenced `getCrossSigningStatus()
 * .publicKeysOnServer`, but the installed SDK (35.x) does not expose that
 * field on `CrossSigningStatus`; `publicKeysOnDevice` is the nearest field
 * there, but it only indicates locally-cached public keys. The canonical way
 * to check server-side publication is `userHasCrossSigningKeys()`.
 */
export async function hasCrossSigning(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) {
    return false;
  }
  return crypto.userHasCrossSigningKeys(client.getSafeUserId(), true);
}

/**
 * Returns true if THIS device is cross-signed by the account's master key
 * (i.e. another device has signed it with the self-signing key, and that
 * signature can be verified against a trusted master key).
 */
export async function isDeviceTrusted(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) {
    return false;
  }

  const deviceId = client.getDeviceId();
  if (!deviceId) {
    return false;
  }

  const status = await crypto.getDeviceVerificationStatus(
    client.getSafeUserId(),
    deviceId,
  );

  if (!status) {
    return false;
  }

  // `crossSigningVerified` is true when the device has been signed by the
  // account's self-signing key AND that key chains up to a trusted master key.
  // `signedByOwner` is true even when the master key itself is not locally
  // trusted, so we prefer the stricter crossSigningVerified check here.
  return status.crossSigningVerified;
}

/**
 * Generate fresh cross-signing keys (master, self-signing, user-signing) and
 * upload them to the homeserver.
 *
 * `authCallback` is a caller-supplied UIAA handler: the SDK will invoke it
 * with a `makeRequest` function; the caller must call `makeRequest` with a
 * completed UIAA auth dictionary (e.g. `{ type: "m.login.password", ... }`).
 * Synapse requires password-auth for the device-signing upload endpoint.
 *
 * If cross-signing keys already exist and `setupNewCrossSigning` is false
 * (the default), the SDK skips key generation but still ensures the public
 * keys are published and the private keys are available.
 */
export async function bootstrapCrossSigning(
  client: MatrixClient,
  authCallback: UIAuthCallback<void>,
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) {
    throw new Error("Crypto is not initialised on this client");
  }

  const opts: BootstrapCrossSigningOpts = {
    authUploadDeviceSigningKeys: authCallback,
  };

  await crypto.bootstrapCrossSigning(opts);
}
