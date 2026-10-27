import { defineConfig } from "@playwright/test";
import config from "./apps/vue/playwright.standalone.config";

// Real persistence flows, hosted exclusively by Vue + standalone API.
export default defineConfig({
  ...config,
  testDir: "./apps/vue/tests",
  outputDir: "./test-results/s14-decoupling",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/s14-decoupling", open: "never" }],
  ],
});
