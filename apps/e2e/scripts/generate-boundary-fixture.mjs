#!/usr/bin/env node
// Original one-line chapters exercise focus visibility in a very short iframe.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const source = path.join(directory, ".boundary-fixture-source");
const target = path.join(directory, "reading-boundaries.epub");
fs.mkdirSync(source);
try {
  fs.mkdirSync(path.join(source, "META-INF"));
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:reading-boundaries</dc:identifier><dc:title>Reading Boundaries</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[1, 2, 3].map(index => `<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine><itemref idref="c1"/><itemref idref="c2" linear="no"/><itemref idref="c3"/></spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Start</a></li><li><a href="c3.xhtml">Final chapter</a></li></ol></nav></body></html>`);
  for (const index of [1, 2, 3]) {
    fs.writeFileSync(path.join(source, `EPUB/c${index}.xhtml`),
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Section ${index}</title><style>p{margin:0!important;font-size:12px!important;line-height:16px!important}</style></head><body><p>Original boundary test sentence ${index}.</p></body></html>`);
  }
  fs.rmSync(target, { force: true });
  for (const args of [["-q", "-X", "-0", target, "mimetype"], ["-q", "-X", "-r", target, "META-INF", "EPUB"]]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "zip failed");
  }
} finally {
  fs.rmSync(source, { recursive: true });
}
