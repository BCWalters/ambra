import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root, sha256, validVersion, validateBundle } from "./package-extension.mjs";
import { dependencyNotices } from "./package-notices.mjs";
import {
  publishTrustedTesters,
  requireSupportedPublication,
  v1Sunset,
} from "./publish-trusted-testers.mjs";
import {
  checkStatus,
  configuration,
  uploadPrivateDraft,
  verifyArtifact,
} from "./upload-private-draft.mjs";

const name = `publishers/example/items/${"a".repeat(32)}`;
const config = { name, clientId: "client", clientSecret: "secret", refreshToken: "refresh" };
const metadata = { version: "0.0.2" };
const token = { access_token: "sensitive-access-token" };
const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

test("dependency notices include installed texts and pinned overrides, failing closed on omissions", async () => {
  const directory = path.join(root, "dist", `release-notices-tests-${process.pid}`);
  const dependencyPath = path.join(directory, "node_modules/example");
  const overridePath = path.join(directory, "store-assets/licenses");
  const license = "Complete test license text.\n".repeat(8);
  const notice = "Complete test copyright notice.\n".repeat(8);
  const inventory = { MIT: [{ name: "example", license: "MIT", paths: [dependencyPath] }] };
  await mkdir(dependencyPath, { recursive: true });
  await mkdir(overridePath, { recursive: true });
  try {
    await writeFile(
      path.join(dependencyPath, "package.json"),
      JSON.stringify({ name: "example", version: "1.0.0" }),
    );
    await writeFile(path.join(dependencyPath, "LICENSE"), license);
    await writeFile(path.join(dependencyPath, "NOTICE"), notice);
    const bundled = await dependencyNotices(directory, inventory, {});
    assert.ok(bundled.includes("example@1.0.0"));
    assert.ok(bundled.includes(license.trim()));
    assert.ok(bundled.includes(notice.trim()));
    await rm(path.join(dependencyPath, "LICENSE"));
    await assert.rejects(dependencyNotices(directory, inventory, {}), /Missing installed license/);
    await assert.rejects(
      dependencyNotices(directory, inventory, { "example@1.0.0": "../secret.txt" }),
      /Missing installed license/,
    );
    await writeFile(path.join(overridePath, "example-1.0.0-LICENSE.txt"), license);
    assert.ok(
      (
        await dependencyNotices(directory, inventory, {
          "example@1.0.0": "example-1.0.0-LICENSE.txt",
        })
      ).includes(license.trim()),
    );
    await assert.rejects(dependencyNotices(directory, {}, {}), /No installed/);
    await assert.rejects(
      dependencyNotices(directory, { GPL: [{ ...inventory.MIT[0], license: "GPL-3.0" }] }, {}),
      /Review the new/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function mockFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.ok(responses.length, "No unexpected network calls");
      const response = responses.shift();
      return { ok: true, json: async () => response };
    },
  };
}

test("trusted-tester submission hard-codes explicit v1 audience and never uses a public/v2 fallback", async () => {
  const itemId = "a".repeat(32);
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { kind: "chromewebstore#item", item_id: itemId, status: ["OK"] },
  ]);
  const messages = [];
  await publishTrustedTesters({
    config,
    metadata,
    fetchImpl,
    now: () => v1Sunset - 1,
    log: (message) => messages.push(message),
  });
  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].url,
    `https://www.googleapis.com/chromewebstore/v1.1/items/${itemId}/publish?publishTarget=trustedTesters`,
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    target: "trustedTesters",
    reviewExemption: false,
  });
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.redirect, "error");
  assert.ok(messages[0].includes("not a claim of completed publication"));
  assert.ok(!messages[0].includes(token.access_token));
});

test("sunset gate blocks publication before authentication and again immediately before submission", async () => {
  requireSupportedPublication(v1Sunset - 1);
  for (const now of [v1Sunset, v1Sunset + 1, NaN, Infinity]) {
    assert.throws(() => requireSupportedPublication(now), /disabled/);
    const { fetchImpl, calls } = mockFetch([]);
    await assert.rejects(
      publishTrustedTesters({ config, metadata, fetchImpl, now: () => now }),
      /disabled/,
    );
    assert.equal(calls.length, 0);
  }
  const { fetchImpl, calls } = mockFetch([token, { name }]);
  const times = [v1Sunset - 1, v1Sunset];
  await assert.rejects(
    publishTrustedTesters({
      config,
      metadata,
      fetchImpl,
      now: () => times.shift(),
    }),
    /disabled/,
  );
  assert.equal(calls.length, 2);
});

