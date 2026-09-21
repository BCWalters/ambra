import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.extension-build/**", "**/test-results/**", "**/playwright-report/**"],
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
    // Catches exactly the class of bug behind a real, reported crash
    // (issue #35's investigation): a component with an early `return`
    // *before* a later hook call desyncs React's hook-call-order
    // bookkeeping the moment a render actually takes that early-return
    // branch, throwing "Rendered fewer hooks than expected" and crashing
    // the whole tree — `ProgressScrubber`'s `viewMode !== "paginated"`
    // guard did exactly this. Scoped to `.tsx` files only (the only
    // place React components/hooks exist in this repo), and to just this
    // one rule rather than the plugin's full "recommended" set, which
    // pulls in several much more opinionated, newer rules (e.g.
    // `set-state-in-effect`) that would force refactoring unrelated,
    // already-correct code.
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Dev-time-only Node fixture-generation scripts (never shipped in the
    // extension bundle) run directly under `node`, not a browser/DOM
    // environment — they need Node globals rather than the browser ones
    // TS source files get implicitly via each package's tsconfig. A few
    // of these also drive a real Playwright browser and pass it small
    // in-page callbacks (`page.evaluate`/`waitForFunction`) that
    // reference DOM globals like `document` from *inside* the browser
    // context, not Node's — so browser globals are included too.
    files: ["**/scripts/**/*.mjs", "**/scripts/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
