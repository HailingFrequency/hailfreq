/**
 * One-shot: accept (join) all pending room invites for a test account.
 *
 * Hailfreq nets are invite-only Matrix rooms and the client has no
 * "accept invite" UI yet, so a freshly-invited tester can't get into a net.
 * This logs in, finds rooms in "invite" membership, and joins them. The
 * running app (same account, different device) picks up the join via sync
 * and the net appears in its list.
 *
 * No crypto is initialised — joining only changes membership; the GUI client
 * handles E2EE/voice.
 *
 * Usage:  node scripts/join-invited-nets.mjs <homeserver> <user> <password>
 * e.g.    node scripts/join-invited-nets.mjs https://rpk.chat tester2 'R2zAbpmv0A4B9wVe'
 */
import { createClient } from "matrix-js-sdk";

const [, , HS, USER_ARG, PASSWORD] = process.argv;
if (!HS || !USER_ARG || !PASSWORD) {
  console.error("usage: node join-invited-nets.mjs <homeserver> <user> <password>");
  process.exit(2);
}
function log(...a) { console.log("[join]", ...a); }

async function main() {
  const tmp = createClient({ baseUrl: HS });
  const resp = await tmp.login("m.login.password", {
    identifier: { type: "m.id.user", user: USER_ARG },
    password: PASSWORD,
    initial_device_display_name: "Hailfreq join-invites (one-shot)",
  });
  log(`logged in as ${resp.user_id}`);

  const client = createClient({
    baseUrl: HS,
    userId: resp.user_id,
    accessToken: resp.access_token,
    deviceId: resp.device_id,
  });

  await new Promise((resolve, reject) => {
    const onState = (state) => {
      if (state === "PREPARED") { client.removeListener("sync", onState); resolve(); }
      else if (state === "ERROR") { reject(new Error("sync ERROR")); }
    };
    client.on("sync", onState);
    client.startClient({ initialSyncLimit: 1 }).catch(reject);
  });

  const invited = client.getRooms().filter(
    (r) => r.getMyMembership() === "invite",
  );
  if (invited.length === 0) {
    log("no pending invites found — has rocktato invited this user to a net yet?");
    client.stopClient();
    process.exit(0);
  }

  for (const room of invited) {
    log(`joining ${room.name || room.roomId} (${room.roomId}) …`);
    await client.joinRoom(room.roomId);
    log(`  joined ${room.roomId}`);
  }

  client.stopClient();
  log(`done — joined ${invited.length} net(s). They should now appear in the app.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[join] FAILED:", err?.message || err);
  process.exit(1);
});
