import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { artifactDir, sha256, validVersion } from "./package-extension.mjs";

const scope = "https://www.googleapis.com/auth/chromewebstore";
const api = "https://chromewebstore.googleapis.com";

function requireValue(env, name) {
  if (!env[name]?.trim())
    throw new Error(`Missing ${name}; configure the protected release environment.`);
  return env[name];
}

export function configuration(env) {
  if (env.CWS_UNLISTED_VISIBILITY_CONFIRMED !== "true") {
    throw new Error(
      "Confirm saved UNLISTED visibility in the dashboard before uploading. The API cannot verify this owner acknowledgment.",
    );
  }
  const publisher = requireValue(env, "CWS_PUBLISHER_ID");
  const item = requireValue(env, "CWS_EXTENSION_ID");
  if (!/^[a-zA-Z0-9_-]+$/.test(publisher) || !/^[a-p]{32}$/.test(item)) {
    throw new Error("Invalid publisher or extension ID.");
  }
  return {
    name: `publishers/${publisher}/items/${item}`,
    unlistedVisibilityConfirmed: true,
    clientId: requireValue(env, "CWS_CLIENT_ID"),
    clientSecret: requireValue(env, "CWS_CLIENT_SECRET"),
    refreshToken: requireValue(env, "CWS_REFRESH_TOKEN"),
  };
}

export function verifyArtifact(metadata, bytes, sums, expectedCommit) {
  if (
    !validVersion(metadata.version) ||
    metadata.archive !== `ambra-${metadata.version}.zip` ||
    !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
    metadata.sha256 !== sha256(bytes) ||
    sums !== `${metadata.sha256}  ${metadata.archive}\n` ||
    metadata.publication !== "UNLISTED" ||
    metadata.dirty !== false ||
    !/^[a-f0-9]{40}$/.test(metadata.commit) ||
    metadata.commit !== expectedCommit ||
    bytes.length < 4 ||
    bytes.readUInt32LE(0) !== 0x04034b50
  ) {
    throw new Error(
      "Release artifact integrity/provenance check failed; rebuild from a clean approved commit.",
    );
  }
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function checkStatus(status, version, expectedName) {
  if (
    status.name !== expectedName ||
    status.takenDown ||
    status.warned ||
    status.lastAsyncUploadState === "IN_PROGRESS"
  ) {
    throw new Error("Store item cannot safely accept this draft; inspect its dashboard.");
  }
  const published = status.publishedItemRevisionStatus;
  const submitted = status.submittedItemRevisionStatus;
  // PUBLISHED covers unlisted as well as public items; it is not visibility proof.
  // A tester-only item must first migrate to UNLISTED manually in the dashboard.
  if (published && published.state !== "PUBLISHED") {
    throw new Error(
      "Unexpected published item state; establish UNLISTED visibility in the dashboard.",
    );
  }
  if (submitted && !["REJECTED", "CANCELLED"].includes(submitted.state)) {
    throw new Error("An existing submission needs manual resolution before another upload.");
  }
  for (const revision of [published, submitted]) {
    for (const channel of revision?.distributionChannels ?? []) {
      if (!validVersion(channel.crxVersion) || compareVersions(version, channel.crxVersion) <= 0) {
        throw new Error("Increase the manifest version beyond every existing store revision.");
      }
    }
  }
}

export async function createStoreClient(config, fetchImpl = fetch) {
  async function request(url, options, stage) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error(
        `${stage} request failed or timed out; inspect the dashboard before retrying.`,
      );
    }
    // Never print Google's response body: auth errors can include credential data.
    if (!response.ok)
      throw new Error(
        `${stage} failed (HTTP ${response.status}); inspect the dashboard/OAuth setup.`,
      );
    try {
      return await response.json();
    } catch {
      throw new Error(`${stage} returned an invalid response.`);
    }
  }
  const token = await request(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }),
    },
    "OAuth",
  );
  if (
    typeof token.access_token !== "string" ||
    !token.access_token ||
    (token.scope && !token.scope.split(" ").includes(scope))
  ) {
    throw new Error("OAuth did not grant a Chrome Web Store access token.");
  }
  const headers = { Authorization: `Bearer ${token.access_token}` };
  return (url, options, stage) =>
    request(url, { ...options, headers: { ...options?.headers, ...headers } }, stage);
}

export async function uploadDraft({
  config,
  metadata,
  bytes,
  fetchImpl = fetch,
  wait = delay,
  log = console.log,
}) {
  const request = await createStoreClient(config, fetchImpl);
  const statusUrl = `${api}/v2/${config.name}:fetchStatus`;
  const before = await request(statusUrl, {}, "Store preflight");
  checkStatus(before, metadata.version, config.name);
  const uploaded = await request(
    `${api}/upload/v2/${config.name}:upload`,
    {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: bytes,
    },
    "Draft upload",
  );
  if (
    uploaded.name !== config.name ||
    (uploaded.crxVersion && uploaded.crxVersion !== metadata.version)
  ) {
    throw new Error("Unexpected upload identity/version; inspect the dashboard.");
  }
  let state = uploaded.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < 30; attempt++) {
    await wait(10_000);
    const status = await request(statusUrl, {}, "Upload status");
    if (status.name !== config.name) throw new Error("Unexpected upload status identity.");
    state = status.lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") {
    throw new Error("Draft upload did not reach SUCCEEDED; inspect the dashboard before retrying.");
  }
  log(
    `Draft upload succeeded for version ${metadata.version}. Nothing was submitted or published.`,
  );
  log(
    "Verify saved UNLISTED visibility in the Developer Dashboard before submitting for review; API state does not prove visibility.",
  );
}

export async function loadVerifiedArtifact(expectedCommit) {
  const metadata = JSON.parse(await readFile(path.join(artifactDir, "release.json"), "utf8"));
  if (!validVersion(metadata.version) || metadata.archive !== `ambra-${metadata.version}.zip`) {
    throw new Error("Invalid release archive name.");
  }
  const bytes = await readFile(path.join(artifactDir, metadata.archive));
  const sums = await readFile(path.join(artifactDir, "SHA256SUMS"), "utf8");
  verifyArtifact(metadata, bytes, sums, expectedCommit);
  return { metadata, bytes };
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error("This command accepts no arguments and cannot publish.");
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Run draft uploads only through the protected main-branch release workflow.");
  }
  const config = configuration(process.env);
  const { metadata, bytes } = await loadVerifiedArtifact(process.env.GITHUB_SHA);
  await uploadDraft({ config, metadata, bytes });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
