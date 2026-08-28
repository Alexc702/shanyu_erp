import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: "test-results",
  reporter: "list",
  testDir: "tests/browser",
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "pnpm dev:api",
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://localhost:3001/health",
    },
    {
      command: "pnpm dev:web",
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://localhost:3000/login",
    },
  ],
});
