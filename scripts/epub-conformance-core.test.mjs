import assert from "node:assert/strict";
import test from "node:test";
import { mergeCoreAssessment } from "./epub-conformance-core.mjs";

const evidenceUrl = "https://github.com/BCWalters/ambra/actions/runs/123";
const release = {
  archive: "ambra.zip",
  version: "2.2.0",
  commit: "abc123",
  sha256: "exact-digest",
};
const ids = ["font", "image"];
const worksheet = {
  release,
  tests: {
    font: { status: "not-run" },
    image: { status: "not-run" },
    untouched: { status: "not-run", reason: "Needs manual evaluation." },
  },
  optionalFeatures: { supported: [], intentionallyUnsupported: [] },
};
const observation = (id) => ({
  id,
  release: { ...release },
  environment: {
    testedAt: "2026-10-06T00:00:00Z",
    os: { name: "Linux", version: "6.1" },
    browser: { name: "Chromium", version: "Chrome/153.0.0.0" },
  },
  result: {
    status: "pass",
    method: "automated",
    reason: "Native measurement.",
    evidence: evidenceUrl,
    trackingIssue: null,
  },
  observations: { painted: true },
});
const merge = (records) => mergeCoreAssessment(worksheet, records, { ids, evidenceUrl });

test("merges only the named profile and preserves unassessed criteria and optional groups", () => {
  const result = merge(ids.map(observation));
  assert.equal(result.tests.font.status, "pass");
  assert.deepEqual(result.tests.untouched, worksheet.tests.untouched);
  assert.deepEqual(result.optionalFeatures, worksheet.optionalFeatures);
  assert.equal(worksheet.tests.font.status, "not-run");
  assert.equal(result.environment.runner.mode, "automated");
});

test("preserves tracked native failures and explicit execution blockers", () => {
  const records = ids.map(observation);
  records[0].result.status = "fail";
  records[0].result.trackingIssue = "https://github.com/BCWalters/ambra/issues/328";
  records[1].result.status = "not-run";
  records[1].result.reason = "Execution blocked.";
  records[1].observations = null;
  records[1].environment.browser.version = null;
  const result = merge(records);
  assert.equal(result.tests.font.status, "fail");
  assert.equal(result.tests.image.status, "not-run");
});

test("rejects incomplete, duplicate, unknown and package-mismatched observations", () => {
  assert.throws(() => merge([observation("font")]), /Missing/);
  assert.throws(() => merge([observation("font"), observation("font")]), /duplicate/);
  assert.throws(() => merge([observation("font"), observation("unknown")]), /Unknown/);
  const records = ids.map(observation);
  records[0].release.sha256 = "different-package";
  assert.throws(() => merge(records), /fingerprint/);
});

test("rejects mixed provenance, untracked failures, invented not-applicable results and absent measurements", () => {
  for (const mutate of [
    (record) => {
      record.environment.browser.version = "Chrome/999";
    },
    (record) => {
      record.environment.os.name = "Darwin";
    },
    (record) => {
      record.result.status = "fail";
    },
    (record) => {
      record.result.status = "not-applicable";
    },
    (record) => {
      record.observations = null;
    },
    (record) => {
      record.result.evidence = "https://example.com";
    },
    (record) => {
      record.environment.testedAt = "not-a-date";
    },
    (record) => {
      record.environment.browser.version = null;
    },
  ]) {
    const records = ids.map(observation);
    mutate(records[1]);
    assert.throws(() => merge(records));
  }
});
