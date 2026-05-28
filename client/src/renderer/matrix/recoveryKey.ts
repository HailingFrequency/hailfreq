import {
  encodeRecoveryKey as sdkEncodeRecoveryKey,
  decodeRecoveryKey as sdkDecodeRecoveryKey,
} from "matrix-js-sdk/lib/crypto-api/recovery-key";

/**
 * Encode raw 32-byte key material to the human-readable Matrix recovery key
 * format (base58 with prefix bytes, parity byte, and spaces every 4 chars).
 *
 * Returns `undefined` if the SDK returns undefined (e.g. key length mismatch).
 */
export function encodeRecoveryKey(key: Uint8Array): string | undefined {
  return sdkEncodeRecoveryKey(key);
}

/**
 * Decode a human-readable Matrix recovery key back to its raw 32-byte
 * Uint8Array representation.
 *
 * Throws if the key has an incorrect prefix, parity, or length.
 */
export function decodeRecoveryKey(recoveryKey: string): Uint8Array {
  return sdkDecodeRecoveryKey(recoveryKey);
}
