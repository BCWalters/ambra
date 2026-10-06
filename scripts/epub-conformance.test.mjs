import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildReport,
  createAssessment,
  inventorySuite,
  renderMarkdown,
  validateAssessment,
  validatePreviousReport,
  validateRelease,
} from "./epub-conformance.mjs";

const config = {
  schemaVersion: 1,
  specifications: {
    epub: "https://example.test/epub",
    readingSystems: "https://example.test/epub-rs",
    accessibility: "https://example.test/epub-a11y",
  },
  suite: {
    repository: "https://github.com/w3c/epub-tests.git",
    revision: "a".repeat(40),
  },
  optionalFeatureGroups: ["Media Overlays", "Scripting", "Structural Semantics"],
};

const release = {
  archive: "ambra-2.2.0.zip",
  version: "2.2.0",
  commit: "b".repeat(40),
  sha256: "c".repeat(64),
};

const tests = [
  {
    id: "required",
    title: "Required",
    description: "Required behavior",
    coverage: "Package Documents",
    version: "3.3",
    requirement: "must",
    references: [],
    sourceDirectories: ["required"],
    sourceIdentifier: "required",
  },
  {
    id: "recommended",
    title: "Recommended",
    description: "Recommended behavior",
    coverage: "Internationalization",
    version: "3.4",
    requirement: "should",
    references: [],
    sourceDirectories: ["recommended"],
    sourceIdentifier: "recommended",
  },
  {
    id: "optional",
    title: "Optional",
    description: "Optional behavior",
    coverage: "Structural Semantics",
    version: "3.4",
    requirement: "may",
    references: [],
    sourceDirectories: ["optional"],
    sourceIdentifier: "optional",
  },
  {
    id: "legacy",
    title: "Legacy",
    description: "Deprecated behavior",
    coverage: "Open Container Format",
    version: "3.3",
    requirement: "deprecated",
    references: [],
    sourceDirectories: ["legacy"],
    sourceIdentifier: "legacy",
  },
];

function completedAssessment() {
  const assessment = createAssessment(config, release, tests);
  assessment.environment = {
    testedAt: "2026-10-06T12:00:00.000Z",
    tester: "Ambra release owner",
    browser: { name: "Google Chrome", version: "141.0.0.0" },
    os: { name: "macOS", version: "26.0" },
    runner: { mode: "manual", configuration: "Expanded production extension" },
  };
  assessment.optionalFeatures.supported = ["Structural Semantics"];
  assessment.tests.required = {
    status: "pass",
    method: "automated",
    reason: null,
    evidence: "https://example.test/evidence",
    trackingIssue: null,
  };
  assessment.tests.recommended = {
    status: "fail",
    method: "manual",
    reason: "Observed mismatch.",
    evidence: null,
    trackingIssue: "https://github.com/BCWalters/ambra/issues/1",
  };
  assessment.tests.optional = {
    status: "not-applicable",
    method: "manual",
    reason: "This optional behavior is not exposed.",
    evidence: null,
    trackingIssue: null,
  };
  assessment.tests.legacy = {
    status: "not-run",
    method: "manual",
    reason: "Deferred legacy assessment.",
    evidence: null,
    trackingIssue: null,
  };
  return assessment;
}

test("assessment validation requires exact inventory and reasons", () => {
  const assessment = completedAssessment();
  delete assessment.tests.required;
  assert.throws(
    () => validateAssessment(assessment, config, release, tests),
    /missing tests: required/,
  );

  const invalidReason = completedAssessment();
  invalidReason.tests.legacy.reason = "";
  assert.throws(
    () => validateAssessment(invalidReason, config, release, tests),
    /legacy requires a reason/,
  );

  const wrongPackage = completedAssessment();
  wrongPackage.release.sha256 = "d".repeat(64);
  assert.throws(
    () => validateAssessment(wrongPackage, config, release, tests),
    /does not match the exact production package/,
  );
});

test("report keeps required, recommended, optional, and manual scores separate", () => {
  const assessment = completedAssessment();
  const validated = validateAssessment(assessment, config, release, tests);
  const report = buildReport({
    config,
    release,
    assessment,
    tests,
    validated,
    previous: null,
    generatedAt: "2026-10-06T13:00:00.000Z",
  });

  assert.deepEqual(report.scores.required, {
    passed: 1,
    failed: 0,
    run: 1,
    notRun: 0,
    notApplicable: 0,
    total: 1,
    percentage: 100,
  });
  assert.equal(report.scores.recommended.percentage, 0);
  assert.equal(report.scores.optionalFeatures.percentage, 100);
  assert.deepEqual(report.scores.manual, {
    completed: 1,
    applicable: 2,
    notRun: 1,
    notApplicable: 1,
    percentage: 50,
  });
  assert.equal(report.releaseAssessment.passed, true);
  assert.equal(report.releaseAssessment.conformanceClaimEligible, true);
  assert.match(renderMarkdown(report), /Required conformance \| 100\.00%/);
  assert.match(renderMarkdown(report), /`legacy` \| deprecated/);
});

