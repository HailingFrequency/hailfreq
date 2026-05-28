import type { MatrixClient } from "matrix-js-sdk";
import type { UIAuthCallback } from "matrix-js-sdk/lib/interactive-auth";
import type {
  BootstrapCrossSigningOpts,
  GeneratedSecretStorageKey,
} from "matrix-js-sdk/lib/crypto-api";
import { encodeRecoveryKey } from "./recoveryKey";

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

/**
 * Bootstrap SSSS (Secret Storage and Sharing) with a freshly-generated
 * 32-byte recovery key, and return that key in the human-readable Matrix
 * encoded format.
 *
 * The SDK calls the `createSecretStorageKey` callback to obtain fresh key
 * material. We intercept the callback to capture both the raw bytes and
 * the SDK's own `encodedPrivateKey` field (which may already carry the
 * formatted string). If `encodedPrivateKey` is absent we re-encode from
 * `privateKey` ourselves using the same base58+parity scheme.
 *
 * `setupNewSecretStorage: true` forces generation of a new key even if one
 * already exists in account data. Remove that flag if you only want to
 * bootstrap when no secret storage key is present yet.
 */
export async function bootstrapSecretStorageWithNewKey(
  client: MatrixClient,
): Promise<{ recoveryKey: string }> {
  const crypto = client.getCrypto();
  if (!crypto) {
    throw new Error("Crypto is not initialised on this client");
  }

  let capturedKey: GeneratedSecretStorageKey | null = null;

  await crypto.bootstrapSecretStorage({
    setupNewSecretStorage: true,
    createSecretStorageKey: async (): Promise<GeneratedSecretStorageKey> => {
      // Generate 32 cryptographically random bytes for the key.
      const privateKey = new Uint8Array(32);
      globalThis.crypto.getRandomValues(privateKey);

      const encodedPrivateKey = encodeRecoveryKey(privateKey);

      const generated: GeneratedSecretStorageKey = {
        privateKey,
        encodedPrivateKey,
        keyInfo: {},
      };

      capturedKey = generated;
      return generated;
    },
  });

  if (!capturedKey) {
    throw new Error(
      "bootstrapSecretStorage completed but createSecretStorageKey was never called — " +
        "secret storage may have already been set up with an existing key",
    );
  }

  const key = capturedKey as GeneratedSecretStorageKey;
  const recoveryKey =
    key.encodedPrivateKey ?? encodeRecoveryKey(key.privateKey);

  if (!recoveryKey) {
    throw new Error(
      "Failed to encode recovery key: encodeRecoveryKey returned undefined",
    );
  }

  return { recoveryKey };
}
