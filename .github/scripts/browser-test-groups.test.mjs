import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { browserArguments, browserGroups, browserMatrix, verifyReviewEvidence } from "./browser-test-groups.mjs";
import { verifyCiOutcome } from "./verify-ci-outcome.mjs";

const legacyFullFiles = `
library-discovery library-import-announcements library-lifecycle library-transactions library-ux
library-covers library-search library-compact library-description book-details-presentation
library-inspector native-library-import review-invitation library-file-drop page-turn-guide
footnote-noteref note-save-lifecycle library-localization media-overlay-playback
css-resources primary-reading-order resource-fallbacks resource-policy
navigation-accessibility-conformance cfi-recovery-conformance svg-spine reader-shortcuts-help
inspector-docking narration-discovery
book-opening book-metadata-display library-card-focus navigation-correctness browser-reading-history
toc-fragments settings-focus settings-ownership settings-lifecycle reader-preferences single-page-setting
reader-viewport-stability content-boundary-navigation disclosure-interaction native-reading-resume
shell-accessibility-audit shell-reflow-accessibility first-reading-welcome harness-lifecycle
reader-ui-dismissal reference-panel-coexistence reader-library reader-back-to-library popup-hover-ownership
margin-selection page-turn-margin page-turn-viewport scrubber-bookmarks scrubber-fast-release
library-scrubber-progress bookmark-panel annotation-mutation-lifecycle annotation-export-import
embedded-annotations page-theme spread-gutter-navigation outer-margin-navigation spread-resize-stability
reflowable-animation-handoff toolbar-startup inspector-reading-links inspector-page-boundaries
reader-go-to-shortcuts keyboard-ownership fixed-layout-scrubber fixed-layout-spread-hugging
fixed-layout-edge-navigation svg-spine fixed-layout-zoom mixed-rendition-spreads roll-layout pagination-measurement responsive-images
reader-diagnostics reader-scale-navigation scrubber-seek media-overlay-playback image-viewer content-stress
table-viewer epub-inspector epub-direct-import library-save-as reader-save-as review-invitation library-review-keyboard
`.trim().split(/\s+/);

function selected(mode) {
  const ids = browserMatrix(mode).include.map(group => group.id);
  return browserGroups.filter(group => ids.includes(group.id));
}

test("full matrix preserves every legacy protected file invocation, including intentional duplicates", () => {
  assert.deepEqual(selected("full").flatMap(group => group.steps.flatMap(step => step.files)).sort(),
    [...legacyFullFiles, "reader-error-recovery", "default-progression", "reflowable-rtl", "packaged-frames", "embedded-data-images", "svg-narration", "mixed-layout-placement", "html-base"].sort());
  const core = selected("full").filter(group => group.id.startsWith("reader-core-"))
    .flatMap(group => group.steps.flatMap(step => step.files));
  assert.equal(core.length, 56);
  assert.equal(new Set(core).size, core.length);
  assert.ok(selected("full").find(group => group.id === "contention-sensitive")
    .steps.some(step => step.files.includes("pagination-measurement") && step.workers === 1));
});

test("approved reader polish runs in protected CI without optional original-publication paths", () => {
  const args = browserArguments("reader-core-1")[0].args;
  for (const file of ["reader-error-recovery", "default-progression", "reflowable-rtl"]) {
    assert.ok(args.includes(`${file}.spec.ts`), file);
  }
  assert.ok(!args.includes("--grep"));
});

test("packaged frame isolation and bounded recursion run in protected resource validation", () => {
  assert.ok(browserArguments("resources")[0].args.includes("packaged-frames.spec.ts"));
  assert.ok(browserArguments("resources")[0].args.includes("embedded-data-images.spec.ts"));
  assert.ok(browserArguments("resources")[0].args.includes("html-base.spec.ts"));
});

test("mixed-layout painted content and explicit single-side placement run without original-publication opt-ins", () => {
  assert.ok(browserArguments("reader-core-3")[0].args.includes("mixed-layout-placement.spec.ts"));
});

test("selection preserves focused modes and rejects unknown modes and groups", () => {
  assert.deepEqual(browserMatrix("none"), { include: [] });
  assert.deepEqual(browserMatrix("tooling"), { include: [] });
  assert.deepEqual(selected("library").map(group => group.id), ["library", "library-integration", "local-features"]);
  assert.deepEqual(selected("localization").map(group => group.id), ["localization"]);
  assert.throws(() => browserMatrix("invented"), /Unknown/);
  assert.throws(() => browserArguments("invented"), /Unknown/);
});

