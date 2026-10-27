import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";
import { vueConfig } from "./apps/vue/eslint.vue.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "apps/web/public/vue/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...vueConfig,
  {
    files: ["apps/vue/src/**/*.{ts,vue}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "node:*",
            "@cce/application",
            "@cce/database*",
            "@cce/storage*",
            "@cce/model-provider",
            "@cce/mcp-server",
            "next*",
            "react*",
            "**/apps/web/**",
            "**/apps/api/**",
          ],
        },
      ],
      "no-restricted-globals": ["error", "process", "Buffer", "require"],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
  {
    files: ["packages/domain/**/*.ts", "packages/context-engine/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-globals": ["error", "window", "document", "process", "Buffer"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "next/*",
            "react",
            "react/*",
            "pg",
            "drizzle-orm/*",
            "@cce/database",
            "@cce/model-provider",
            "@cce/application",
          ],
        },
      ],
    },
  },
  {
    files: ["packages/server-runtime/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "next",
            "next/*",
            "vue",
            "vue/*",
            "react",
            "react/*",
            "**/apps/**",
            "@cce/api-contracts",
            "@cce/mcp-server",
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "navigator"],
    },
  },
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
  })),
  {
    files: ["apps/api/**/*.ts", "packages/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["next", "next/*", "react", "react/*", "**/apps/web/**"] },
      ],
    },
  },
  ...nextTypeScript.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
  })),
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["*.{ts,mts}", "scripts/**/*.{ts,mts}", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.tools.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "@typescript-eslint/require-await": "off",
      "require-yield": "off",
    },
  },
  {
    files: ["packages/model-provider/src/fake-model-provider.ts", "packages/test-support/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
);
