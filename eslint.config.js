import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Dev-time-only Node fixture-generation scripts (never shipped in the
    // extension bundle) run directly under `node`, not a browser/DOM
    // environment — they need Node globals rather than the browser ones
    // TS source files get implicitly via each package's tsconfig.
    files: ["**/scripts/**/*.mjs", "**/scripts/**/*.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
