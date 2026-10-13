import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyAssessmentCiRun } from "./verify-assessment-ci-run.mjs";

const commit = "a".repeat(40);
const repository = "BCWalters/ambra";
const runId = "123";
const run = {
  id: 123, repository: { full_name: repository }, path: ".github/workflows/ci.yml",
  event: "push", head_branch: "main", head_sha: commit,
  status: "completed", conclusion: "success",
};

test("release assessment accepts only successful CI for its exact merged-main commit", () => {
  verifyAssessmentCiRun(run, runId, commit, repository);
  for (const change of [
    { id: 124 }, { repository: { full_name: "example/fork" } },
    { path: ".github/workflows/epub-conformance.yml" }, { event: "pull_request" },
    { event: "workflow_dispatch" }, { head_branch: "topic" },
    { head_sha: "b".repeat(40) }, { status: "in_progress" },
    { conclusion: "failure" }, { conclusion: "cancelled" }, { conclusion: null },
  ]) {
    assert.throws(() => verifyAssessmentCiRun({ ...run, ...change }, runId, commit, repository));
  }
  for (const invalid of [null, {}, { ...run, repository: null }, { ...run, id: "123" }]) {
    assert.throws(() => verifyAssessmentCiRun(invalid, runId, commit, repository));
  }
  for (const invalid of ["", undefined, "0", "../123", "123?query=1"]) {
    assert.throws(() => verifyAssessmentCiRun(run, invalid, commit, repository));
  }
  assert.throws(() => verifyAssessmentCiRun(run, runId, "", repository));
  assert.throws(() => verifyAssessmentCiRun(run, runId, commit, ""));
});

test("assessment restores the selected CI archive without rebuilding or silently falling back", async () => {
  const workflow = await readFile(new URL("../workflows/epub-conformance.yml", import.meta.url), "utf8");
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /name: Build exact production package\n\s+if: inputs\.release_run_id == ''/);
  assert.match(workflow, /node \.github\/scripts\/verify-assessment-ci-run\.mjs "\$RUNNER_TEMP\/release-ci-run\.json"/);
  assert.match(workflow, /gh run download "\$RELEASE_RUN_ID"[\s\S]*--name "beta-release-\$GITHUB_SHA"/);
  assert.match(workflow, /CI_PACKAGE_COMMIT="\$GITHUB_SHA"/);
  assert.match(workflow, /node \.github\/scripts\/restore-ci-package\.mjs/);
  assert.match(workflow, /version: 11\.11\.0/);
});
