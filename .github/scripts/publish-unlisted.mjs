import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkStatus,
  configuration,
  createStoreClient,
  loadVerifiedArtifact,
} from "./upload-draft.mjs";

export async function publishUnlisted({ config, metadata, fetchImpl = fetch, log = console.log }) {
  if (config.unlistedVisibilityConfirmed !== true) {
    throw new Error(
      "UNLISTED publication requires explicit owner acknowledgment of saved dashboard visibility.",
    );
  }
  const request = await createStoreClient(config, fetchImpl);
  const status = await request(
    `https://chromewebstore.googleapis.com/v2/${config.name}:fetchStatus`,
    {},
    "Publication preflight",
  );
  checkStatus(status, metadata.version, config.name);
  log(
    "The v2 API uses saved dashboard visibility and cannot verify UNLISTED. Proceeding on owner acknowledgment and environment approval.",
  );
  const itemId = config.name.split("/").at(-1);
  const published = await request(
    `https://chromewebstore.googleapis.com/v2/${config.name}:publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publishType: "DEFAULT_PUBLISH",
        skipReview: false,
        blockOnWarnings: true,
      }),
    },
    "UNLISTED submission using saved visibility",
  );
  if (
    published.name !== config.name ||
    published.itemId !== itemId ||
    !["PENDING_REVIEW", "STAGED", "PUBLISHED"].includes(published.state) ||
    (published.warningInfo?.warnings?.length ?? 0) > 0
  ) {
    throw new Error(
      "Expected publication result was not confirmed; inspect the dashboard. No retry or alternative publication will be attempted.",
    );
  }
  const outcome = {
    PENDING_REVIEW: "submitted for review; distribution may begin after approval",
    STAGED: "staged; not yet available to install",
    PUBLISHED: "reported PUBLISHED by the API",
  }[published.state];
  log(
    `Version ${metadata.version}: ${outcome}. Verify UNLISTED visibility and link installation in the dashboard; API state does not prove visibility.`,
  );
}

async function main() {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.CWS_PUBLISH_UNLISTED !== "true"
  ) {
    throw new Error(
      "UNLISTED submission requires the explicit protected main-branch workflow opt-in.",
    );
  }
  const config = configuration(process.env);
  const { metadata } = await loadVerifiedArtifact(process.env.GITHUB_SHA);
  await publishUnlisted({ config, metadata });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
