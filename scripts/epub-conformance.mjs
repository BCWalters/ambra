#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = path.join(root, "conformance/epub-3.4/config.json");
const statuses = new Set(["pass", "fail", "not-run", "not-applicable"]);
const methods = new Set(["manual", "automated"]);
const requirements = new Set(["must", "should", "may", "deprecated"]);

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function attributes(source) {
  const values = {};
  for (const match of source.matchAll(/([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    values[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return values;
}

function elementValues(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "gi")),
  ].map((match) => decodeXml(match[1]));
}

function metadataValues(xml) {
  const values = [];
  const expression = /<meta\b([^>]*)>([\s\S]*?)<\/meta\s*>|<meta\b([^>]*)\/\s*>/gi;
  for (const match of xml.matchAll(expression)) {
    values.push({
      attributes: attributes(match[1] ?? match[3] ?? ""),
      value: decodeXml(match[2] ?? ""),
    });
  }
  return values;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required.`);
  return value.trim();
}

function first(values, label) {
  if (values.length === 0) throw new Error(`${label} is missing.`);
  return values[0];
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read as JSON: ${error.message}`, { cause: error });
  }
}

export async function loadConfig() {
  return readJson(configPath, "EPUB conformance configuration");
}

async function suiteCommit(suitePath) {
  const result = spawnSync("git", ["-C", suitePath, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`The suite directory must be a Git checkout: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function verifySuite(suitePath, config) {
  const resolved = await realpath(suitePath);
  const commit = await suiteCommit(resolved);
  if (commit !== config.suite.revision) {
    throw new Error(`Expected W3C suite revision ${config.suite.revision}, received ${commit}.`);
  }
  return resolved;
}

async function packageDocument(testDirectory) {
  const containerPath = path.join(testDirectory, "META-INF/container.xml");
  const container = await readFile(containerPath, "utf8");
  const rootfile = container.match(/<rootfile\b([^>]*)\/?\s*>/i);
  if (!rootfile) throw new Error(`${containerPath} does not declare a rootfile.`);
  const fullPath = requireString(attributes(rootfile[1])["full-path"], `${containerPath} rootfile`);
  const resolved = path.resolve(testDirectory, fullPath);
  const relative = path.relative(testDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${containerPath} points outside its test directory.`);
  }
  return { file: resolved, xml: await readFile(resolved, "utf8") };
}

