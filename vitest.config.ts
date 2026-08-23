import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/evals/**/*.test.ts"
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "tests/integration/**",
      "tests/e2e/**"
    ],
    allowOnly: false,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.ts",
        "**/index.ts",
        "packages/database/src/**",
        "packages/test-support/src/**"
      ],
      reportOnFailure: true,
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
        "packages/domain/src/**": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90
        },
        "packages/context-engine/src/**": {
          lines: 90,
          functions: 95,
          statements: 90,
          branches: 80
        },
        "packages/application/src/**": {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 60
        },
        "packages/model-provider/src/**": {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 80
        }
      }
    }
  }
});