test("publication rejects wrong identity, empty or mixed statuses and does not retry or fall back", async () => {
  for (const published of [
    { kind: "chromewebstore#item", item_id: "a".repeat(32), status: [] },
    { kind: "chromewebstore#item", item_id: "a".repeat(32), status: ["OK", "NOT_AUTHORIZED"] },
    { kind: "chromewebstore#item", item_id: "a".repeat(32), status: ["ITEM_PENDING_REVIEW"] },
    { kind: "chromewebstore#item", item_id: "b".repeat(32), status: ["OK"] },
  ]) {
    const { fetchImpl, calls } = mockFetch([token, { name }, published]);
    await assert.rejects(
      publishTrustedTesters({
        config,
        metadata,
        fetchImpl,
        now: () => v1Sunset - 1,
      }),
      /not confirmed/,
    );
    assert.equal(calls.length, 3);
  }
});

test("publication refuses public items before the irreversible request", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name, publishedItemRevisionStatus: { state: "PUBLISHED" } },
  ]);
  await assert.rejects(
    publishTrustedTesters({
      config,
      metadata,
      fetchImpl,
      now: () => v1Sunset - 1,
    }),
    /exclusively to testers/,
  );
  assert.equal(calls.length, 2);
});

test("Chrome versions reject zero, leading zeroes, overflow, and nonnumeric versions", () => {
  for (const version of ["0.0.1", "1", "1.2.3.4", "65535.0"]) assert.ok(validVersion(version));
  for (const version of ["0", "0.0.0", "01.2", "1.2.3.4.5", "65536", "1-beta", "../x", undefined]) {
    assert.equal(validVersion(version), false);
  }
});

test("configuration fails closed without PRIVATE confirmation or credentials", () => {
  assert.throws(() => configuration({}), /PRIVATE/);
  assert.throws(
    () => configuration({ CWS_PRIVATE_VISIBILITY_CONFIRMED: "true" }),
    /CWS_PUBLISHER_ID/,
  );
  assert.throws(
    () =>
      configuration({
        CWS_PRIVATE_VISIBILITY_CONFIRMED: "true",
        CWS_PUBLISHER_ID: "../other",
        CWS_EXTENSION_ID: "a".repeat(32),
      }),
    /Invalid/,
  );
  assert.deepEqual(
    configuration({
      CWS_PRIVATE_VISIBILITY_CONFIRMED: "true",
      CWS_PUBLISHER_ID: "example",
      CWS_EXTENSION_ID: "a".repeat(32),
      CWS_CLIENT_ID: "client",
      CWS_CLIENT_SECRET: "secret",
      CWS_REFRESH_TOKEN: "refresh",
    }),
    config,
  );
});

test("artifact validation binds hash, clean source commit, ZIP, and release metadata", () => {
  const release = {
    version: "0.0.2",
    archive: "ambra-0.0.2.zip",
    sha256: sha256(bytes),
    commit: "a".repeat(40),
    dirty: false,
    publication: "TRUSTED_TESTERS_ONLY",
  };
  const sums = `${release.sha256}  ${release.archive}\n`;
  verifyArtifact(release, bytes, sums, release.commit);
  for (const change of [
    { dirty: true },
    { archive: "../secret.zip" },
    { commit: "b".repeat(40) },
    { publication: "PUBLIC" },
    { sha256: "0".repeat(64) },
    { version: "0" },
  ]) {
    assert.throws(
      () => verifyArtifact({ ...release, ...change }, bytes, sums, release.commit),
      /integrity/,
    );
  }
  assert.throws(
    () => verifyArtifact(release, Buffer.from("tampered"), sums, release.commit),
    /integrity/,
  );
  assert.throws(() => verifyArtifact(release, bytes, "wrong", release.commit), /integrity/);
});

test("store preflight rejects public, unknown, active submissions, and non-increasing versions", () => {
  checkStatus({ name }, "0.0.2", name);
  checkStatus(
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED_TO_TESTERS",
        distributionChannels: [{ crxVersion: "0.0.1" }],
      },
    },
    "0.0.2",
    name,
  );
  for (const status of [
    { name: "wrong" },
    { name, takenDown: true },
    { name, warned: true },
    { name, lastAsyncUploadState: "IN_PROGRESS" },
    { name, publishedItemRevisionStatus: { state: "PUBLISHED" } },
    { name, publishedItemRevisionStatus: { state: "UNKNOWN" } },
    { name, submittedItemRevisionStatus: { state: "PENDING_REVIEW" } },
    { name, submittedItemRevisionStatus: { state: "STAGED" } },
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED_TO_TESTERS",
        distributionChannels: [{ crxVersion: "0.0.2.0" }],
      },
    },
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED_TO_TESTERS",
        distributionChannels: [{ crxVersion: "1.0" }],
      },
    },
  ])
    assert.throws(() => checkStatus(status, "0.0.2", name));
});

