#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yauzl from "yauzl";

export async function archiveProperties(file) {
  const bytes = readFileSync(file);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error(`Missing archive end record: ${file}`);
  const multiDisk = bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0;
  if (multiDisk) {
    const firstVolume = file.replace(/\.epub$/, ".z01");
    if (!existsSync(firstVolume) || readFileSync(firstVolume).readUInt32LE(0) !== 0x08074b50)
      throw new Error("Missing first segmented ZIP volume.");
    if (bytes.readUInt16LE(end + 4) !== bytes.readUInt16LE(end + 6))
      throw new Error("Segmented central directory starts on a different volume.");
    let offset = bytes.readUInt32LE(end + 16);
    const methods = new Set();
    for (let entry = 0; entry < bytes.readUInt16LE(end + 10); entry++) {
      if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
        throw new Error("Invalid segmented central directory entry.");
      methods.add(bytes.readUInt16LE(offset + 10));
      offset +=
        46 +
        bytes.readUInt16LE(offset + 28) +
        bytes.readUInt16LE(offset + 30) +
        bytes.readUInt16LE(offset + 32);
    }
    if (offset !== end) throw new Error("Unexpected segmented central directory extent.");
    return { multiDisk, compressionMethods: [...methods].sort((a, b) => a - b) };
  }
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const methods = new Set();
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        methods.add(entry.compressionMethod);
        zip.readEntry();
      });
      zip.on("end", () =>
        resolve({ multiDisk, compressionMethods: [...methods].sort((a, b) => a - b) }),
      );
      zip.readEntry();
    });
  });
}

export async function generatePublication(suite, directory, outputDirectory) {
  if (!/^[a-z0-9_-]+$/.test(directory)) throw new Error("Unsafe publication directory.");
  const source = path.resolve(suite, "tests", directory);
  if (!outputDirectory) throw new Error("A separate publication output directory is required.");
  const relativeOutput = path.relative(path.resolve(suite), path.resolve(outputDirectory));
  if (
    relativeOutput === "" ||
    (!relativeOutput.startsWith(`..${path.sep}`) &&
      relativeOutput !== ".." &&
      !path.isAbsolute(relativeOutput))
  )
    throw new Error("Generated publications must be outside the pinned source checkout.");
  mkdirSync(outputDirectory, { recursive: true });
  const output = path.resolve(outputDirectory, `${directory}.epub`);
  if (existsSync(output)) throw new Error(`Publication output already exists: ${output}`);
  if (readFileSync(path.join(source, "mimetype"), "utf8").trim() !== "application/epub+zip")
    throw new Error(`Missing EPUB mimetype: ${directory}`);
  const entries = readdirSync(source).filter((name) => name !== "mimetype" && name !== ".DS_Store");
  const zip = (args) => {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`zip failed for ${directory}: ${result.stdout}${result.stderr}`);
  };
  const temporary =
    directory === "ocf-zip-mult" ? mkdtempSync(path.join(os.tmpdir(), "ambra-segmented-")) : null;
  try {
    const archive = temporary ? path.join(temporary, "original.epub") : output;
    zip(["-q", "-X", "-0", archive, "mimetype"]);
    zip([
      "-q",
      "-r",
      "-X",
      ...(directory === "ocf-zip-comp" ? ["-Z", "bzip2"] : []),
      archive,
      ...entries,
      "-x",
      "*.DS_Store",
    ]);
    if (temporary) zip(["-q", "-s", "64k", archive, "--out", output]);
    const properties = await archiveProperties(output);
    if (directory === "ocf-zip-comp" && !properties.compressionMethods.includes(12))
      throw new Error("BZIP2 fixture generation did not retain unsupported compression.");
    if (directory === "ocf-zip-mult" && !properties.multiDisk)
      throw new Error("Segmented fixture is too small or was not split.");
    return properties;
  } finally {
    if (temporary) rmSync(temporary, { recursive: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: { suite: { type: "string" }, plan: { type: "string" }, output: { type: "string" } },
  });
  if (!values.suite || !values.plan || !values.output)
    throw new Error("--suite, --plan and --output are required.");
  const plan = JSON.parse(readFileSync(values.plan, "utf8"));
  if (!Array.isArray(plan.criteria) || plan.criteria.length !== 139)
    throw new Error("A complete required inventory is required.");
  const directories = plan.criteria.flatMap((test) => test.sourceDirectories);
  if (directories.length !== 140 || new Set(directories).size !== 140)
    throw new Error("Expected 140 distinct required publications.");
  for (const directory of directories) {
    const properties = await generatePublication(values.suite, directory, values.output);
    console.log(`${directory}: ${JSON.stringify(properties)}`);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
