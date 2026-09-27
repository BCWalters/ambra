#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

if (!process.argv[2]) throw new Error("Usage: node generate-wide-table-repro.mjs OUTPUT_DIRECTORY");
const root = path.resolve(process.argv[2]);
const source = path.join(root, "source");
fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
const xhtml = (body) =>
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Wide table</title><style>td,th{border:1px solid;padding:4px}table{border-collapse:collapse}</style></head><body>${body}</body></html>`;
const files = {
  mimetype: "application/epub+zip",
  "META-INF/container.xml":
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  "EPUB/package.opf":
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:ambra:wide-table-repro</dc:identifier><dc:title>Wide table reproduction</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-26T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>',
  "EPUB/nav.xhtml": xhtml(
    '<nav epub:type="toc"><ol><li><a href="ch1.xhtml#table">Wide table</a></li></ol></nav>',
  ),
  "EPUB/ch1.xhtml": xhtml(
    `<h2 id="table">Wide table</h2><table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>${"W".repeat(22)}</td><td>${"W".repeat(22)}</td><td>${"W".repeat(22)}</td></tr></tbody></table><p>End of document.</p>`,
  ),
};
for (const [filename, contents] of Object.entries(files)) {
  const target = path.join(source, filename);
  fs.writeFileSync(target, contents);
  fs.utimesSync(target, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
}
const book = path.join(root, "wide-table.epub");
fs.rmSync(book, { force: true });
execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
execFileSync(
  "zip",
  [
    "-q",
    "-X",
    book,
    ...Object.keys(files)
      .filter((name) => name !== "mimetype")
      .sort(),
  ],
  { cwd: source },
);
