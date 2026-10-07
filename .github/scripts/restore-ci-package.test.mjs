import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "./package-extension.mjs";
import { verifyArchivePaths, verifyPackageIdentity } from "./restore-ci-package.mjs";

const bytes = Buffer.from("PK\x03\x04original CI archive");
const commit = "a".repeat(40);
const digest = sha256(bytes);
const release = {
  version: "2.2.0", archive: "ambra-2.2.0.zip", commit, dirty: false,
  sha256: digest, publication: "PUBLIC",
};
const sums = `${digest}  ${release.archive}\n`;

test("CI consumers require the exact clean package commit, producer digest and release checksums", () => {
  verifyPackageIdentity(release, bytes, commit, digest, sums);
  for (const changed of [
    { commit: "b".repeat(40) }, { dirty: true }, { archive: "../outside.zip" },
    { sha256: "0".repeat(64) }, { version: "2.3.0" }, { publication: "UNLISTED" },
  ]) {
    assert.throws(() => verifyPackageIdentity({ ...release, ...changed }, bytes, commit, digest, sums));
  }
  assert.throws(() => verifyPackageIdentity(release, bytes, commit, digest, "wrong sums"));
  assert.throws(() => verifyPackageIdentity(release, Buffer.from("changed"), commit, digest, sums));
  assert.throws(() => verifyPackageIdentity(release, bytes, commit, "", sums));
  assert.throws(() => verifyPackageIdentity(release, bytes, "", digest, sums));
});

test("archive listing rejects traversal, absolute paths, duplicate and hidden entries before extraction", () => {
  verifyArchivePaths(["manifest.json", "assets/reader.js", "src/reader/index.html", "THIRD_PARTY_NOTICES.md"]);
  for (const names of [
    [], ["../outside"], ["/absolute"], ["assets/../outside"], ["assets/.hidden"],
    ["manifest.json", "manifest.json"], ["assets//reader.js"], ["bad\nname"], ["assets/"],
  ]) assert.throws(() => verifyArchivePaths(names));
});
