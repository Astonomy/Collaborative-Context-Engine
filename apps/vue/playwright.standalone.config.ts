import { defineConfig } from "@playwright/test";
import config from "./playwright.config";
const baseURL = process.env["CCE_E2E_BASE_URL"] ?? "http://127.0.0.1:5173/vue/";
export default defineConfig({
  ...config,
  testMatch: [
    "**/attachment-lifecycle.spec.ts",
    "**/session.spec.ts",
    "**/persisted-journeys.spec.ts",
  ],
  outputDir: "../../test-results/s14-standalone",
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../playwright-report/s14-standalone", open: "never" }],
  ],
  use: { ...config.use, baseURL },
  webServer: {
    command: "pnpm dev:standalone",
    env: { VITE_APP_BASE: "/vue/", VITE_CCE_API_BASE_URL: "" },
    cwd: import.meta.dirname + "/../..",
    // Wait for the proxied API and its database, not only Vite's static page.
    url: new URL("/api/health", baseURL).toString(),
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
