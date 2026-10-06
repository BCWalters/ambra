import assert from "node:assert/strict";
import test from "node:test";
import { selectBrowserSuites } from "./select-browser-suites.mjs";

function expectMode(files, mode) {
  assert.deepEqual(selectBrowserSuites(files), {
    mode,
    run_browser: mode !== "none" && mode !== "tooling",
    run_reader: mode === "full",
    run_library: mode === "full" || mode === "library",
    run_localization: mode === "localization",
    files: [...files].sort(),
  });
}

test("documentation-only changes skip browser tests", () => {
  expectMode(["README.md", "docs/epub-3.4-conformance-plan.md"], "none");
});

test("browser-independent release tooling skips browser tests", () => {
  expectMode(
    [
      ".github/scripts/select-browser-suites.mjs",
      ".github/scripts/select-browser-suites.test.mjs",
      ".github/workflows/epub-conformance.yml",
      "conformance/epub-3.4/config.json",
      "scripts/epub-conformance.mjs",
      "scripts/epub-conformance.test.mjs",
      "scripts/epub-conformance-core.mjs",
      "scripts/epub-conformance-core.test.mjs",
      "apps/e2e/epub-conformance.config.ts",
      "apps/e2e/assessment/core-media.spec.ts",
      "conformance/epub-3.4/core-media-profile.json",
      "docs/epub-3.4-conformance-runner.md",
    ],
    "tooling",
  );
});

test("localization changes run focused localization coverage", () => {
  expectMode(
    [
      "apps/extension/src/i18n/locales/fr.ts",
      "apps/extension/src/i18n/translate.ts",
      "docs/user-guide/README.md",
    ],
    "localization",
  );
});

test("Library-only changes run the Library browser suite", () => {
  expectMode(
    [
      "apps/extension/src/library/LibraryApp.tsx",
      "apps/e2e/tests/library-search.spec.ts",
      "apps/e2e/tests/reader-library.spec.ts",
    ],
    "library",
  );
});

test("shared, reader, engine, dependency, workflow, and release changes fail closed", () => {
  for (const file of [
    "apps/extension/src/components/AmbraSettingsPopover.tsx",
    "apps/extension/src/reader/ReaderController.ts",
    "packages/engine/src/container/ZipArchive.ts",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "apps/extension/manifest.json",
  ]) {
    expectMode([file], "full");
  }
});

test("mixed Library and shared changes run the full suite", () => {
  expectMode(["apps/extension/src/library/LibraryApp.tsx", "packages/shell/src/theme.ts"], "full");
});

test("mixed browser-independent tooling and product changes run the full suite", () => {
  expectMode(
    ["scripts/epub-conformance.mjs", "apps/extension/src/reader/ReaderController.ts"],
    "full",
  );
});

test("empty and explicitly forced selections run the full suite", () => {
  expectMode([], "full");
  assert.equal(selectBrowserSuites(["README.md"], true).mode, "full");
});
