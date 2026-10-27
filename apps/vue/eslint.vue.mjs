import vue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

// Imported by the workspace config; eslint is run from the repository root.
export const vueConfig = [
  ...vue.configs["flat/essential"].map((config) => ({ ...config, files: ["apps/vue/**/*.vue"] })),
  {
    files: ["apps/vue/**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: [".vue"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
