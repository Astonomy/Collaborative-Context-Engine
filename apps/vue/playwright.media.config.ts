import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "multimedia.spec.ts",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5180", trace: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      process.env["CCE_VUE_MEDIA_PREVIEW"] === "1"
        ? "pnpm exec vite preview --host 127.0.0.1 --port 5180"
        : "pnpm exec vite --host 127.0.0.1 --port 5180",
    url: "http://127.0.0.1:5180/vue/",
    reuseExistingServer: false,
  },
});
