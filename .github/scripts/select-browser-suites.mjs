#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const libraryTest =
  /^apps\/e2e\/tests\/(?:library-(?:discovery|import-announcements|lifecycle|transactions|ux|covers|search|compact|description|inspector|file-drop|localization|card-focus|review-keyboard|scrubber-progress|save-as)|book-opening|book-details-presentation|book-metadata-display|epub-direct-import|native-library-import|review-invitation|reader-library|reader-back-to-library|reader-save-as|first-reading-welcome|shell-accessibility-audit)\.spec\.ts$/;

const libraryIntegration = new Set([
  "apps/e2e/library-tools.ts",
  "apps/extension/src/reader/components/ReaderLibraryPanel.tsx",
  "apps/extension/src/reader/components/ReaderLibraryPanel.test.tsx",
]);

const browserIndependentTooling = new Set([
  ".github/scripts/select-browser-suites.mjs",
  ".github/scripts/select-browser-suites.test.mjs",
  ".github/workflows/epub-conformance.yml",
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
  "scripts/epub-conformance-required.mjs",
  "scripts/epub-conformance-required.d.mts",
  "scripts/epub-conformance-required.test.mjs",
  "scripts/epub-conformance-publications.mjs",
  "scripts/epub-conformance-publications.d.mts",
  "scripts/epub-conformance-publications.test.mjs",
  "apps/e2e/assessment/required.spec.ts",
]);

function isDocumentation(file) {
  return (
    file.endsWith(".md") ||
    file === "LICENSE" ||
    file === "THIRD_PARTY_NOTICES.md" ||
    file.startsWith("docs/")
  );
}

function isBrowserIndependentTooling(file) {
  return file.startsWith("conformance/epub-3.4/") || browserIndependentTooling.has(file);
}

function isLocalization(file) {
  return (
    file.startsWith("apps/extension/src/i18n/") ||
    file === "apps/e2e/tests/library-localization.spec.ts"
  );
}

function isLibrary(file) {
  return file.startsWith("apps/extension/src/library/") || libraryTest.test(file) || libraryIntegration.has(file);
}

export function selectBrowserSuites(changedFiles, forceFull = false) {
  const files = [...new Set(changedFiles.map((file) => file.trim()).filter(Boolean))].sort();
  let mode;
  if (forceFull || files.length === 0) mode = "full";
  else if (files.every(isDocumentation)) mode = "none";
  else if (files.every((file) => isDocumentation(file) || isBrowserIndependentTooling(file))) {
    mode = "tooling";
  } else if (files.every((file) => isDocumentation(file) || isLocalization(file))) {
    mode = "localization";
  } else if (
    files.every((file) => isDocumentation(file) || isLocalization(file) || isLibrary(file))
  ) {
    mode = "library";
  } else mode = "full";

  return {
    mode,
    run_browser: mode !== "none" && mode !== "tooling",
    run_reader: mode === "full",
    run_library: mode === "full" || mode === "library",
    run_library_integration: mode === "library",
    run_localization: mode === "localization",
    files,
  };
}

function run() {
  const forceFull = process.argv.includes("--full");
  const files = forceFull ? [] : readFileSync(0, "utf8").split(/\r?\n/);
  const selection = selectBrowserSuites(files, forceFull);
  const output = [
    `mode=${selection.mode}`,
    `run_browser=${selection.run_browser}`,
    `run_reader=${selection.run_reader}`,
    `run_library=${selection.run_library}`,
    `run_library_integration=${selection.run_library_integration}`,
    `run_localization=${selection.run_localization}`,
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  console.log(
    JSON.stringify(
      {
        ...selection,
        reason: forceFull
          ? "manual, called, or unbounded run"
          : `${selection.files.length} changed file(s)`,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
