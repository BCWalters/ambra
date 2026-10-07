import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256, validateBundle } from "./package-extension.mjs";
import { verifyArtifact } from "./upload-draft.mjs";

export function verifyPackageIdentity(release, bytes, expectedCommit, expectedDigest, sums) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error("Expected package commit and digest are required.");
  }
  if (!release || release.sha256 !== expectedDigest || sha256(bytes) !== expectedDigest) {
    throw new Error("Downloaded package does not match the clean build and archive digest.");
  }
  verifyArtifact(release, bytes, sums, expectedCommit, "PUBLIC");
}

export function verifyArchivePaths(names) {
  if (!names.length || new Set(names).size !== names.length || names.some(name =>
    !/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith("/") ||
    name.split("/").some(part => !part || part.startsWith(".")))) {
    throw new Error("CI package has invalid or duplicate archive paths.");
  }
}

async function restorePackage() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const artifacts = path.join(root, "dist/beta-release/artifacts");
  const release = JSON.parse(await readFile(path.join(artifacts, "release.json"), "utf8"));
  if (!/^ambra-\d+(?:\.\d+){0,3}\.zip$/.test(release.archive)) {
    throw new Error("Invalid CI package archive name.");
  }
  const archive = path.join(artifacts, release.archive);
  const bytes = await readFile(archive);
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (checkout.error) throw checkout.error;
  if (checkout.status !== 0 || checkout.stdout.trim() !== process.env.CI_PACKAGE_COMMIT) {
    throw new Error("Downloaded package was not built from this checkout.");
  }
  const sums = await readFile(path.join(artifacts, "SHA256SUMS"), "utf8");
  verifyPackageIdentity(release, bytes, process.env.CI_PACKAGE_COMMIT, process.env.CI_PACKAGE_SHA256, sums);
  const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  if (listing.error) throw listing.error;
  if (listing.status !== 0) throw new Error("Could not inspect downloaded CI package.");
  verifyArchivePaths(listing.stdout.trimEnd().split("\n"));
  const directory = path.join(root, "dist/beta-release/extension");
  await mkdir(directory);
  const extraction = spawnSync("unzip", ["-q", archive, "-d", directory], { stdio: "inherit" });
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) throw new Error("Could not extract downloaded CI package.");
  const sourceManifest = JSON.parse(await readFile(path.join(root, "apps/extension/manifest.json"), "utf8"));
  await validateBundle(directory, sourceManifest);
  console.log(`Verified and restored ${release.archive}; commit ${release.commit}; SHA-256 ${release.sha256}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await restorePackage();
}
