#!/usr/bin/env node
// Original-content reduction: only URI encoding differs between the two books.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

if (!process.argv[2])
  throw new Error("Usage: node generate-encoded-fragment-repro.mjs OUTPUT_DIRECTORY");
const root = path.resolve(process.argv[2]);
const xhtml = (body) =>
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Fragment test</title></head><body>${body}</body></html>`;
for (const encoded of [false, true]) {
  const name = encoded ? "encoded-fragment" : "literal-fragment";
  const source = path.join(root, `${name}-source`);
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const fragment = encoded ? "arriv%C3%A9e" : "arrivée";
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/package.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:ambra:${name}</dc:identifier><dc:title>${name}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-26T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>`,
    "EPUB/nav.xhtml": xhtml(
      `<nav epub:type="toc"><ol><li><a href="ch.xhtml#start">Start</a></li><li><a href="ch.xhtml#${fragment}">Destination</a></li></ol></nav>`,
    ),
    "EPUB/ch.xhtml": xhtml(
      `<h2 id="start">Start</h2>${Array.from({ length: 24 }, (_, i) => `<p>Observation ${i + 1}. We counted blue stones beside the river, recorded the calm weather, and followed the marked path home. The notebook held an original account of this quiet journey.</p>`).join("")}<h2 id="arrivée">Destination</h2><p>The final blue stone marks our arrival.</p>`,
    ),
  };
  for (const [filename, content] of Object.entries(files)) {
    const destination = path.join(source, filename);
    fs.writeFileSync(destination, content);
    fs.utimesSync(destination, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  }
  const book = path.join(root, `${name}.epub`);
  fs.rmSync(book, { force: true });
  execFileSync("zip", ["-q", "-X", "-0", book, "mimetype"], { cwd: source });
  execFileSync(
    "zip",
    [
      "-q",
      "-X",
      book,
      ...Object.keys(files)
        .filter((file) => file !== "mimetype")
        .sort(),
    ],
    { cwd: source },
  );
}
