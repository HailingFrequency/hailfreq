/**
 * E2E test: two-server add → switch → remove flow.
 *
 * Spins up two independent Synapse instances ("alpha" on port 8008,
 * "beta" on port 8009), launches the Hailfreq Electron app, and walks
 * through the full multi-server lifecycle:
 *
 *   1.  First-run: enter alpha's URL, add server
 *   2.  Login to alpha + complete encryption setup → Home
 *   3.  Click "+ Add server" in sidebar
 *   4.  Enter beta's URL, add server
 *   5.  Login to beta + complete encryption setup → Home
 *   6.  Verify both server icons appear in the sidebar
 *   7.  Click alpha icon → verify alpha's user is shown
 *   8.  Right-click alpha icon → Remove → confirm
 *   9.  Verify only beta remains in the sidebar and on screen
 */

import { test, expect, _electron as electron } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startSynapseInstance } from "./helpers/synapse";
import type { SynapseInstance } from "./helpers/synapse";

// __dirname is not available in ES modules; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the client/ directory (where package.json lives)
const CLIENT_DIR = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// Helper: login + complete encryption setup for one server instance.
//
// Assumes the app is currently showing the Login screen for the given server.
// Waits for Home ("Signed in as …") before returning.
// ---------------------------------------------------------------------------
async function loginAndSetupEncryption(
  win: Page,
  instance: SynapseInstance,
): Promise<void> {
  // The Login screen
  await expect(win.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: 30_000,
  });

  await win.getByLabel("Username").fill(instance.username);
  await win.getByLabel("Password").fill(instance.password);
  await win.getByRole("button", { name: "Sign in" }).click();

  // Encryption setup can take 15-120 s with two Synapse instances running simultaneously.
  // We wait for EITHER "Save your Recovery Key" (success) OR "Encryption setup failed"
  // (error state — which has a Retry button) so we can give a clear error on failure.
  const recoveryKeyHeading = win.getByText("Save your Recovery Key");
  const encryptionError = win.getByText("Encryption setup failed");
  await expect(recoveryKeyHeading.or(encryptionError)).toBeVisible({
    timeout: 120_000,
  });

  // If we see the error state, throw a clear message
  if (await encryptionError.isVisible()) {
    const errorMsg = await win
      .locator("p.text-sm.text-slate-300")
      .textContent()
      .catch(() => "unknown error");
    throw new Error(
      `Encryption setup failed for ${instance.url} (user: ${instance.username}): ${errorMsg}`,
    );
  }

  await win
    .getByLabel("I have saved my Recovery Key somewhere safe")
    .check();

  await win.getByRole("button", { name: "Continue to Hailfreq" }).click();

  // Confirm we are on the Home screen for this server
  await expect(
    win.getByText(new RegExp(`Signed in as @${instance.username}:localhost`)),
  ).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Derive the expected server icon title from a SynapseInstance URL.
