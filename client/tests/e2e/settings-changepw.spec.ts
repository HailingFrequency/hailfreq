/**
 * Feature smoke: post-login UI for the Settings menu + Change-password modal.
 *
 * Boots the full stack (postgres + synapse + livekit + livekit-auth), logs in
 * a local account, then exercises the DETERMINISTIC parts of the newly-added
 * features (no audio hardware / no real password rotation required):
 *   - ⚙ Settings menu opens and shows the Audio / PTT / Star Citizen sections;
 *     the Star Citizen section renders its "not set" state.
 *   - The server context menu shows "Change password…" for a local account, the
 *     modal opens, and client-side validation (mismatch) fires.
 *
 * Runs as part of the container-backed e2e suite (`npm run test:e2e`); it needs
 * the Synapse/LiveKit stack, so it does not run in plain unit CI.
 *
 * The sensory bits (mic meter movement, audible test tone, an actual password
 * change + re-login) are intentionally NOT asserted here — those are manual.
 */
import { test, expect, _electron as electron } from "@playwright/test";
import type { SynapseInstance } from "./helpers/synapse";
import { startFullStackInstance } from "./helpers/synapse";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, "../../");

async function loginAndSetupEncryption(
  win: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>,
  instance: Pick<SynapseInstance, "url" | "username" | "password">,
) {
  await expect(win.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
  await win.getByLabel("Username").fill(instance.username);
  await win.getByLabel("Password").fill(instance.password);
  await win.getByRole("button", { name: "Sign in" }).click();

  await expect(win.getByText("Save your Recovery Key")).toBeVisible({ timeout: 60_000 });
  await win.getByLabel("I have saved my Recovery Key somewhere safe").check();
  await win.getByRole("button", { name: "Continue to Hailfreq" }).click();
  await expect(
    win.getByText(new RegExp(`Signed in as @${instance.username}:localhost`)),
  ).toBeVisible({ timeout: 30_000 });
}

test("Settings menu + Change-password modal (post-login UI)", async () => {
  const stack = await startFullStackInstance("settings", 8890);
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), "hailfreq-settings-e2e-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | null = null;

  try {
    app = await electron.launch({
      args: [".", `--user-data-dir=${testUserData}`],
      cwd: CLIENT_DIR,
      env: { ...process.env, HAILFREQ_TEST: "1", ELECTRON_DISABLE_SANDBOX: "1" },
    });
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    await expect(win.getByText("Welcome to Hailfreq")).toBeVisible({ timeout: 15_000 });
    await win.getByLabel("Server URL").fill(stack.url);
    await win.getByRole("button", { name: "Add server" }).click();
    await loginAndSetupEncryption(win, stack);

    // === Settings menu ===
    await win.getByTitle("Settings").click();
    await expect(win.getByRole("button", { name: "Audio devices" })).toBeVisible();
    await expect(win.getByRole("button", { name: "PTT focus" })).toBeVisible();
    await expect(win.getByRole("button", { name: "Star Citizen" })).toBeVisible();
    // Star Citizen section: renders its unset state.
    await win.getByRole("button", { name: "Star Citizen" }).click();
    await expect(win.getByText("No Game.log selected.")).toBeVisible();
    // Close the menu.
    await win.getByText("✕").click();

    // === Change-password modal (gating + validation) ===
    // Local-account login => the menu item is present.
    await win.locator(`button[title*="${stack.url}"]`).first().click({ button: "right" });
    await win.getByRole("button", { name: "Change password…" }).click();
    await expect(win.getByRole("heading", { name: "Change password" })).toBeVisible();
    await win.getByLabel("New password").fill("newpass-aaaa");
    await win.getByLabel("Confirm new password").fill("newpass-bbbb");
    await win.getByRole("button", { name: "Save" }).click();
    await expect(win.getByText("Passwords do not match")).toBeVisible();
    await win.getByRole("button", { name: "Cancel" }).click();
  } finally {
    if (app) await app.close();
    fs.rmSync(testUserData, { recursive: true, force: true });
    await stack.cleanup();
  }
});
