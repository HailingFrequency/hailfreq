import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000, // generous: Synapse cold-start can take 30-45s, plus encryption bootstrap
  fullyParallel: false, // one Electron process at a time
  retries: 0,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
