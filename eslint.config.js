import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "src/dashboard/static/**",
      "src/dashboard/templates/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    },
  },
  {
    files: ["*.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["e2e/package-exports.spec.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
