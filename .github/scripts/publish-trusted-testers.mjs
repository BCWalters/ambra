import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkStatus,
  configuration,
  createStoreClient,
  loadVerifiedArtifact,
} from "./upload-private-draft.mjs";

export const v1Sunset = Date.parse("2026-10-15T00:00:00Z");

export function requireSupportedPublication(now = Date.now()) {
  if (!Number.isFinite(now) || now >= v1Sunset) {
    throw new Error(
      "Trusted-tester API publication is disabled from 2026-10-15 (v1 sunset). Use the PRIVATE dashboard flow; never fall back to v2/default publication.",
    );
  }
}

export async function publishTrustedTesters({
  config,
  metadata,
  fetchImpl = fetch,
  now = Date.now,
  log = console.log,
}) {
  requireSupportedPublication(now());
  const request = await createStoreClient(config, fetchImpl);
  const status = await request(
    `https://chromewebstore.googleapis.com/v2/${config.name}:fetchStatus`,
    {},
    "Publication preflight",
  );
  checkStatus(status, metadata.version, config.name);
  // Recheck immediately before the irreversible call, including runs across midnight.
  requireSupportedPublication(now());
  const itemId = config.name.split("/").at(-1);
  const published = await request(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish?publishTarget=trustedTesters`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "trustedTesters", reviewExemption: false }),
    },
    "Trusted-tester submission",
  );
  if (
    published.kind !== "chromewebstore#item" ||
    published.item_id !== itemId ||
    !Array.isArray(published.status) ||
    published.status.length === 0 ||
    published.status.some((value) => value !== "OK")
  ) {
    throw new Error(
      "Trusted-tester submission was not confirmed; inspect the dashboard. No alternative publication will be attempted.",
    );
  }
  log(
    `Version ${metadata.version} submitted explicitly to trusted testers. Review/availability must be confirmed in the dashboard; this is not a claim of completed publication.`,
  );
}

async function main() {
  if (
    process.argv.length !== 2 ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.CWS_PUBLISH_TRUSTED_TESTERS !== "true"
  ) {
    throw new Error(
      "Trusted-tester submission requires the explicit protected main-branch workflow opt-in.",
    );
  }
  requireSupportedPublication();
  const config = configuration(process.env);
  const { metadata } = await loadVerifiedArtifact(process.env.GITHUB_SHA);
  await publishTrustedTesters({ config, metadata });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
