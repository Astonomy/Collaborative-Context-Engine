import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
if (existsSync(resolve(root, ".env"))) loadEnvFile(resolve(root, ".env"));
const baseURL = process.env["CCE_E2E_BASE_URL"] ?? "http://127.0.0.1:3000";
const external = process.env["CCE_E2E_EXTERNAL_SERVER"] !== undefined;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(external
    ? {}
    : {
        webServer: {
          command:
            process.env["CCE_E2E_PRODUCTION"] === "1" ? "pnpm start:legacy" : "pnpm dev:legacy",
          cwd: root,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
