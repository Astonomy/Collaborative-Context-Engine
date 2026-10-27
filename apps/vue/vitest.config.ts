import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ["src/**/*.test.ts", "build/**/*.test.ts"],
    environment: "jsdom",
    allowOnly: false,
    coverage: {
      provider: "v8",
      include: [
        "src/api/**/*.ts",
        "src/data/**/*.ts",
        "src/attachments/**/*.ts",
        "src/config.ts",
        "src/errors.ts",
        "src/router.ts",
      ],
      exclude: ["**/*.test.ts", "src/attachments/fixtures.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
