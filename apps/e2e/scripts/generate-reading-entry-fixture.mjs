#!/usr/bin/env node
// Run: node apps/e2e/scripts/generate-reading-entry-fixture.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/reading-entry.epub");
const source = fs.mkdtempSync(path.join(os.tmpdir(), "ambra-reading-entry-"));
try {
  fs.mkdirSync(path.join(source, "META-INF"));
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:reading-entry</dc:identifier><dc:title>Reading Entry</dc:title><dc:description>An original book for testing continuous reading across page boundaries.</dc:description><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">A continuous paragraph</a></li></ol></nav></body></html>`);
  const paragraph = Array.from({ length: 180 }, (_, index) =>
    `Sentence ${index + 1} follows the winding path beside the river, where the reader continues without a paragraph break.`,
  ).join(" ");
  fs.writeFileSync(path.join(source, "EPUB/chapter.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>A continuous paragraph</title></head><body><h1>A continuous paragraph</h1><p id="continuous">${paragraph}</p></body></html>`);
  fs.rmSync(target, { force: true });
  for (const args of [
    ["-q", "-X", "-0", target, "mimetype"],
    ["-q", "-X", "-r", target, "META-INF", "EPUB"],
  ]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "zip failed");
  }
  console.log(`Reading entry: ${fs.statSync(target).size} bytes; one paragraph spanning many pages`);
} finally {
  fs.rmSync(source, { recursive: true, force: true });
}