test("all selected tests exist and output/report paths remain unique", () => {
  assert.equal(new Set(browserGroups.map(group => group.id)).size, browserGroups.length);
  const outputs = [];
  for (const group of browserGroups) {
    for (const step of group.steps) for (const file of step.files) {
      assert.ok(existsSync(new URL(`../../apps/e2e/tests/${file}.spec.ts`, import.meta.url)), file);
    }
    for (const step of browserArguments(group.id)) {
      outputs.push(step.args.find(argument => argument.startsWith("--output=")));
      assert.ok(!step.args.some(argument => argument.startsWith("--retries")));
      assert.ok(step.args.includes("--reporter=list,json"));
    }
  }
  assert.equal(new Set(outputs).size, outputs.length);
});

test("isolated timing, locale and narration probes retain one worker and original grep boundaries", () => {
  for (const id of ["contention-sensitive", "narration", "audio-resource-errors", "localization"]) {
    for (const step of browserArguments(id)) assert.ok(step.args.includes("--workers=1"));
  }
  assert.ok(browserArguments("library").find(step => step.name === "library-localization").args.includes("--workers=1"));
  assert.ok(browserArguments("audio-resource-errors")[0].args.includes("--grep"));
  assert.ok(browserArguments("narration")[0].args.includes("--grep-invert"));
  assert.ok(browserArguments("narration")[0].args.includes("svg-narration.spec.ts"));
  assert.ok(browserArguments("narration")[0].args.includes("@audio-resource-conformance"));
  for (const [id, marker] of [["image-transparency", "#226"], ["encoded-fragments", "#228"], ["inspector", "#181"]]) {
    assert.ok(browserArguments("reader-tools").find(step => step.name === id).args.includes(marker));
  }
});

test("review evidence remains required, not just optionally uploaded", () => {
  assert.throws(() => verifyReviewEvidence(["bookmark-panel"], []), /screenshots/);
  assert.throws(() => verifyReviewEvidence(["first-reading-welcome"], ["welcome-not-a-png.txt"]), /screenshots/);
  verifyReviewEvidence(["bookmark-panel", "first-reading-welcome"], ["a/bookmark-cards-wide.png", "b/welcome-dark.png"]);
  verifyReviewEvidence(["book-opening"], []);
});

test("required aggregate rejects failures, cancellation, accidental skips and empty browser matrices", () => {
  for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
    assert.throws(() => verifyCiOutcome(result, "false", "skipped", { include: [] }));
    assert.throws(() => verifyCiOutcome("success", "true", result, browserMatrix("full")));
  }
  assert.throws(() => verifyCiOutcome("success", "true", "success", { include: [] }));
  assert.throws(() => verifyCiOutcome("success", "", "skipped", { include: [] }));
  assert.throws(() => verifyCiOutcome("success", "false", "success", { include: [] }));
  assert.throws(() => verifyCiOutcome("success", "false", "skipped", browserMatrix("full")));
  assert.throws(() => verifyCiOutcome("success", "false", "skipped", undefined));
  verifyCiOutcome("success", "false", "skipped", browserMatrix("none"));
  verifyCiOutcome("success", "true", "success", browserMatrix("full"));
});

test("workflow preserves required-check name, non-cancelling shards and same-package identity gates", () => {
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /name: Validate and package/);
  assert.match(workflow, /needs: \[prepare, browser\]\s+if: always\(\)/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /CI_PACKAGE_SHA256: \$\{\{ needs\.prepare\.outputs\.package_sha256 \}\}/);
  assert.match(workflow, /CI_PACKAGE_COMMIT: \$\{\{ needs\.prepare\.outputs\.package_commit \}\}/);
  assert.match(workflow, /BROWSER_MATRIX: \$\{\{ needs\.prepare\.outputs\.matrix \}\}/);
  assert.match(workflow, /browser-test-groups\.mjs --run/);
});

test("browser execution matches the package's local-feature mode", () => {
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /name: Run selected browser group without retries\s+env:\s+BROWSER_GROUP: \$\{\{ matrix\.id \}\}\s+VITE_AMBRA_LOCAL_FEATURES: \$\{\{ matrix\.localFeatures && '1' \|\| '0' \}\}\s+run:/);
});

test("Ubuntu package setup fails closed within bounded network and step deadlines", () => {
  const config = readFileSync(new URL("../apt-network.conf", import.meta.url), "utf8");
  assert.match(config, /Acquire::http::Timeout "30";/);
  assert.match(config, /Acquire::https::Timeout "30";/);
  assert.match(config, /Acquire::Retries "0";/);
  assert.match(config, /APT::Update::Error-Mode "any";/);
  for (const name of ["ci.yml", "epub-conformance.yml"]) {
    const workflow = readFileSync(new URL(`../workflows/${name}`, import.meta.url), "utf8");
    assert.match(workflow, /sudo -n install -m 644 \.github\/apt-network\.conf \/etc\/apt\/apt\.conf\.d\/80-ambra-network/);
    assert.match(workflow, /timeout-minutes: 5\s+run: (?:\|[\s\S]*?|\s*)pnpm --filter @ambra\/e2e exec playwright install --with-deps chromium/);
  }
});
