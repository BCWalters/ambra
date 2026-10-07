import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import yauzl from "yauzl";
import { archiveProperties, generatePublication } from "./epub-conformance-publications.mjs";

function fixture(t, id, large = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ambra-archive-unit-"));
  t.after(() => rmSync(root, { recursive: true }));
  const suite = path.join(root, "suite");
  const source = path.join(suite, "tests", id);
  mkdirSync(path.join(source, "FOO", "BAR"), { recursive: true });
  mkdirSync(path.join(source, "META-INF"));
  writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  writeFileSync(path.join(source, "META-INF", "container.xml"), "<container/>");
  writeFileSync(
    path.join(source, "FOO", "BAR", "package.opf"),
    `<package>${"<meta>Repeated synthetic fixture metadata</meta>".repeat(100)}</package>`,
  );
  if (large) writeFileSync(path.join(source, "FOO", "BAR", "sample.bin"), randomBytes(192 * 1024));
  return { suite, source, output: path.join(root, "publications"), root };
}

function entries(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = [];
      zip.on("error", reject);
      zip.on("entry", (entry) => {
        entries.push(entry);
        zip.readEntry();
      });
      zip.on("end", () => resolve(entries));
      zip.readEntry();
    });
  });
}

test("ordinary fixture preserves arbitrary root folders and uncompressed first mimetype", async (t) => {
  const { suite, output } = fixture(t, "sample");
  const properties = await generatePublication(suite, "sample", output);
  assert.equal(properties.multiDisk, false);
  const observed = await entries(path.join(output, "sample.epub"));
  assert.equal(observed[0].fileName, "mimetype");
  assert.equal(observed[0].compressionMethod, 0);
  assert.ok(observed.some((entry) => entry.fileName === "FOO/BAR/package.opf"));
  await assert.rejects(generatePublication(suite, "sample", output), /already exists/);
});

test("compression fixture contains actual BZIP2 streams, not relabelled Deflate", async (t) => {
  const { suite, output } = fixture(t, "ocf-zip-comp");
  const properties = await generatePublication(suite, "ocf-zip-comp", output);
  assert.deepEqual(properties.compressionMethods, [0, 12]);
  assert.ok(properties.versionNeededValues.includes(46));
  const file = path.join(output, "ocf-zip-comp.epub");
  const observed = await entries(file);
  const compressed = observed.find((entry) => entry.compressionMethod === 12);
  const bytes = readFileSync(file);
  const start =
    compressed.relativeOffsetOfLocalHeader +
    30 +
    bytes.readUInt16LE(compressed.relativeOffsetOfLocalHeader + 26) +
    bytes.readUInt16LE(compressed.relativeOffsetOfLocalHeader + 28);
  assert.equal(bytes.subarray(start, start + 3).toString("ascii"), "BZh");
});

test("segmentation fixture retains real volumes and does not overwrite upstream volume data", async (t) => {
  const { suite, output } = fixture(t, "ocf-zip-mult", true);
  const originalVolume = path.join(suite, "tests", "ocf-zip-mult.z01");
  writeFileSync(originalVolume, "Retained pinned source volume");
  const properties = await generatePublication(suite, "ocf-zip-mult", output);
  assert.equal(properties.multiDisk, true);
  assert.deepEqual(properties.compressionMethods, [0, 8]);
  assert.deepEqual(properties.versionNeededValues, [10, 20]);
  assert.equal(readFileSync(originalVolume, "utf8"), "Retained pinned source volume");
  assert.notEqual(path.dirname(output), suite);
});

test("generation rejects output inside the pinned checkout and unsafe directory names", async (t) => {
  const { suite, output } = fixture(t, "sample");
  await assert.rejects(generatePublication(suite, "sample", path.join(suite, "tests")), /outside/);
  await assert.rejects(generatePublication(suite, "../sample", output), /Unsafe/);
});

test("archive inspection rejects malformed end records rather than inferring ZIP properties", async (t) => {
  const { root } = fixture(t, "sample");
  const invalid = path.join(root, "invalid.epub");
  writeFileSync(invalid, "Not a ZIP container");
  await assert.rejects(archiveProperties(invalid), /end record/);
});