export async function inventorySuite(suitePath, config = {}) {
  const testsPath = path.join(suitePath, "tests");
  const entries = (await readdir(testsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("xx-"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const tests = [];
  const seen = new Set();

  for (const entry of entries) {
    const { file, xml } = await packageDocument(path.join(testsPath, entry.name));
    const metas = metadataValues(xml);
    const sourceIdentifier = first(elementValues(xml, "dc:identifier"), `${file} dc:identifier`);
    const identifier = config.suite?.identifierOverrides?.[entry.name] ?? sourceIdentifier;
    const coverage = first(elementValues(xml, "dc:coverage"), `${file} dc:coverage`);
    const coverageId =
      xml.match(/<dc:coverage\b([^>]*)>/i)?.[1] &&
      attributes(xml.match(/<dc:coverage\b([^>]*)>/i)[1]).id;
    const collection = metas.find((meta) => meta.attributes.property === "belongs-to-collection");
    const requirement = (collection?.value || "must").toLowerCase();
    if (!requirements.has(requirement)) {
      throw new Error(`${identifier} has unsupported requirement classification "${requirement}".`);
    }
    const versionMeta = metas.find(
      (meta) =>
        meta.attributes.property === "schema:version" &&
        (!coverageId || meta.attributes.refines === `#${coverageId}`),
    );
    const test = {
      id: identifier,
      title:
        config.suite?.titleOverrides?.[entry.name] ??
        first(elementValues(xml, "dc:title"), `${file} dc:title`),
      description: first(elementValues(xml, "dc:description"), `${file} dc:description`),
      coverage,
      version: versionMeta?.value || "3.3",
      requirement,
      references: metas
        .filter((meta) => meta.attributes.property === "dcterms:isReferencedBy")
        .map((meta) => meta.value),
      sourceDirectories: [entry.name],
      sourceIdentifier,
    };
    if (seen.has(identifier)) {
      const combined = config.suite?.combinedIdentifiers?.[identifier];
      const existing = tests.find((candidate) => candidate.id === identifier);
      if (!combined || !existing || !combined.includes(entry.name)) {
        throw new Error(`Duplicate W3C test identifier: ${identifier}.`);
      }
      existing.sourceDirectories.push(entry.name);
      continue;
    }
    seen.add(identifier);
    tests.push(test);
  }
  for (const [identifier, directories] of Object.entries(config.suite?.combinedIdentifiers ?? {})) {
    const actual = tests.find((test) => test.id === identifier)?.sourceDirectories ?? [];
    if ([...actual].sort().join("\n") !== [...directories].sort().join("\n")) {
      throw new Error(`Combined W3C test ${identifier} does not match its configured directories.`);
    }
  }
  if (tests.length === 0) throw new Error("The pinned W3C suite contains no tests.");
  const publications = tests.reduce((total, test) => total + test.sourceDirectories.length, 0);
  if (config.suite?.expectedTests && tests.length !== config.suite.expectedTests) {
    throw new Error(
      `Expected ${config.suite.expectedTests} W3C tests, inventoried ${tests.length}.`,
    );
  }
  if (config.suite?.expectedPublications && publications !== config.suite.expectedPublications) {
    throw new Error(
      `Expected ${config.suite.expectedPublications} W3C publications, inventoried ${publications}.`,
    );
  }
  return tests.sort((left, right) => left.id.localeCompare(right.id));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validateRelease(releasePath) {
  const release = await readJson(releasePath, "release metadata");
  const archive = requireString(release.archive, "release archive");
  const version = requireString(release.version, "release version");
  const commit = requireString(release.commit, "release commit");
  const expected = requireString(release.sha256, "release SHA-256");
  if (release.dirty !== false)
    throw new Error("Conformance assessment requires a clean release package.");
  if (path.basename(archive) !== archive) {
    throw new Error("Release archive must be a file in the release metadata directory.");
  }
  const archivePath = path.resolve(path.dirname(releasePath), archive);
  const actual = sha256(await readFile(archivePath));
  if (actual !== expected)
    throw new Error(`Release package SHA-256 mismatch: expected ${expected}, received ${actual}.`);
  return { archive, version, commit, sha256: actual };
}

export function createAssessment(config, release, tests) {
  return {
    schemaVersion: config.schemaVersion,
    suite: { ...config.suite },
    release: { ...release },
    environment: {
      testedAt: "",
      tester: "",
      browser: { name: "Google Chrome", version: "" },
      os: { name: "", version: "" },
      runner: { mode: "manual", configuration: "" },
    },
    optionalFeatures: {
      supported: [],
      intentionallyUnsupported: [],
    },
    tests: Object.fromEntries(
      tests.map((test) => [
        test.id,
        {
          status: "not-run",
          method: "manual",
          reason: "Assessment not completed.",
          evidence: null,
          trackingIssue: null,
        },
      ]),
    ),
  };
}

function sameRelease(left, right) {
  return ["archive", "version", "commit", "sha256"].every((key) => left?.[key] === right[key]);
}

function validateEnvironment(environment) {
  requireString(environment?.tester, "assessment environment tester");
  const testedAt = requireString(environment?.testedAt, "assessment environment testedAt");
  if (Number.isNaN(Date.parse(testedAt)))
    throw new Error("assessment environment testedAt must be an ISO date.");
  requireString(environment?.browser?.name, "assessment browser name");
  requireString(environment?.browser?.version, "assessment browser version");
  requireString(environment?.os?.name, "assessment OS name");
  requireString(environment?.os?.version, "assessment OS version");
  if (environment?.runner?.mode !== "manual" && environment?.runner?.mode !== "automated") {
    throw new Error('assessment runner mode must be "manual" or "automated".');
  }
  requireString(environment?.runner?.configuration, "assessment runner configuration");
}

function validateOptionalFeatures(value, config) {
  const known = new Set(config.optionalFeatureGroups);
  const supported = value?.supported;
  const unsupported = value?.intentionallyUnsupported;
  if (!Array.isArray(supported) || !Array.isArray(unsupported)) {
    throw new Error("optionalFeatures must provide supported and intentionallyUnsupported arrays.");
  }
  for (const group of [...supported, ...unsupported]) {
    if (!known.has(group)) throw new Error(`Unknown optional feature group "${group}".`);
  }
  const duplicates = supported.filter((group) => unsupported.includes(group));
  if (duplicates.length > 0) {
    throw new Error(
      `Optional feature groups cannot be both supported and unsupported: ${duplicates.join(", ")}.`,
    );
  }
  return {
    supported: [...new Set(supported)].sort(),
    intentionallyUnsupported: [...new Set(unsupported)].sort(),
    notAssessed: config.optionalFeatureGroups
      .filter((group) => !supported.includes(group) && !unsupported.includes(group))
      .sort(),
  };
}

export function validateAssessment(assessment, config, release, tests) {
  if (assessment?.schemaVersion !== config.schemaVersion) {
    throw new Error(`Assessment schemaVersion must be ${config.schemaVersion}.`);
  }
  if (
    assessment?.suite?.repository !== config.suite.repository ||
    assessment?.suite?.revision !== config.suite.revision
  ) {
    throw new Error(
      "Assessment suite repository and revision must match the pinned configuration.",
    );
  }
  if (!sameRelease(assessment.release, release)) {
    throw new Error("Assessment release metadata does not match the exact production package.");
  }
  validateEnvironment(assessment.environment);
  const optionalFeatures = validateOptionalFeatures(assessment.optionalFeatures, config);
  if (
    !assessment.tests ||
    typeof assessment.tests !== "object" ||
    Array.isArray(assessment.tests)
  ) {
    throw new Error("Assessment tests must be an object keyed by W3C test identifier.");
  }
  const expected = new Set(tests.map((test) => test.id));
  const missing = tests.filter((test) => !(test.id in assessment.tests)).map((test) => test.id);
  const unknown = Object.keys(assessment.tests).filter((id) => !expected.has(id));
  if (missing.length > 0) throw new Error(`Assessment is missing tests: ${missing.join(", ")}.`);
  if (unknown.length > 0)
    throw new Error(`Assessment contains unknown tests: ${unknown.join(", ")}.`);

  const results = {};
  for (const test of tests) {
    const result = assessment.tests[test.id];
    if (!statuses.has(result?.status)) throw new Error(`${test.id} has an invalid status.`);
    if (!methods.has(result?.method))
      throw new Error(`${test.id} has an invalid assessment method.`);
    if (
      (result.status === "not-run" || result.status === "not-applicable") &&
      (typeof result.reason !== "string" || result.reason.trim() === "")
    ) {
      throw new Error(`${test.id} requires a reason for status ${result.status}.`);
    }
    for (const field of ["evidence", "trackingIssue"]) {
      if (
        result[field] !== null &&
        result[field] !== undefined &&
        typeof result[field] !== "string"
      ) {
        throw new Error(`${test.id} ${field} must be a string or null.`);
      }
    }
    if (
      typeof result.evidence === "string" &&
      result.evidence.trim() &&
      !/^https:\/\/\S+$/.test(result.evidence.trim())
    ) {
      throw new Error(`${test.id} evidence must be an HTTPS URL.`);
    }
    if (
      typeof result.trackingIssue === "string" &&
      result.trackingIssue.trim() &&
      !/^https:\/\/github\.com\/BCWalters\/ambra\/issues\/[1-9]\d*$/.test(
        result.trackingIssue.trim(),
      )
    ) {
      throw new Error(`${test.id} trackingIssue must link to an Ambra GitHub issue.`);
    }
    results[test.id] = {
      status: result.status,
      method: result.method,
      reason:
        typeof result.reason === "string" && result.reason.trim() ? result.reason.trim() : null,
      evidence:
        typeof result.evidence === "string" && result.evidence.trim()
          ? result.evidence.trim()
          : null,
      trackingIssue:
        typeof result.trackingIssue === "string" && result.trackingIssue.trim()
          ? result.trackingIssue.trim()
          : null,
    };
  }
  return { results, optionalFeatures };
}

export function validatePreviousReport(previous, config) {
  if (previous?.schemaVersion !== config.schemaVersion) {
    throw new Error(`Previous report schemaVersion must be ${config.schemaVersion}.`);
  }
  requireString(previous?.ambra?.version, "previous report Ambra version");
  if (!previous.tests || typeof previous.tests !== "object" || Array.isArray(previous.tests)) {
    throw new Error("Previous report tests must be an object keyed by W3C test identifier.");
  }
  for (const [identifier, test] of Object.entries(previous.tests)) {
    const status = test?.result?.status ?? test?.status;
    if (!statuses.has(status)) {
      throw new Error(`Previous report test ${identifier} has an invalid status.`);
    }
  }
  return previous;
}

function score(tests, results, requirement) {
  const selected = tests.filter((test) => test.requirement === requirement);
  const count = (status) => selected.filter((test) => results[test.id].status === status).length;
  const passed = count("pass");
  const failed = count("fail");
  const run = passed + failed;
  return {
    passed,
    failed,
    run,
    notRun: count("not-run"),
    notApplicable: count("not-applicable"),
    total: selected.length,
    percentage: run === 0 ? null : Number(((passed / run) * 100).toFixed(2)),
  };
}

function manualScore(tests, results) {
  const selected = tests.filter(
    (test) => results[test.id].method === "manual" && results[test.id].status !== "not-applicable",
  );
  const completed = selected.filter((test) =>
    ["pass", "fail"].includes(results[test.id].status),
  ).length;
  return {
    completed,
    applicable: selected.length,
    notRun: selected.length - completed,
    notApplicable: tests.filter(
      (test) =>
        results[test.id].method === "manual" && results[test.id].status === "not-applicable",
    ).length,
    percentage:
      selected.length === 0 ? null : Number(((completed / selected.length) * 100).toFixed(2)),
  };
}

function compare(previous, tests, results) {
  if (!previous) {
    return {
      previousVersion: null,
      regressions: [],
      improvements: [],
      changed: [],
      added: tests.map((test) => test.id),
      removed: [],
    };
  }
  const previousTests = previous.tests ?? {};
  const currentIds = new Set(tests.map((test) => test.id));
  const changed = [];
  const regressions = [];
  const improvements = [];
  for (const test of tests) {
    const before = previousTests[test.id]?.result?.status ?? previousTests[test.id]?.status;
    const after = results[test.id].status;
    if (!before || before === after) continue;
    const entry = { id: test.id, requirement: test.requirement, before, after };
    changed.push(entry);
    if (before === "pass" && after !== "pass" && after !== "not-applicable")
      regressions.push(entry);
    if (before === "fail" && after === "pass") improvements.push(entry);
  }
  return {
    previousVersion: previous.ambra?.version ?? previous.release?.version ?? null,
    regressions,
    improvements,
    changed,
    added: tests.filter((test) => !previousTests[test.id]).map((test) => test.id),
    removed: Object.keys(previousTests).filter((id) => !currentIds.has(id)),
  };
}

export function buildReport({
  config,
  release,
  assessment,
  tests,
  validated,
  previous,
  generatedAt,
}) {
  const { results, optionalFeatures } = validated;
  const required = score(tests, results, "must");
  const recommended = score(tests, results, "should");
  const manual = manualScore(tests, results);
  const comparison = compare(previous, tests, results);
  const supportedGroupsWithIncompleteTests = optionalFeatures.supported.filter((group) =>
    tests.some(
      (test) =>
        test.coverage === group &&
        (results[test.id].status === "fail" || results[test.id].status === "not-run"),
    ),
  );
  const untrackedFailures = tests
    .filter((test) => results[test.id].status === "fail" && !results[test.id].trackingIssue)
    .map((test) => test.id);
  const newRequiredFailures = tests
    .filter((test) => {
      if (test.requirement !== "must" || results[test.id].status !== "fail") return false;
      const before =
        previous?.tests?.[test.id]?.result?.status ?? previous?.tests?.[test.id]?.status;
      return before !== "fail";
    })
    .map((test) => test.id);
  const requiredRegressions = comparison.regressions
    .filter((entry) => entry.requirement === "must")
    .map((entry) => entry.id);
  const gateReasons = [];
  if (required.notRun > 0)
    gateReasons.push(`${required.notRun} applicable required tests are not run.`);
  if (newRequiredFailures.length > 0) {
    gateReasons.push(`New required failures: ${newRequiredFailures.join(", ")}.`);
  }
  if (requiredRegressions.length > 0) {
    gateReasons.push(`Required regressions: ${requiredRegressions.join(", ")}.`);
  }
  if (untrackedFailures.length > 0) {
    gateReasons.push(`Failures without tracking issues: ${untrackedFailures.join(", ")}.`);
  }
  if (supportedGroupsWithIncompleteTests.length > 0) {
    gateReasons.push(
      `Supported optional groups have failed or unrun tests: ${supportedGroupsWithIncompleteTests.join(", ")}.`,
    );
  }
  const assessedGroups =
    optionalFeatures.supported.length + optionalFeatures.intentionallyUnsupported.length;
  const reportTests = Object.fromEntries(
    tests.map((test) => [
      test.id,
      {
        title: test.title,
        description: test.description,
        coverage: test.coverage,
        version: test.version,
        requirement: test.requirement,
        references: test.references,
        sourceDirectories: test.sourceDirectories,
        sourceIdentifier: test.sourceIdentifier,
        result: results[test.id],
      },
    ]),
  );
  return {
    schemaVersion: config.schemaVersion,
    generatedAt,
    specifications: config.specifications,
    suite: config.suite,
    ambra: release,
    environment: assessment.environment,
    scores: {
      required,
      recommended,
      optionalFeatures: {
        supported: optionalFeatures.supported.length,
        assessed: assessedGroups,
        totalGroups: config.optionalFeatureGroups.length,
        percentage:
          assessedGroups === 0
            ? null
            : Number(((optionalFeatures.supported.length / assessedGroups) * 100).toFixed(2)),
        ...optionalFeatures,
      },
      manual,
    },
    releaseAssessment: {
      passed: gateReasons.length === 0,
      reasons: gateReasons,
      conformanceClaimEligible:
        required.percentage === 100 &&
        required.notRun === 0 &&
        required.failed === 0 &&
        gateReasons.length === 0,
      newRequiredFailures,
      untrackedFailures,
    },
    comparison,
    tests: reportTests,
  };
}

function percent(value) {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

function cell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function link(value) {
  return value ? `[link](${value})` : "";
}

export function renderMarkdown(report) {
  const required = report.scores.required;
  const recommended = report.scores.recommended;
  const optional = report.scores.optionalFeatures;
  const manual = report.scores.manual;
  const lines = [
    `# EPUB 3.4 conformance report - Ambra ${report.ambra.version}`,
    "",
    `**Release assessment:** ${report.releaseAssessment.passed ? "PASS" : "FAIL"}`,
    `**Headline required conformance score:** ${percent(required.percentage)} (${required.passed}/${required.run} run; ${required.notRun} not run; ${required.notApplicable} not applicable)`,
    "",
    "## Assessment identity",
    "",
    `- Ambra commit: \`${report.ambra.commit}\``,
    `- Production package: \`${report.ambra.archive}\``,
    `- Package SHA-256: \`${report.ambra.sha256}\``,
    `- W3C suite revision: \`${report.suite.revision}\``,
    `- Tested: ${report.environment.testedAt} by ${report.environment.tester}`,
    `- Browser: ${report.environment.browser.name} ${report.environment.browser.version}`,
    `- OS: ${report.environment.os.name} ${report.environment.os.version}`,
    `- Runner: ${report.environment.runner.mode}; ${report.environment.runner.configuration}`,
    "",
    "## Scores",
    "",
    "| Measure | Score | Passed/completed | Denominator | Not run | Not applicable |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Required conformance | ${percent(required.percentage)} | ${required.passed} | ${required.run} | ${required.notRun} | ${required.notApplicable} |`,
    `| Recommended behavior | ${percent(recommended.percentage)} | ${recommended.passed} | ${recommended.run} | ${recommended.notRun} | ${recommended.notApplicable} |`,
    `| Optional feature coverage | ${percent(optional.percentage)} | ${optional.supported} | ${optional.assessed} | ${optional.notAssessed.length} groups | n/a |`,
    `| Manual completion | ${percent(manual.percentage)} | ${manual.completed} | ${manual.applicable} | ${manual.notRun} | ${manual.notApplicable} |`,
    "",
    `Supported optional groups: ${optional.supported.length ? optional.supported.join(", ") : "none recorded"}.`,
    `Intentionally unsupported optional groups: ${optional.intentionallyUnsupported.length ? optional.intentionallyUnsupported.join(", ") : "none recorded"}.`,
    `Unassessed optional groups: ${optional.notAssessed.length ? optional.notAssessed.join(", ") : "none"}.`,
    "",
    "## Release gate",
    "",
  ];
  if (report.releaseAssessment.reasons.length === 0) {
    lines.push(
      "- No incomplete required tests, new required failures, untracked failures, or required regressions.",
    );
  } else {
    lines.push(...report.releaseAssessment.reasons.map((reason) => `- ${reason}`));
  }
  lines.push(
    "",
    `Conformance claim eligible: **${report.releaseAssessment.conformanceClaimEligible ? "yes" : "no"}**.`,
    "",
    "## Comparison with previous release",
    "",
  );
  if (!report.comparison.previousVersion) {
    lines.push("- No previous report supplied; this report establishes a baseline.");
  } else {
    lines.push(
      `- Previous version: ${report.comparison.previousVersion}`,
      `- Regressions: ${report.comparison.regressions.length}`,
      `- Improvements: ${report.comparison.improvements.length}`,
      `- Added tests: ${report.comparison.added.length}`,
      `- Removed tests: ${report.comparison.removed.length}`,
    );
    for (const entry of report.comparison.regressions) {
      lines.push(`  - Regression: \`${entry.id}\` (${entry.before} -> ${entry.after})`);
    }
  }
  lines.push(
    "",
    "## Per-test results",
    "",
    "| Test | Requirement | Coverage | Method | Result | Reason | Issue | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [id, test] of Object.entries(report.tests)) {
    lines.push(
      `| \`${cell(id)}\` | ${cell(test.requirement)} | ${cell(test.coverage)} | ${cell(test.result.method)} | ${cell(test.result.status)} | ${cell(test.result.reason)} | ${link(test.result.trackingIssue)} | ${link(test.result.evidence)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near "${name ?? ""}".`);
    }
    options[name.slice(2)] = value;
  }
  return { command, options };
}

function option(options, name) {
  return requireString(options[name], `--${name}`);
}

async function prepare(options) {
  const config = await loadConfig();
  const suitePath = await verifySuite(option(options, "suite"), config);
  const release = await validateRelease(path.resolve(option(options, "release")));
  const tests = await inventorySuite(suitePath, config);
  const output = path.resolve(option(options, "output"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(createAssessment(config, release, tests), null, 2)}\n`);
  console.log(`Prepared ${tests.length}-test worksheet at ${output}.`);
}

async function report(options) {
  const config = await loadConfig();
  const suitePath = await verifySuite(option(options, "suite"), config);
  const release = await validateRelease(path.resolve(option(options, "release")));
  const tests = await inventorySuite(suitePath, config);
  const assessment = await readJson(path.resolve(option(options, "assessment")), "assessment");
  const validated = validateAssessment(assessment, config, release, tests);
  const previous = options.previous
    ? validatePreviousReport(
        await readJson(path.resolve(options.previous), "previous conformance report"),
        config,
      )
    : null;
  const result = buildReport({
    config,
    release,
    assessment,
    tests,
    validated,
    previous,
    generatedAt: new Date().toISOString(),
  });
  const outputDirectory = path.resolve(option(options, "output"));
  await mkdir(outputDirectory, { recursive: true });
  const basename = `epub-3.4-conformance-${release.version}`;
  await Promise.all([
    writeFile(
      path.join(outputDirectory, `${basename}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    ),
    writeFile(path.join(outputDirectory, `${basename}.md`), renderMarkdown(result)),
  ]);
  console.log(
    `Wrote ${basename}.json and ${basename}.md; release assessment ${result.releaseAssessment.passed ? "passed" : "failed"}.`,
  );
  if (!result.releaseAssessment.passed) process.exitCode = 2;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "prepare") await prepare(options);
  else if (command === "report") await report(options);
  else throw new Error("Usage: epub-conformance.mjs <prepare|report> --suite PATH ...");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
