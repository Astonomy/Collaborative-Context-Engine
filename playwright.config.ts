import { defineConfig, devices } from "@playwright/test";

const inCi = process.env["CI"] !== undefined;
const useExternalServer = process.env["CCE_E2E_EXTERNAL_SERVER"] !== undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: inCi ? 2 : 0,
  ...(inCi ? { workers: 1 } : {}),
  reporter: inCi ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env["CCE_E2E_BASE_URL"] ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(useExternalServer
    ? {}
    : { webServer: {
        command: "pnpm --filter @cce/web dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !inCi,
        timeout: 120_000
      } })
});
