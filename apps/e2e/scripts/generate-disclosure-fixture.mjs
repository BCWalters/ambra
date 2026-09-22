#!/usr/bin/env node
// Issue #132: a native disclosure whose expanded body spans several pages.
// Run: node apps/e2e/scripts/generate-disclosure-fixture.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../real-books/disclosure-pagination",
);
const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/disclosure-pagination",
);
fs.mkdirSync(fixtures, { recursive: true });
fs.mkdirSync(root, { recursive: true });
const source = path.join(root, "source");
fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
fs.writeFileSync(
  path.join(source, "META-INF/container.xml"),
  `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
);
const lines = (prefix, count) =>
  Array.from(
    { length: count },
    (_, i) =>
      `<p class="line" data-line="${prefix}${String(i + 1).padStart(3, "0")}">${prefix}${String(i + 1).padStart(3, "0")} — A complete, numbered disclosure test line.</p>`,
  ).join("");
for (const name of [
  "initially-closed",
  "authored-open",
  "closed-no-summary",
  "closed-contents-wrapper",
]) {
  const open = name === "authored-open";
  const summary =
    name === "closed-no-summary" ? "" : "<summary>Expand ninety numbered lines</summary>";
  const trailing =
    name === "closed-contents-wrapper"
      ? `<div style="display:contents">${lines("T", 40)}</div>`
      : lines("T", 40);
  fs.writeFileSync(
    path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:disclosure:${name}</dc:identifier><dc:title>Disclosure ${name}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-22T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
  );
  fs.writeFileSync(
    path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Disclosure pagination</a></li></ol></nav></body></html>`,
  );
  fs.writeFileSync(
    path.join(source, "EPUB/chapter.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Disclosure pagination</title><style>.line{margin:0!important;font-size:16px!important;line-height:32px!important;white-space:nowrap}summary{cursor:pointer}</style></head><body><h1>Disclosure pagination</h1><details id="long-disclosure"${open ? ' open="open"' : ""}>${summary}${lines("D", 90)}</details>${trailing}</body></html>`,
  );
  const target = path.join(fixtures, `${name}.epub`);
  fs.rmSync(target, { force: true });
  for (const args of [
    ["-q", "-X", "-0", target, "mimetype"],
    ["-q", "-X", "-r", target, "META-INF", "EPUB"],
  ]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "zip failed");
  }
  console.log(
    `${name}: ${fs.statSync(target).size} bytes; 90 disclosure lines + 40 trailing lines`,
  );
}
