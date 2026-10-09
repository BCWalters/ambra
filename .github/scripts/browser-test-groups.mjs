import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const step = (name, files, workers = 2, extra = []) => ({ name, files, workers, extra });
const core = [
  [
    "navigation-correctness", "browser-reading-history", "toc-fragments", "book-opening",
    "book-metadata-display", "library-card-focus", "toolbar-startup",
    "reader-preferences", "reader-library", "reader-back-to-library",
    "page-turn-viewport", "outer-margin-navigation",
    "reader-error-recovery", "default-progression", "reflowable-rtl",
  ],
  [
    "settings-focus", "settings-ownership", "settings-lifecycle", "single-page-setting",
    "reader-viewport-stability", "content-boundary-navigation", "disclosure-interaction",
    "native-reading-resume", "keyboard-ownership", "reader-go-to-shortcuts",
    "reader-ui-dismissal", "reference-panel-coexistence", "shell-reflow-accessibility",
  ],
  [
    "reflowable-animation-handoff", "spread-resize-stability",
    "fixed-layout-scrubber", "fixed-layout-spread-hugging", "fixed-layout-edge-navigation",
    "mixed-rendition-spreads", "roll-layout", "svg-spine", "responsive-images",
    "inspector-reading-links", "inspector-page-boundaries",
  ],
  [
    "shell-accessibility-audit", "first-reading-welcome",
    "harness-lifecycle", "popup-hover-ownership", "margin-selection", "page-turn-margin",
    "scrubber-bookmarks", "scrubber-fast-release",
    "library-scrubber-progress", "bookmark-panel", "annotation-mutation-lifecycle",
    "annotation-export-import", "embedded-annotations", "page-theme",
    "spread-gutter-navigation",
  ],
];

export const browserGroups = [
  {
    id: "library",
    modes: ["full", "library"],
    steps: [
      step("import-and-library", [
        "library-discovery", "library-import-announcements", "library-lifecycle",
        "library-transactions", "library-ux", "library-covers", "library-search",
        "library-compact", "library-description", "book-details-presentation",
        "library-inspector", "native-library-import", "review-invitation",
        "library-file-drop", "page-turn-guide", "footnote-noteref", "note-save-lifecycle",
      ]),
      step("library-localization", ["library-localization"], 1),
    ],
  },
  {
    id: "library-integration",
    modes: ["library"],
    steps: [step("reader-integration", [
      "book-opening", "book-metadata-display", "library-card-focus", "first-reading-welcome",
      "shell-accessibility-audit", "reader-library", "reader-back-to-library",
      "library-scrubber-progress", "library-save-as", "epub-direct-import", "reader-save-as",
    ])],
  },
  {
    id: "localization",
    modes: ["localization"],
    steps: [step("localized-shell", ["library-localization", "shell-reflow-accessibility"], 1,
      ["--grep", "localizes|locales|Help & About"])],
  },
  {
    id: "audio-resource-errors",
    modes: ["full"],
    steps: [step("audio-resource-errors", ["media-overlay-playback"], 1, ["--grep", "@audio-resource-conformance"])],
  },
  {
    id: "resources",
    modes: ["full"],
    codecs: true,
    steps: [
      step("epub-resources", [
        "css-resources", "primary-reading-order", "resource-fallbacks", "resource-policy", "packaged-frames", "embedded-data-images",
        "navigation-accessibility-conformance", "cfi-recovery-conformance",
        "svg-spine", "reader-shortcuts-help", "inspector-docking", "narration-discovery",
      ]),
    ],
  },
  ...core.map((files, index) => ({
    id: `reader-core-${index + 1}`,
    modes: ["full"],
    steps: [step("packaged-reader", files)],
  })),
  {
    id: "contention-sensitive",
    modes: ["full"],
    steps: [step("isolated-input-budgets", ["reader-diagnostics", "reader-scale-navigation", "scrubber-seek", "pagination-measurement"], 1)],
  },
  {
    id: "narration",
    modes: ["full"],
    steps: [step("recorded-narration", ["media-overlay-playback", "svg-narration"], 1,
      ["--grep-invert", "@audio-resource-conformance"])],
  },
  {
    id: "reader-tools",
    modes: ["full"],
    steps: [
      step("image-transparency", ["image-viewer"], 2, ["--grep", "#226"]),
      step("encoded-fragments", ["content-stress"], 2, ["--grep", "#228"]),
      step("table-viewer", ["table-viewer"]),
      step("inspector", ["epub-inspector"], 2, ["--grep", "#181"]),
      step("direct-import-and-save", ["epub-direct-import", "library-save-as", "reader-save-as"]),
    ],
  },
  {
    id: "local-features",
    modes: ["full", "library"],
    localFeatures: true,
    steps: [step("review-simulation", ["review-invitation", "library-review-keyboard"])],
  },
];

export function browserMatrix(mode) {
  if (!["full", "library", "localization", "none", "tooling"].includes(mode)) {
    throw new Error(`Unknown browser selection mode: ${mode}`);
  }
  return {
    include: browserGroups.filter(group => group.modes.includes(mode)).map(group => ({
      id: group.id, codecs: group.codecs ?? false, localFeatures: group.localFeatures ?? false,
    })),
  };
}

export function browserArguments(groupId) {
  const group = browserGroups.find(group => group.id === groupId);
  if (!group) throw new Error(`Unknown browser group: ${groupId}`);
  return group.steps.map(entry => ({
    name: entry.name,
    args: [
      "--filter", "@ambra/e2e", "exec", "playwright", "test",
      ...entry.files.map(file => `${file}.spec.ts`),
      ...entry.extra, `--workers=${entry.workers}`, "--reporter=list,json",
      `--output=test-results/${group.id}/${entry.name}`,
    ],
  }));
}

export function verifyReviewEvidence(specs, files) {
  for (const [spec, prefix] of [["bookmark-panel", "bookmark-cards-"], ["first-reading-welcome", "welcome-"]]) {
    if (specs.includes(spec) && !files.some(file => path.basename(file).startsWith(prefix) && file.endsWith(".png"))) {
      throw new Error(`Expected ${spec} review screenshots were not produced.`);
    }
  }
}

function runGroup(groupId) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const results = path.join(root, "apps/e2e/ci-browser-results", groupId);
  mkdirSync(results, { recursive: true });
  for (const entry of browserArguments(groupId)) {
    const started = Date.now();
    console.log(`::group::${groupId}: ${entry.name}`);
    const result = spawnSync("pnpm", entry.args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(results, `${entry.name}.json`) },
    });
    console.log("::endgroup::");
    const observation = {
      group: groupId, step: entry.name, durationMs: Date.now() - started,
      status: result.status, error: result.error?.message, arguments: entry.args,
    };
    writeFileSync(path.join(results, `${entry.name}.execution.json`), `${JSON.stringify(observation, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `- ${groupId}/${entry.name}: ${(observation.durationMs / 1000).toFixed(1)}s; exit ${result.status}\n`);
    }
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Browser step ${groupId}/${entry.name} failed (${result.status}).`);
  }
  const specs = browserGroups.find(group => group.id === groupId).steps.flatMap(entry => entry.files);
  const output = path.join(root, "apps/e2e/test-results", groupId);
  verifyReviewEvidence(specs, readdirSync(output, { recursive: true }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [operation, value] = process.argv.slice(2);
  if (operation === "--plan") {
    const matrix = JSON.stringify(browserMatrix(value));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
    console.log(matrix);
  } else if (operation === "--run") runGroup(value);
  else throw new Error("Use --plan <selection-mode> or --run <group-id>.");
}
