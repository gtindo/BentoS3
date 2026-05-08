import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    acceptDownloads: true,
    trace: "on-first-retry",
  },
});
