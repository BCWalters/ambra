import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { root, sha256, validVersion, validateBundle } from "./package-extension.mjs";
import { dependencyNotices } from "./package-notices.mjs";
import { publishUnlisted } from "./publish-unlisted.mjs";
import { checkStatus, configuration, uploadDraft, verifyArtifact } from "./upload-draft.mjs";
import {
  captureOutputDirectory,
  promoteCapture,
} from "../../store-assets/scripts/generate-images.mjs";

const name = `publishers/example/items/${"a".repeat(32)}`;
const config = {
  name,
  unlistedVisibilityConfirmed: true,
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
};
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

test("release screenshots stay separate from tracked previews and package metadata", async () => {
  const directory = path.join(root, "dist", `store-capture-tests-${process.pid}`);
  const capture = path.join(directory, "capture");
  const image = "screenshot-reader-1280x800.png";
  await mkdir(capture, { recursive: true });
  try {
    const preview = await captureOutputDirectory(false, directory);
    const output = await captureOutputDirectory(true, directory);
    assert.equal(output, path.join(directory, "dist/beta-release/artifacts/store-assets"));
    await writeFile(path.join(preview, image), "tracked preview");
    for (const name of ["ambra-0.0.1.zip", "SHA256SUMS", "release.json"]) {
      await writeFile(path.join(path.dirname(output), name), `original ${name}`);
    }
    await writeFile(path.join(capture, image), "verified release image");
    assert.equal(await promoteCapture(capture, true, directory), output);
    assert.equal(await readFile(path.join(output, image), "utf8"), "verified release image");
    assert.equal(await readFile(path.join(preview, image), "utf8"), "tracked preview");
    for (const name of ["ambra-0.0.1.zip", "SHA256SUMS", "release.json"]) {
      assert.equal(
        await readFile(path.join(path.dirname(output), name), "utf8"),
        `original ${name}`,
      );
      await writeFile(path.join(capture, name), "must not be promoted");
      await assert.rejects(
        promoteCapture(capture, true, directory),
        /package metadata is protected/,
      );
      await rm(path.join(capture, name));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store capture rejects redirected output and requires explicit browser permission", async () => {
  const directory = path.join(root, "dist", `store-capture-guards-${process.pid}`);
  const capture = path.join(directory, "capture");
  const image = "screenshot-reader-1280x800.png";
  await mkdir(capture, { recursive: true });
  try {
    const output = await captureOutputDirectory(true, directory);
    const original = path.join(directory, "original");
    await writeFile(original, "untouched");
    await writeFile(path.join(capture, image), "new image");
    await symlink(original, path.join(output, image));
    await assert.rejects(
      promoteCapture(capture, true, directory),
      /redirected capture output file/,
    );
    assert.equal(await readFile(original, "utf8"), "untouched");
    await rm(path.join(directory, "dist"), { recursive: true });
    const external = path.join(directory, "external");
    await mkdir(external);
    await symlink(external, path.join(directory, "dist"), "dir");
    await assert.rejects(captureOutputDirectory(true, directory), /not symlinks/);

    const denied = spawnSync(process.execPath, ["store-assets/scripts/generate-images.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AMBRA_STORE_ALLOW_BROWSER: "0" },
    });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Browser capture is gated/);
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

test("unlisted publication uses v2 saved visibility, review, and blocking warnings", async () => {
  const itemId = "a".repeat(32);
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { name, itemId, state: "PENDING_REVIEW" },
  ]);
  const messages = [];
  await publishUnlisted({
    config,
    metadata,
    fetchImpl,
    log: (message) => messages.push(message),
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, `https://chromewebstore.googleapis.com/v2/${name}:publish`);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  });
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.redirect, "error");
  assert.ok(messages[0].includes("cannot verify UNLISTED"));
  assert.ok(messages[1].includes("submitted for review"));
  assert.ok(!messages.join("\n").includes(token.access_token));
});

test("unlisted acknowledgment is required before any authentication or publication", async () => {
  for (const confirmation of [undefined, false, "true"]) {
    const { fetchImpl, calls } = mockFetch([]);
    await assert.rejects(
      publishUnlisted({
        config: { ...config, unlistedVisibilityConfirmed: confirmation },
        metadata,
        fetchImpl,
      }),
      /owner acknowledgment/,
    );
    assert.equal(calls.length, 0);
  }
});

