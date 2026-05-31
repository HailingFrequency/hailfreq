/**
 * Boot smoke test: launches the built Electron app and verifies it reaches the
 * first-run welcome screen with no uncaught renderer errors. No Matrix server
 * required — this only exercises the pre-login boot path.
 *
 * This is the automated guard that the preload (CJS sandbox) + main bundle +
 * renderer (incl. matrix crypto WASM init on the path to AppState) all load
 * cleanly. A regression in any of those crashes AppState and the welcome
 * screen never appears (cf. the "Unexpected token" preload + WASM-MIME bugs).
 */
import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname is not available in ES modules; derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, "../../");

test("app boots to the welcome screen with no uncaught errors", async () => {
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), "hailfreq-boot-"));
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const app = await electron.launch({
    args: [".", `--user-data-dir=${testUserData}`],
    cwd: CLIENT_DIR,
    env: { ...process.env, HAILFREQ_TEST: "1", ELECTRON_DISABLE_SANDBOX: "1" },
  });

  try {
    const win = await app.firstWindow();

    win.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    win.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`));

    await win.waitForLoadState("domcontentloaded");

    // Reaching the welcome screen proves preload loaded (window.hailfreq),
    // the main bundle ran, and AppState mounted without throwing.
    await expect(win.getByText("Welcome to Hailfreq")).toBeVisible({ timeout: 20_000 });

    // Give any deferred crypto/init a beat to surface errors.
    await win.waitForTimeout(1500);

    // Uncaught exceptions are always a failure.
    expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);

    // Filter benign console noise (React devtools hint, Electron security
    // warning, Autofill CDP gaps) — anything else is a real error.
    const benign = [
      /Download the React DevTools/i,
      /Electron Security Warning/i,
      /Autofill\./i,
      /\[vite\]/i,
    ];
    const realErrors = consoleErrors.filter((e) => !benign.some((re) => re.test(e)));
    expect(realErrors, `unexpected console errors:\n${realErrors.join("\n")}`).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(testUserData, { recursive: true, force: true });
  }
});
