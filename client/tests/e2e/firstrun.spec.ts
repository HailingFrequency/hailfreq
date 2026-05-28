/**
 * E2E test: full first-run → local login → encryption setup → home flow.
 *
 * Spins up a local Synapse instance, launches the built Electron app, and
 * walks through the complete onboarding flow:
 *   1. First-run: enter server URL
 *   2. Login: enter username + password
 *   3. Encryption setup: wait for Recovery Key generation (cross-signing + SSSS bootstrap)
 *   4. Recovery Key: confirm saved, click Continue
 *   5. Home: verify "Signed in as @<username>:localhost"
 */

import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startSynapseInstance } from "./helpers/synapse";

// __dirname is not available in ES modules; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The client/ directory (where package.json lives)
const CLIENT_DIR = path.resolve(__dirname, "../../");

test("first-run → local login → encryption setup → home", async () => {
  // Start Synapse and provision a test user before launching Electron.
  // This ensures credentials are available before the app starts.
  const synapse = await startSynapseInstance("default", 8008);

  let app: Awaited<ReturnType<typeof electron.launch>> | null = null;

  // Use a temporary userData directory so each test run starts with a clean slate.
  // This prevents state bleed from previous runs (stored serverUrl, tokens, etc.).
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), "hailfreq-e2e-"));

  try {
    // Launch the built Electron app.
    // args=["."] tells Electron to use the cwd as project root, loading
    // the "main" field from package.json (dist-electron/main/index.mjs).
    // We set HAILFREQ_TEST=1 to disable opening DevTools in test mode.
    // --user-data-dir ensures each run starts with a fresh settings/token store.
    app = await electron.launch({
      args: [".", `--user-data-dir=${testUserData}`],
      cwd: CLIENT_DIR,
      env: {
        ...process.env,
        HAILFREQ_TEST: "1",
        // Disable sandbox for CI/rootless environments
        ELECTRON_DISABLE_SANDBOX: "1",
      },
    });

    const win = await app.firstWindow();

    // Give the renderer time to initialize and load settings
    await win.waitForLoadState("domcontentloaded");

    // === Step 1: First-run screen ===
    await expect(win.getByText("Welcome to Hailfreq")).toBeVisible({
      timeout: 15_000,
    });

    // Enter the Synapse URL and click "Add server" (the new multi-server AddServer screen)
    await win.getByLabel("Server URL").fill(synapse.url);
    await win.getByRole("button", { name: "Add server" }).click();

    // === Step 2: Login screen ===
    // The app probes /_matrix/client/versions to confirm it's a Matrix server,
    // then transitions to login. Give it time to probe + render.
    // Use the heading role to distinguish from the "Sign in" button.
    await expect(win.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 30_000,
    });

    // Fill in credentials for the provisioned test user
    await win.getByLabel("Username").fill(synapse.username);
    await win.getByLabel("Password").fill(synapse.password);
    await win.getByRole("button", { name: "Sign in" }).click();

    // === Step 3 + 4: Encryption setup → Recovery Key screen ===
    // After login, the app initializes the Matrix client, checks cross-signing
    // status (fresh account has none), then runs bootstrapCrossSigning (UIAA
    // password auth against Synapse) and bootstrapSecretStorage.
    // The "Setting up encryption keys…" transitional screen may be too brief
    // to catch reliably, so we wait directly for the Recovery Key screen.
    // This step can take 15-60s on a cold Synapse with crypto initialization.
    await expect(win.getByText("Save your Recovery Key")).toBeVisible({
      timeout: 90_000,
    });

    // Verify the recovery key is displayed (should be a non-empty code block)
    const recoveryKeyCode = win.locator("code");
    await expect(recoveryKeyCode).toBeVisible({ timeout: 10_000 });
    const keyText = await recoveryKeyCode.textContent();
    expect(keyText).toBeTruthy();
    expect(keyText!.trim().length).toBeGreaterThan(10);

    // Check the confirmation checkbox
    await win
      .getByLabel("I have saved my Recovery Key somewhere safe")
      .check();

    // Click Continue to Hailfreq
    await win.getByRole("button", { name: "Continue to Hailfreq" }).click();

    // === Step 5: Home screen ===
    // Verify the home screen shows the signed-in user
    await expect(
      win.getByText(new RegExp(`Signed in as @${synapse.username}:localhost`)),
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    // Always clean up: close the app, tear down Synapse, and remove temp dirs
    if (app) {
      await app.close().catch(() => undefined);
    }
    await synapse.cleanup();
    // Remove the temp userData directory
    fs.rmSync(testUserData, { recursive: true, force: true });
  }
});