test("publication rejects wrong identity, warnings, and unexpected states without retry or fallback", async () => {
  for (const published of [
    { name, itemId: "b".repeat(32), state: "PENDING_REVIEW" },
    { name: "wrong", itemId: "a".repeat(32), state: "PENDING_REVIEW" },
    {
      name,
      itemId: "a".repeat(32),
      state: "PUBLISHED",
      warningInfo: { warnings: [{ description: "warning" }] },
    },
    ...[
      "REJECTED",
      "CANCELLED",
      "PUBLISHED_TO_TESTERS",
      "ITEM_STATE_UNSPECIFIED",
      "UNKNOWN",
      undefined,
    ].map((state) => ({ name, itemId: "a".repeat(32), state })),
  ]) {
    const { fetchImpl, calls } = mockFetch([token, { name }, published]);
    await assert.rejects(
      publishUnlisted({
        config,
        metadata,
        fetchImpl,
        log: () => {},
      }),
      /not confirmed/,
    );
    assert.equal(calls.length, 3);
  }
});

test("publication HTTP failures are redacted and never retried", async () => {
  const setup = mockFetch([token, { name }]);
  let attempts = 0;
  await assert.rejects(
    publishUnlisted({
      config,
      metadata,
      log: () => {},
      fetchImpl: async (url, options) => {
        if (!url.endsWith(":publish")) return setup.fetchImpl(url, options);
        attempts++;
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: token.access_token }),
        };
      },
    }),
    (error) => error.message.includes("HTTP 400") && !error.message.includes(token.access_token),
  );
  assert.equal(attempts, 1);
  assert.equal(setup.calls.length, 2);
});

test("PUBLISHED is accepted for unlisted items but never presented as proof of visibility", async () => {
  for (const state of ["PENDING_REVIEW", "STAGED", "PUBLISHED"]) {
    const { fetchImpl, calls } = mockFetch([
      token,
      {
        name,
        publishedItemRevisionStatus: {
          state: "PUBLISHED",
          distributionChannels: [{ crxVersion: "0.0.1" }],
        },
      },
      { name, itemId: "a".repeat(32), state },
    ]);
    const messages = [];
    await publishUnlisted({
      config,
      metadata,
      fetchImpl,
      log: (message) => messages.push(message),
    });
    assert.equal(calls.length, 3);
    assert.ok(messages.at(-1).includes("API state does not prove visibility"));
    if (state === "STAGED") assert.ok(messages.at(-1).includes("not yet available"));
    if (state === "PUBLISHED") assert.ok(messages.at(-1).includes("reported PUBLISHED"));
  }
});

test("active or tester-only revisions block submission before the irreversible request", async () => {
  for (const status of [
    { name, publishedItemRevisionStatus: { state: "PUBLISHED_TO_TESTERS" } },
    { name, submittedItemRevisionStatus: { state: "PENDING_REVIEW" } },
    { name, submittedItemRevisionStatus: { state: "STAGED" } },
  ]) {
    const { fetchImpl, calls } = mockFetch([token, status]);
    await assert.rejects(publishUnlisted({ config, metadata, fetchImpl, log: () => {} }));
    assert.equal(calls.length, 2);
  }
});

test("workflow defaults are package-only and guard enforces main plus same-run upload", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/beta-release.yml"), "utf8");
  assert.equal((workflow.match(/default: false/g) ?? []).length, 2);
  assert.ok(workflow.includes("environment: chrome-web-store"));
  const guard = workflow.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1];
  assert.ok(guard);
  for (const [upload, publish, ref, expected] of [
    ["false", "false", "refs/heads/topic", 0],
    ["false", "true", "refs/heads/main", 1],
    ["true", "false", "refs/heads/topic", 1],
    ["true", "true", "refs/heads/topic", 1],
    ["true", "false", "refs/heads/main", 0],
    ["true", "true", "refs/heads/main", 0],
  ]) {
    const result = spawnSync("bash", ["-c", guard], {
      env: { ...process.env, UPLOAD_DRAFT: upload, PUBLISH_UNLISTED: publish, GITHUB_REF: ref },
      encoding: "utf8",
    });
    assert.equal(result.status, expected, result.stdout + result.stderr);
  }
});

