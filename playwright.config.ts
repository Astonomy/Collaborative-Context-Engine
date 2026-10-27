import { defineConfig, devices } from "@playwright/test";

const inCi = process.env["CI"] !== undefined;
const useExternalServer = process.env["CCE_E2E_EXTERNAL_SERVER"] !== undefined;
const baseURL = process.env["CCE_E2E_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: inCi ? 2 : 0,
  ...(inCi ? { workers: 1 } : {}),
  reporter: inCi ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command:
            process.env["CCE_E2E_PRODUCTION"] === "1" ? "pnpm start:legacy" : "pnpm dev:legacy",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
