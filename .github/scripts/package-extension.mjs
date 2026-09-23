import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeNotices } from "./package-notices.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const releaseDir = path.join(root, "dist/private-release");
export const artifactDir = path.join(releaseDir, "artifacts");

export function validVersion(version) {
  return (
    typeof version === "string" &&
    /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version) &&
    version.split(".").every((part) => Number(part) <= 65535) &&
    version.split(".").some((part) => Number(part) > 0)
  );
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed.`);
  return result.stdout;
}

export async function validateBundle(directory, sourceManifest) {
  const files = [];
  async function walk(relative = "") {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlinks are forbidden in store packages.");
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) {
        if (
          !/^[a-zA-Z0-9_./-]+$/.test(name) ||
          (!/\.(js|json|html|css|png|svg|jpg|jpeg|gif|webp|woff2?|ttf|otf)$/.test(name) &&
            !["LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"].includes(name)) ||
          name.split("/").some((part) => part.startsWith("."))
        ) {
          throw new Error(`Unexpected package file: ${name}`);
        }
        files.push(name);
      } else throw new Error("Non-regular package file.");
    }
  }
  await walk();
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (
    manifest.manifest_version !== 3 ||
    !validVersion(manifest.version) ||
    manifest.version !== sourceManifest.version
  )
    throw new Error("Invalid release manifest version.");
  if (manifest.key || manifest.update_url)
    throw new Error("Store package must not set key or update_url.");
  for (const permission of [
    "permissions",
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
  ]) {
    if (JSON.stringify(manifest[permission]) !== JSON.stringify(sourceManifest[permission])) {
      throw new Error(`Unexpected production ${permission}.`);
    }
  }
  const required = [
    "manifest.json",
    "src/reader/index.html",
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
  if (required.some((file) => typeof file !== "string" || !files.includes(file))) {
    throw new Error("Missing extension entry point or icon.");
  }
  for (const file of files.filter((name) => /\.(js|html|json)$/.test(name))) {
    const text = await readFile(path.join(directory, file), "utf8");
    if (
      /@vite\/client|@react-refresh|__vite_plugin_react_preamble_installed__|localhost:5173|127\.0\.0\.1:5173/.test(
        text,
      )
    ) {
      throw new Error(`Development-server code found in ${file}.`);
    }
  }
  return { manifest, files: files.sort() };
}

export async function packageExtension() {
  // Reject redirected ancestors before Vite's --emptyOutDir can remove anything.
  for (const name of [
    "dist",
    "dist/private-release",
    "dist/private-release/extension",
    "dist/private-release/artifacts",
  ]) {
    const candidate = path.join(root, name);
    try {
      if (!(await lstat(candidate)).isDirectory() || (await realpath(candidate)) !== candidate) {
        throw new Error("Release output must use real, project-local directories.");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await mkdir(releaseDir, { recursive: true });
  await rm(artifactDir, { recursive: true, force: true });
  const buildDir = path.join(releaseDir, "extension");
  run("pnpm", [
    "--filter",
    "@ambra/extension",
    "exec",
    "vite",
    "build",
    "--outDir",
    buildDir,
    "--emptyOutDir",
  ]);
  await writeNotices(root, buildDir);
  const sourceManifest = JSON.parse(
    await readFile(path.join(root, "apps/extension/manifest.json"), "utf8"),
  );
  const { manifest, files } = await validateBundle(buildDir, sourceManifest);
  await mkdir(artifactDir);
  const archive = `ambra-${manifest.version}.zip`;
  run("zip", ["-X", "-q", path.join(artifactDir, archive), "-@"], {
    cwd: buildDir,
    input: `${files.join("\n")}\n`,
    stdio: ["pipe", "inherit", "inherit"],
  });
  run("unzip", ["-tq", path.join(artifactDir, archive)]);
  const digest = sha256(await readFile(path.join(artifactDir, archive)));
  const commit = run("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  const dirty =
    run("git", ["status", "--porcelain", "--untracked-files=normal"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim().length > 0;
  await writeFile(path.join(artifactDir, "SHA256SUMS"), `${digest}  ${archive}\n`);
  await writeFile(
    path.join(artifactDir, "release.json"),
    `${JSON.stringify(
      {
        archive,
        sha256: digest,
        version: manifest.version,
        commit,
        dirty,
        createdAt: new Date().toISOString(),
        publication: "TRUSTED_TESTERS_ONLY",
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Validated ${archive}; SHA-256 ${digest}. Output: ${artifactDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageExtension().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