test("upload makes only token, read-status, and draft-upload requests; never publishes", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { name, uploadState: "SUCCEEDED", crxVersion: "0.0.2" },
  ]);
  const messages = [];
  await uploadPrivateDraft({
    config,
    metadata,
    bytes,
    fetchImpl,
    log: (message) => messages.push(message),
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].options.body.get("refresh_token"), "refresh");
  assert.equal(calls[1].url, `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`);
  assert.equal(calls[2].url, `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`);
  assert.equal(calls[2].options.headers["Content-Type"], "application/zip");
  assert.equal(calls[2].options.body, bytes);
  assert.ok(calls.every((call) => call.options.redirect === "error"));
  assert.ok(messages.join("\n").includes("Nothing was submitted or published"));
  assert.ok(!messages.join("\n").includes(token.access_token));
});

test("asynchronous upload polls until success", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { name, uploadState: "IN_PROGRESS" },
    { name, lastAsyncUploadState: "IN_PROGRESS" },
    { name, lastAsyncUploadState: "SUCCEEDED" },
  ]);
  let waits = 0;
  await uploadPrivateDraft({
    config,
    metadata,
    bytes,
    fetchImpl,
    wait: async () => {
      waits++;
    },
    log: () => {},
  });
  assert.equal(waits, 2);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter((call) => call.url.endsWith(":upload")).length, 1);
});

test("public items are rejected before any upload", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name, publishedItemRevisionStatus: { state: "PUBLISHED" } },
  ]);
  await assert.rejects(
    uploadPrivateDraft({ config, metadata, bytes, fetchImpl }),
    /exclusively to testers/,
  );
  assert.equal(calls.length, 2);
});

test("unknown, failed, mismatched, and indefinitely pending uploads fail closed", async () => {
  for (const uploaded of [
    { name, uploadState: "FAILED" },
    { name, uploadState: "UNKNOWN" },
    { name: "wrong", uploadState: "SUCCEEDED" },
    { name, uploadState: "SUCCEEDED", crxVersion: "9" },
  ]) {
    const { fetchImpl } = mockFetch([token, { name }, uploaded]);
    await assert.rejects(uploadPrivateDraft({ config, metadata, bytes, fetchImpl }));
  }
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { name, uploadState: "IN_PROGRESS" },
    ...Array.from({ length: 30 }, () => ({ name, lastAsyncUploadState: "IN_PROGRESS" })),
  ]);
  await assert.rejects(
    uploadPrivateDraft({ config, metadata, bytes, fetchImpl, wait: async () => {} }),
    /SUCCEEDED/,
  );
  assert.equal(calls.length, 33);
});

test("OAuth errors and network exceptions never disclose response bodies or secrets", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 401, json: async () => ({ error: config.clientSecret }) }),
    async () => {
      throw new Error(config.refreshToken);
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error(token.access_token);
      },
    }),
  ]) {
    await assert.rejects(
      uploadPrivateDraft({ config, metadata, bytes, fetchImpl }),
      (error) =>
        !error.message.includes(config.clientSecret) &&
        !error.message.includes(config.refreshToken) &&
        !error.message.includes(token.access_token),
    );
  }
});

test("bundle validation rejects development loaders, source maps, symlinks, and changed permissions", async () => {
  const directory = path.join(root, "dist", `release-tests-${process.pid}`);
  await mkdir(path.join(directory, "src/reader"), { recursive: true });
  const manifest = {
    manifest_version: 3,
    version: "0.0.2",
    permissions: ["downloads"],
    background: { service_worker: "worker.js" },
    action: { default_popup: "library.html", default_icon: {} },
    options_page: "library.html",
    icons: {},
  };
  try {
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(directory, "src/reader/index.html"), "<html></html>");
    await writeFile(path.join(directory, "library.html"), "<html></html>");
    await writeFile(path.join(directory, "worker.js"), "export {};");
    assert.equal((await validateBundle(directory, manifest)).files.length, 4);
    await writeFile(
      path.join(directory, "worker.js"),
      "import 'http://localhost:5173/@vite/client';",
    );
    await assert.rejects(validateBundle(directory, manifest), /Development/);
    await writeFile(path.join(directory, "worker.js"), "export {};");
    await writeFile(path.join(directory, "worker.js.map"), "{}");
    await assert.rejects(validateBundle(directory, manifest), /Unexpected/);
    await rm(path.join(directory, "worker.js.map"));
    await symlink("worker.js", path.join(directory, "linked.js"));
    await assert.rejects(validateBundle(directory, manifest), /Symlinks/);
    await rm(path.join(directory, "linked.js"));
    await assert.rejects(
      validateBundle(directory, { ...manifest, permissions: [] }),
      /permissions/,
    );
    await rm(path.join(directory, "library.html"));
    await assert.rejects(validateBundle(directory, manifest), /entry point/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
