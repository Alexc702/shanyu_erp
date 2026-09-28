import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"tests/browser",testMatch:"main-material-direct-import.spec.ts",fullyParallel:false,workers:1,timeout:180_000,
  outputDir:"tmp/direct-v116/browser",reporter:"list",expect:{timeout:15_000},
  use:{...devices["Desktop Chrome"],channel:"chrome",baseURL:"http://localhost:4400",trace:"retain-on-failure"},
});
