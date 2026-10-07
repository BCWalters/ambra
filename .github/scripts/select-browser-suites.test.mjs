import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { selectBrowserSuites } from "./select-browser-suites.mjs";

function expectMode(files, mode) {
  assert.deepEqual(selectBrowserSuites(files), {
    mode,
    run_browser: mode !== "none" && mode !== "tooling",
    run_reader: mode === "full",
    run_library: mode === "full" || mode === "library",
    run_library_integration: mode === "library",
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
      "scripts/epub-conformance-foundations.mjs",
      "scripts/epub-conformance-foundations.d.mts",
      "scripts/epub-conformance-foundations.test.mjs",
      "apps/e2e/epub-conformance.config.ts",
      "apps/e2e/assessment/core-media.spec.ts",
      "apps/e2e/assessment/foundations.spec.ts",
      "apps/e2e/assessment/native-assessment.ts",
      "conformance/epub-3.4/core-media-profile.json",
      "conformance/epub-3.4/foundations-profile.json",
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
    "apps/extension/src/reader/components/ReaderSettingsMenu.tsx",
    "apps/e2e/harness.ts",
    "apps/e2e/reader-controller.ts",
    "apps/e2e/playwright.config.ts",
    "apps/e2e/tests/library-future.spec.ts",
    "packages/engine/src/container/ZipArchive.ts",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "apps/extension/manifest.json",
  ]) {
    expectMode([file], "full");
  }
});

test("compact Library and its explicit reader integration stay focused", () => {
  expectMode([
    "apps/extension/src/library/LibraryApp.tsx",
    "apps/extension/src/library/LibraryBookCard.tsx",
    "apps/extension/src/reader/components/ReaderLibraryPanel.tsx",
    "apps/extension/src/reader/components/ReaderLibraryPanel.test.tsx",
    "apps/extension/src/i18n/locales/fr.ts",
    "apps/e2e/library-tools.ts",
    "apps/e2e/tests/first-reading-welcome.spec.ts",
    "apps/e2e/tests/shell-accessibility-audit.spec.ts",
    "docs/design-system.md",
  ], "library");
});

test("CI workflow changes still force full validation alongside Library changes", () => {
  expectMode(["apps/extension/src/library/LibraryApp.tsx", ".github/workflows/ci.yml"], "full");
});

test("every focused Library spec is wired to an eligible workflow stage", () => {
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  const libraryStages = workflow.split(/^ {6}- name: /m).filter(stage =>
    /if: steps\.browser-suites\.outputs\.run_library(?:_integration)? == 'true'/.test(stage));
  for (const file of readdirSync(new URL("../../apps/e2e/tests/", import.meta.url))) {
    if (!file.endsWith(".spec.ts")) continue;
    if (selectBrowserSuites([`apps/e2e/tests/${file}`]).mode !== "library") continue;
    assert.ok(libraryStages.some(stage => stage.includes(file)), `${file} must run in Library mode`);
  }
  assert.ok(workflow.indexOf("- name: Verify Library first-run") < workflow.indexOf("- name: Test the packaged"));
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