//
// ServerIcon renders: title="${server.label} — ${server.serverUrl}"
// The label is auto-derived as "Localhost" from "http://localhost:<port>".
// We use a regex that matches the serverUrl portion so port differences
// between alpha (8008) and beta (8009) give distinct, unambiguous locators.
// ---------------------------------------------------------------------------
function serverIconLocator(win: Page, instance: SynapseInstance) {
  // Match the title attribute on the ServerIcon button.
  // Title format: "<Label> — <serverUrl>" e.g. "Localhost — http://localhost:8008"
  // We match by the URL part which is unique per instance.
  return win.locator(`button[title*="${instance.url}"]`);
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test("two-server: add, switch, remove", async () => {
  // Start both Synapse instances sequentially.
  // They share the same server directory (compose.yml, homeserver.yaml) so
  // they cannot be started concurrently without clobbering each other's config
  // files.  Sequential start is slower (~60-90s each) but fully reliable.
  const alpha = await startSynapseInstance("alpha", 8008);
  const beta = await startSynapseInstance("beta", 8009);

  let app: Awaited<ReturnType<typeof electron.launch>> | null = null;

  // Isolated user-data directory so each test run starts with a clean slate
  const testUserData = fs.mkdtempSync(
    path.join(os.tmpdir(), "hailfreq-e2e-multi-"),
  );

  try {
    // Launch the built Electron app
    app = await electron.launch({
      args: [".", `--user-data-dir=${testUserData}`],
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        HAILFREQ_TEST: "1",
        ELECTRON_DISABLE_SANDBOX: "1",
      },
    });

    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // -----------------------------------------------------------------------
    // Step 1: First-run — add alpha server
    // -----------------------------------------------------------------------
    await expect(win.getByText("Welcome to Hailfreq")).toBeVisible({
      timeout: 15_000,
    });

    await win.getByLabel("Server URL").fill(alpha.url);
    // The AddServer form probes the homeserver then submits
    await win.getByRole("button", { name: "Add server" }).click();

    // -----------------------------------------------------------------------
    // Step 2: Login to alpha + encryption setup
    // -----------------------------------------------------------------------
    await loginAndSetupEncryption(win, alpha);

    // -----------------------------------------------------------------------
    // Step 3: Click "+ Add server" in the sidebar
    // -----------------------------------------------------------------------
    await win.getByTitle("Add server").click();

    // -----------------------------------------------------------------------
    // Step 4: Add beta server
    // -----------------------------------------------------------------------
    await expect(
      win.getByRole("heading", { name: "Add a server" }),
    ).toBeVisible({ timeout: 10_000 });

    await win.getByLabel("Server URL").fill(beta.url);
    await win.getByRole("button", { name: "Add server" }).click();

    // -----------------------------------------------------------------------
    // Step 5: Login to beta + encryption setup
    // -----------------------------------------------------------------------
    await loginAndSetupEncryption(win, beta);

    // -----------------------------------------------------------------------
    // Step 6: Verify both server icons appear in the sidebar
    //
    // ServerIcon title format: "<Label> — <serverUrl>"
    // We match by the URL portion which is unique per port.
    // -----------------------------------------------------------------------
    const alphaIcon = serverIconLocator(win, alpha);
    const betaIcon = serverIconLocator(win, beta);

    await expect(alphaIcon).toBeVisible({ timeout: 10_000 });
    await expect(betaIcon).toBeVisible({ timeout: 10_000 });

    // -----------------------------------------------------------------------
    // Step 7: Switch to alpha, verify alpha's user is shown
    // -----------------------------------------------------------------------
    await alphaIcon.click();
    await expect(
      win.getByText(new RegExp(`Signed in as @${alpha.username}:localhost`)),
    ).toBeVisible({ timeout: 15_000 });

    // -----------------------------------------------------------------------
    // Step 8: Right-click alpha icon → Remove → confirm
    // -----------------------------------------------------------------------
    await alphaIcon.click({ button: "right" });

    // The ServerContextMenu first shows an "initial" state with "Remove from Hailfreq…"
    await win
      .getByRole("button", { name: /remove from hailfreq/i })
      .click();

    // Confirm the removal in the "confirming" state
    await win.getByRole("button", { name: /yes, remove/i }).click();

    // -----------------------------------------------------------------------
    // Step 9: Verify only beta remains
    // -----------------------------------------------------------------------
    // Alpha icon should disappear
    await expect(alphaIcon).not.toBeVisible({ timeout: 15_000 });

    // Beta icon and its Home screen should still be visible
    await expect(betaIcon).toBeVisible({ timeout: 10_000 });
    await expect(
      win.getByText(new RegExp(`Signed in as @${beta.username}:localhost`)),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    // Always clean up: close app, tear down both Synapse stacks, remove temp dir
    if (app) {
      await app.close().catch(() => undefined);
    }
    await Promise.allSettled([alpha.cleanup(), beta.cleanup()]);
    fs.rmSync(testUserData, { recursive: true, force: true });
  }
});
