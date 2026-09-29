import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { formatReport, parseArguments, scanMembers, scanPaths } from "./scan-epubs.mjs";

const cli = fileURLToPath(new URL("./scan-epubs.mjs", import.meta.url));
function archive(extra = {}) {
  return zipSync(Object.fromEntries(Object.entries({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
    "EPUB/package.opf": '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Synthetic &amp; Original</dc:title></metadata></package>',
    ...extra,
  }).map(([name, value]) => [name, strToU8(value)])));
}
const defaults = () => parseArguments(["unused.epub"]);
const scanArchive = (bytes, options) => scanMembers(Object.entries(unzipSync(bytes)), options);

test("default and custom searches validate arguments and combine filters as OR", () => {
  assert.equal(defaults().css.length, 3);
  const options = parseArguments(["--css", "display=grid", "--css", "float", "--tag", "TABLE", "--class", "Note", "--json", "books"]);
  assert.deepEqual(options.css, [{ property: "display", value: "grid" }, { property: "float", value: undefined }]);
  assert.deepEqual(options.tags, ["table"]);
  assert.deepEqual(options.classes, ["Note"]);
  assert.equal(options.json, true);
  for (const args of [[], ["--no-such-option"], ["--css"], ["--css", "break-inside="], ["--class", "two tokens", "books"]]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments(["--help"]).help, true);
  assert.deepEqual(parseArguments(["--", "-books"]).paths, ["-books"]);
});

test("finds external, embedded, and inline CSS, preserves conditions, and ignores comments and strings", async () => {
  const book = await scanArchive(archive({
    "EPUB/styles.CSS": `/* div {break-inside:avoid} */\na::before { content:"break-inside:avoid"; }\n@media print { aside.note { page-break-inside: avoid !important; } }\ndiv { break-inside: avoid-page; }\nsection { break-inside: auto; }\n`,
    "EPUB/chapter.xhtml": '<html><head><style><![CDATA[\n.note {break-inside:avoid}\n]]></style></head><body><aside class="note" id="n1" style="page-break-inside: avoid">Original fixture</aside></body></html>',
  }), defaults());
  assert.equal(book.title, "Synthetic & Original");
  assert.equal(book.matches.length, 4);
  assert.deepEqual(book.errors, []);
  const external = book.matches.find((match) => match.selector === "aside.note");
  assert.equal(external.line, 3);
  assert.deepEqual(external.conditions, ["@media print"]);
  assert.equal(external.important, true);
  assert.ok(book.matches.some((match) => match.kind === "style-block" && match.selector === ".note"));
  assert.ok(book.matches.some((match) => match.kind === "inline" && match.element === "aside#n1.note"));
});

test("tag and class search handles namespaces and legacy HTML without emitting book prose", async () => {
  const options = parseArguments(["--tag", "math", "--class", "note", "unused"]);
  const book = await scanArchive(archive({
    "EPUB/old.html": '<html><body><aside class="noteworthy note">Private text & loose ampersand</aside><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></body>',
    "EPUB/image.svg": '<svg xmlns="http://www.w3.org/2000/svg"><g class="note"/></svg>',
  }), options);
  assert.equal(book.matches.length, 3);
  assert.equal(book.documents, 2);
  assert.ok(book.matches.every((match) => match.kind === "element"));
  assert.ok(!JSON.stringify(book).includes("Private text"));
});

test("malformed CSS is an explicit partial failure, without hiding other matches", async () => {
  const book = await scanArchive(archive({
    "EPUB/broken.css": "aside { break-inside: avoid;",
    "EPUB/good.css": "aside { break-inside: avoid; }",
  }), defaults());
  assert.equal(book.errors.length, 1);
  assert.match(book.errors[0], /broken.css.*CSS parse failed/);
  assert.equal(book.matches.length, 1);
});

test("rejects oversized members and never extracts archive paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ambra-scan-limits-"));
  try {
    await writeFile(path.join(directory, "huge.epub"), archive({ "huge.css": " ".repeat(16 * 1024 * 1024 + 1) }));
    await writeFile(path.join(directory, "unsafe.epub"), archive({ "../outside.css": "aside{break-inside:avoid}" }));
    const report = await scanPaths(parseArguments([directory]));
    assert.equal(report.errors.length, 2);
    assert.ok(report.errors.some((error) => error.includes("16 MiB")));
    assert.ok(report.errors.some((error) => error.includes("invalid relative path")));
    assert.equal(report.books.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("scans nested case-insensitive EPUBs, groups duplicates, and leaves inputs unchanged", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ambra-scan-test-"));
  try {
    await mkdir(path.join(directory, "nested"));
    const bytes = archive({ "EPUB/style.css": "aside{page-break-inside:avoid}" });
    const first = path.join(directory, "one.epub");
    await writeFile(first, bytes);
    await writeFile(path.join(directory, "nested", "two.EPUB"), bytes);
    await writeFile(path.join(directory, "corrupt.epub"), "not a ZIP");
    await symlink(directory, path.join(directory, "loop"), "dir");
    const report = await scanPaths(parseArguments([directory, first]));
    assert.equal(report.filesFound, 3);
    assert.equal(report.books.length, 1);
    assert.equal(report.books[0].files.length, 2);
    assert.equal(report.books[0].matches.length, 1);
    assert.equal(report.errors.length, 1);
    assert.equal(report.warnings.length, 1);
    assert.deepEqual(new Uint8Array(await readFile(first)), bytes);
    assert.match(formatReport(report), /1 distinct EPUBs matched/);
    const result = spawnSync(process.execPath, [cli, "--json", directory], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).filesFound, 3);
    assert.match(result.stderr, /corrupt.epub/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing paths fail explicitly and empty results are successful", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ambra-scan-empty-"));
  try {
    const empty = spawnSync(process.execPath, [cli, "--json", directory], { encoding: "utf8" });
    assert.equal(empty.status, 0);
    assert.deepEqual(JSON.parse(empty.stdout).books, []);
    const missing = spawnSync(process.execPath, [cli, path.join(directory, "missing")], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ENOENT/);
    const invalid = spawnSync(process.execPath, [cli, "--unknown"], { encoding: "utf8" });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Unknown option/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
