import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 600_000, // generous: two-server E2E needs ~5 min (two Synapse cold-starts + two encryption bootstraps)
  fullyParallel: false, // one Electron process at a time
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
