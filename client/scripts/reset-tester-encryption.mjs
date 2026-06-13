/**
 * One-shot: reset a test account's E2EE state (cross-signing + secret storage +
 * key backup) to a BRAND-NEW recovery key that we print, so a fresh in-memory
 * client can verify itself by entering that key on the Restore screen.
 *
 * Why this is needed: the desktop client uses in-memory crypto each launch
 * (client.ts `useIndexedDB:false`), so every launch looks like a new device.
 * Once an account has bootstrapped cross-signing, subsequent launches are
 * routed to "Restore from Recovery Key" — and if that key was lost, the account
 * is stuck. This rotates the account to a key we keep.
 *
 * Mirrors src/renderer/matrix/client.ts (startClient) and
 * src/renderer/matrix/crypto.ts (bootstrap* helpers).
 *
 * Usage:  node scripts/reset-tester-encryption.mjs <homeserver> <user> <password>
 * e.g.    node scripts/reset-tester-encryption.mjs https://rpk.chat tester2 'R2zAbpmv0A4B9wVe'
 */
import { createClient } from "matrix-js-sdk";

const [, , HS, USER_ARG, PASSWORD] = process.argv;
if (!HS || !USER_ARG || !PASSWORD) {
  console.error("usage: node reset-tester-encryption.mjs <homeserver> <user> <password>");
  process.exit(2);
}

function log(...a) { console.log("[reset]", ...a); }

async function main() {
  // 1. Password login → credentials (mirrors loginWithPassword)
  log(`logging in ${USER_ARG} @ ${HS} …`);
  const tmp = createClient({ baseUrl: HS });
  const resp = await tmp.login("m.login.password", {
    identifier: { type: "m.id.user", user: USER_ARG },
    password: PASSWORD,
    initial_device_display_name: "Hailfreq encryption reset (one-shot)",
  });
  const creds = {
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
  };
  log(`logged in as ${creds.userId} (device ${creds.deviceId})`);

  // 2. Real client with crypto (mirrors startClient)
  const cryptoCallbacks = { getSecretStorageKey: async () => null };
  const client = createClient({
    baseUrl: HS,
    userId: creds.userId,
    accessToken: creds.accessToken,
    deviceId: creds.deviceId,
    cryptoCallbacks,
  });
  await client.initRustCrypto({ useIndexedDB: false });
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("crypto not initialised");

  // Initial sync so account-data / device state is loaded before bootstrap.
  await new Promise((resolve, reject) => {
    const onState = (state) => {
      if (state === "PREPARED") { client.removeListener("sync", onState); resolve(); }
      else if (state === "ERROR") { reject(new Error("sync ERROR")); }
    };
    client.on("sync", onState);
    client.startClient({ initialSyncLimit: 1 }).catch(reject);
  });
  log("initial sync complete");

  // 3. Reset secret storage FIRST with a brand-new recovery key. The account
  //    already has an SSSS we can't unlock; setupNewSecretStorage overwrites the
  //    default key with one we control. We install getSecretStorageKey to return
  //    the new key so the later cross-signing export can write into it.
  log("resetting secret storage with a new recovery key …");
  const keyInfo = await crypto.createRecoveryKeyFromPassphrase();
  let capturedKeyId = null;
  client.cryptoCallbacks.getSecretStorageKey = async ({ keys }) => {
    if (capturedKeyId && keys[capturedKeyId]) return [capturedKeyId, keyInfo.privateKey];
    const ids = Object.keys(keys);
    if (ids.length) return [ids[0], keyInfo.privateKey];
    return null;
  };
  client.cryptoCallbacks.cacheSecretStorageKey = (keyId) => { capturedKeyId = keyId; };
  await crypto.bootstrapSecretStorage({
    setupNewSecretStorage: true,
    createSecretStorageKey: async () => keyInfo,
  });

  // 4. Reset cross-signing — now its private keys export into OUR new SSSS.
  log("resetting cross-signing …");
  await crypto.bootstrapCrossSigning({
    setupNewCrossSigning: true,
    authUploadDeviceSigningKeys: async (makeRequest) => {
      await makeRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: creds.userId },
        password: PASSWORD,
      });
    },
  });

  // 5. Reset key backup (new Megolm backup version, stored under new SSSS)
  log("resetting key backup …");
  await crypto.resetKeyBackup();

  client.stopClient();

  const recoveryKey = keyInfo.encodedPrivateKey;
  console.log("\n========================================");
  console.log(" NEW RECOVERY KEY for", creds.userId);
  console.log("   ", recoveryKey);
  console.log(" Paste this on the Restore screen, and keep it —");
  console.log(" you'll re-enter it on every launch of this account.");
  console.log("========================================\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] FAILED:", err?.message || err);
  process.exit(1);
});