test("new required failures and regressions fail the release assessment", () => {
  const assessment = completedAssessment();
  assessment.tests.required = {
    status: "fail",
    method: "manual",
    reason: "The required behavior regressed.",
    evidence: null,
    trackingIssue: "https://github.com/BCWalters/ambra/issues/2",
  };
  const validated = validateAssessment(assessment, config, release, tests);
  const previous = {
    schemaVersion: 1,
    ambra: { version: "2.1.0" },
    tests: {
      required: { result: { status: "pass" } },
    },
  };
  const report = buildReport({
    config,
    release,
    assessment,
    tests,
    validated,
    previous,
    generatedAt: "2026-10-06T13:00:00.000Z",
  });

  assert.equal(report.releaseAssessment.passed, false);
  assert.deepEqual(report.releaseAssessment.newRequiredFailures, ["required"]);
  assert.deepEqual(report.comparison.regressions, [
    {
      id: "required",
      requirement: "must",
      before: "pass",
      after: "fail",
    },
  ]);
  assert.match(report.releaseAssessment.reasons.join("\n"), /Required regressions: required/);
});

test("previous reports and evidence links fail closed", () => {
  assert.throws(
    () =>
      validatePreviousReport({ schemaVersion: 1, ambra: { version: "2.1.0" }, tests: [] }, config),
    /tests must be an object/,
  );
  const assessment = completedAssessment();
  assessment.tests.required.evidence = "/tmp/local-screenshot.png";
  assert.throws(
    () => validateAssessment(assessment, config, release, tests),
    /evidence must be an HTTPS URL/,
  );
  assessment.tests.required.evidence = null;
  assessment.tests.recommended.trackingIssue = "https://github.com/other/project/issues/1";
  assert.throws(
    () => validateAssessment(assessment, config, release, tests),
    /must link to an Ambra GitHub issue/,
  );
});

test("release validation binds the worksheet to the archive digest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ambra-conformance-release-"));
  try {
    const archive = Buffer.from("production extension");
    const digest = createHash("sha256").update(archive).digest("hex");
    await writeFile(path.join(directory, "ambra-2.2.0.zip"), archive);
    await writeFile(
      path.join(directory, "release.json"),
      JSON.stringify({
        archive: "ambra-2.2.0.zip",
        version: "2.2.0",
        commit: "b".repeat(40),
        sha256: digest,
        dirty: false,
      }),
    );
    assert.equal((await validateRelease(path.join(directory, "release.json"))).sha256, digest);

    await writeFile(path.join(directory, "ambra-2.2.0.zip"), "changed");
    await assert.rejects(validateRelease(path.join(directory, "release.json")), /SHA-256 mismatch/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

async function writePublication(root, directory, identifier, title = identifier) {
  const testRoot = path.join(root, "tests", directory);
  await mkdir(path.join(testRoot, "META-INF"), { recursive: true });
  await mkdir(path.join(testRoot, "EPUB"), { recursive: true });
  await writeFile(
    path.join(testRoot, "META-INF/container.xml"),
    '<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
  );
  await writeFile(
    path.join(testRoot, "EPUB/package.opf"),
    `<package><metadata>
      <dc:coverage id="coverage">Package Documents</dc:coverage>
      <meta refines="#coverage" property="schema:version">3.4</meta>
      <dc:description>${title} description</dc:description>
      <dc:identifier>${identifier}</dc:identifier>
      <dc:title>${title}</dc:title>
      <meta property="dcterms:isReferencedBy">https://example.test/${directory}</meta>
    </metadata></package>`,
  );
}

test("suite inventory distinguishes overrides and declared multi-publication tests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ambra-conformance-suite-"));
  try {
    await writePublication(directory, "ordinary", "ordinary");
    await writePublication(directory, "corrected", "duplicate", "Incorrect title");
    await writePublication(directory, "combined-a", "combined");
    await writePublication(directory, "combined-b", "combined");
    const suiteConfig = {
      suite: {
        identifierOverrides: { corrected: "corrected" },
        titleOverrides: { corrected: "Corrected" },
        combinedIdentifiers: { combined: ["combined-a", "combined-b"] },
      },
    };
    const inventory = await inventorySuite(directory, suiteConfig);
    assert.equal(inventory.length, 3);
    assert.equal(inventory.find((entry) => entry.id === "corrected").title, "Corrected");
    assert.deepEqual(inventory.find((entry) => entry.id === "combined").sourceDirectories, [
      "combined-a",
      "combined-b",
    ]);
  } finally {
    await rm(directory, { recursive: true });
  }
});
