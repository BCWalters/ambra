import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { TestInfo } from "@playwright/test";

/** Original reflowable content with font-independent page boundaries.
 * Each atomic SVG is 600px tall: one fits, two cannot fit at a 900px viewport. */
export function navigationFixture(info: TestInfo, chapterPages: number[]): string {
  const source = info.outputPath("navigation-source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"));
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(path.join(source, "META-INF/container.xml"),
    `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  fs.writeFileSync(path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:navigation-${chapterPages.join("-")}</dc:identifier><dc:title>Navigation boundaries</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapterPages.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml" properties="svg"/>`).join("")}</manifest><spine>${chapterPages.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`);
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapterPages.map((_, i) => `<li><a href="c${i}.xhtml">Chapter ${i + 1}</a></li>`).join("")}</ol></nav></body></html>`);
  chapterPages.forEach((count, chapter) => {
    const pages = Array.from({ length: count }, (_, page) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600" style="display:block"><text x="20" y="40" font-size="20">C${chapter + 1}Para ${page + 1}.</text></svg>`).join("");
    fs.writeFileSync(path.join(source, `EPUB/c${chapter}.xhtml`),
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${chapter + 1}</title></head><body>${pages}</body></html>`);
  });
  const target = info.outputPath("navigation.epub");
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}
