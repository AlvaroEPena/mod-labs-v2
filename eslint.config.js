import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";

export default [
  { ignores: ["dist/", ".astro/", ".wrangler/", "node_modules/", "test-results/", "playwright-report/", "worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.*"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly" },
    },
  },
  // Photo admin UI: browser globals are checked by tsc (admin/public/tsconfig.json, checkJs), which
  // knows the full DOM, so ESLint's no-undef would only duplicate it with a hand-kept globals list.
  { files: ["admin/public/**/*.js"], rules: { "no-undef": "off" } },
];
