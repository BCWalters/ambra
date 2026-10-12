import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function verifyAssessmentCiRun(run, runId, commit, repository) {
  if (!/^[1-9]\d*$/.test(runId) || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("An explicit CI run ID and source commit are required.");
  }
  if (!run || !Number.isSafeInteger(run.id) || String(run.id) !== runId ||
      run.repository?.full_name !== repository || !repository ||
      run.path !== ".github/workflows/ci.yml" || run.event !== "push" ||
      run.head_branch !== "main" || run.head_sha !== commit ||
      run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("Assessment requires successful merged-main CI for this exact repository and commit.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("CI run metadata file is required.");
  const run = JSON.parse(await readFile(process.argv[2], "utf8"));
  verifyAssessmentCiRun(run, process.env.RELEASE_RUN_ID, process.env.GITHUB_SHA, process.env.GITHUB_REPOSITORY);
  console.log(`Verified merged-main CI run ${run.id} for ${run.head_sha}.`);
}
