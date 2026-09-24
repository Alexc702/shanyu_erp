import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.TRANSFER_WEB_URL;
const apiURL = process.env.TRANSFER_API_URL;
if (baseURL !== "http://localhost:3215" || apiURL !== "http://localhost:3115") {
  throw new Error("转交验收仅允许隔离本地 Web3215/API3115，不启动或使用日常环境");
}
export default defineConfig({
  testDir: "tests/browser", testMatch: "project-transfer.spec.ts", workers: 1,
  timeout: 90_000, outputDir: "tmp/project-transfer-browser", reporter: "list",
  use: { baseURL, ...devices["Desktop Chrome"], channel: "chrome", trace: "retain-on-failure" },
});