test("publisher CLI refuses local or missing explicit publication opt-in without contacting the store", () => {
  for (const [actions, ref, optIn] of [
    ["false", "refs/heads/main", "true"],
    ["true", "refs/heads/topic", "true"],
    ["true", "refs/heads/main", "false"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, ".github/scripts/publish-unlisted.mjs")],
      {
        env: {
          ...process.env,
          GITHUB_ACTIONS: actions,
          GITHUB_REF: ref,
          CWS_PUBLISH_UNLISTED: optIn,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit protected main-branch workflow opt-in/);
  }
});

test("Chrome versions reject zero, leading zeroes, overflow, and nonnumeric versions", () => {
  for (const version of ["0.0.1", "1", "1.2.3.4", "65535.0"]) assert.ok(validVersion(version));
  for (const version of ["0", "0.0.0", "01.2", "1.2.3.4.5", "65536", "1-beta", "../x", undefined]) {
    assert.equal(validVersion(version), false);
  }
});

test("configuration fails closed without UNLISTED confirmation or credentials", () => {
  assert.throws(() => configuration({}), /UNLISTED/);
  assert.throws(() => configuration({ CWS_PRIVATE_VISIBILITY_CONFIRMED: "true" }), /UNLISTED/);
  assert.throws(
    () => configuration({ CWS_UNLISTED_VISIBILITY_CONFIRMED: "true" }),
    /CWS_PUBLISHER_ID/,
  );
  assert.throws(
    () =>
      configuration({
        CWS_UNLISTED_VISIBILITY_CONFIRMED: "true",
        CWS_PUBLISHER_ID: "../other",
        CWS_EXTENSION_ID: "a".repeat(32),
      }),
    /Invalid/,
  );
  assert.deepEqual(
    configuration({
      CWS_UNLISTED_VISIBILITY_CONFIRMED: "true",
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
    publication: "UNLISTED",
  };
  const sums = `${release.sha256}  ${release.archive}\n`;
  verifyArtifact(release, bytes, sums, release.commit);
  for (const change of [
    { dirty: true },
    { archive: "../secret.zip" },
    { commit: "b".repeat(40) },
    { publication: "PUBLIC" },
    { publication: "TRUSTED_TESTERS_ONLY" },
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

test("store preflight allows PUBLISHED but rejects unknown, tester-only, active submissions, and old versions", () => {
  checkStatus({ name }, "0.0.2", name);
  checkStatus(
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED",
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
    { name, publishedItemRevisionStatus: { state: "PUBLISHED_TO_TESTERS" } },
    { name, publishedItemRevisionStatus: { state: "UNKNOWN" } },
    { name, submittedItemRevisionStatus: { state: "PENDING_REVIEW" } },
    { name, submittedItemRevisionStatus: { state: "STAGED" } },
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED",
        distributionChannels: [{ crxVersion: "0.0.2.0" }],
      },
    },
    {
      name,
      publishedItemRevisionStatus: {
        state: "PUBLISHED",
        distributionChannels: [{ crxVersion: "1.0" }],
      },
    },
  ])
    assert.throws(() => checkStatus(status, "0.0.2", name));
});

test("upload makes only token, read-status, and draft-upload requests; never publishes", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name, publishedItemRevisionStatus: { state: "PUBLISHED" } },
    { name, uploadState: "SUCCEEDED", crxVersion: "0.0.2" },
  ]);
  const messages = [];
  await uploadDraft({
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
  await uploadDraft({
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

test("tester-only items require a manual visibility migration before any upload", async () => {
  const { fetchImpl, calls } = mockFetch([
    token,
    { name, publishedItemRevisionStatus: { state: "PUBLISHED_TO_TESTERS" } },
  ]);
  await assert.rejects(uploadDraft({ config, metadata, bytes, fetchImpl }), /establish UNLISTED/);
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
    await assert.rejects(uploadDraft({ config, metadata, bytes, fetchImpl }));
  }
  const { fetchImpl, calls } = mockFetch([
    token,
    { name },
    { name, uploadState: "IN_PROGRESS" },
    ...Array.from({ length: 30 }, () => ({ name, lastAsyncUploadState: "IN_PROGRESS" })),
  ]);
  await assert.rejects(
    uploadDraft({ config, metadata, bytes, fetchImpl, wait: async () => {} }),
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
      uploadDraft({ config, metadata, bytes, fetchImpl }),
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
