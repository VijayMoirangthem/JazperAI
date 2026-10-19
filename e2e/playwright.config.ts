import { defineConfig } from "@playwright/test";

// Drives the real desktop app (Electron). globalSetup starts the backend and renderer if they are not running and stops what it started.
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 20_000 }, // the dev server compiles each panel on first visit
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
});
