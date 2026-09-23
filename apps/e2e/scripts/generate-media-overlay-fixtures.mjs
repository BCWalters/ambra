#!/usr/bin/env node
// Run from the repository root: node apps/e2e/scripts/generate-media-overlay-fixtures.mjs
// Synthetic text and PCM audio; no downloads, codecs, or additional dependencies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../real-books/media-overlay-source");
const fixtures = path.resolve(here, "../fixtures/media-overlay");
const timestamp = new Date("2026-01-01T00:00:00Z");
const clipSeconds = 4;
const passages = 3;
fs.mkdirSync(fixtures, { recursive: true });

function wav(chapter, passageCount = passages) {
  const sampleRate = 8000;
  const samples = sampleRate * clipSeconds * passageCount;
  const bytes = Buffer.alloc(44 + samples, 128);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples, 40);
  // Quiet, short square-wave cues at each clip start; the remaining PCM is silence.
  for (let passage = 0; passage < passageCount; passage++) {
    for (let sample = 0; sample < 800; sample++) {
      bytes[44 + passage * clipSeconds * sampleRate + sample] =
        128 + (Math.floor(sample / (chapter === 1 ? 10 : 8)) % 2 ? 6 : -6);
    }
  }
  return bytes;
}

function xhtml(title, body, fixedLayout = false) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><title>${title}</title>${fixedLayout ? '<meta name="viewport" content="width=600,height=800"/>' : ""}<style>${fixedLayout ? "html,body{margin:0;width:600px;height:800px}body{box-sizing:border-box;padding:40px;font-size:28px}" : ""}
.filler{margin:0!important;font-size:16px!important;line-height:28px!important}
.synthetic-narration-active{background:#ffe082}
</style></head><body>${body}</body></html>`;
}

for (const variant of ["narrated", "invalid-audio", "fixed-layout"]) {
  const fixedLayout = variant === "fixed-layout";
  const passageCount = fixedLayout ? 1 : passages;
  const chapterDuration = `00:00:${String(clipSeconds * passageCount).padStart(2, "0")}`;
  const bookDuration = `00:00:${String(clipSeconds * passageCount * 2).padStart(2, "0")}`;
  const source = path.join(root, variant);
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB", "audio"), { recursive: true });
  const entries = new Map([
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
  ]);
  for (const chapter of [1, 2]) {
    const title = `Narrated chapter ${chapter}`;
    entries.set(
      `EPUB/chapter-${chapter}.xhtml`,
      xhtml(
        title,
        `<h1>${title}</h1>` +
          Array.from({ length: passageCount }, (_, i) => {
            const passage = i + 1;
            return (
              `<p id="c${chapter}-p${passage}">Chapter ${chapter}, narrated passage ${passage}. A quiet bell marks this passage.</p>` +
              Array.from(
                { length: fixedLayout ? 0 : 32 },
                (_, line) =>
                  `<p class="filler">Chapter ${chapter}, passage ${passage}, line ${line + 1}: the path continues beside the river.</p>`,
              ).join("")
            );
          }).join(""),
        fixedLayout,
      ),
    );
    entries.set(
      `EPUB/overlay-${chapter}.smil`,
      `<?xml version="1.0" encoding="utf-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0"><body><seq id="sequence-${chapter}" epub:textref="chapter-${chapter}.xhtml">
${Array.from({ length: passageCount }, (_, i) => `<par id="par-${chapter}-${i + 1}"><text src="chapter-${chapter}.xhtml#c${chapter}-p${i + 1}"/><audio src="audio/chapter-${chapter}.wav" clipBegin="${i * clipSeconds}s" clipEnd="${(i + 1) * clipSeconds}s"/></par>`).join("\n")}
</seq></body></smil>`,
    );
    entries.set(
      `EPUB/audio/chapter-${chapter}.wav`,
      variant === "invalid-audio"
        ? Buffer.from("Intentionally invalid synthetic WAV.")
        : wav(chapter, passageCount),
    );
  }
  entries.set(
    "EPUB/nav.xhtml",
    xhtml(
      "Contents",
      `<nav epub:type="toc"><ol>${[1, 2].map((chapter) => `<li><a href="chapter-${chapter}.xhtml#c${chapter}-p1">Narrated chapter ${chapter}</a>${fixedLayout ? "" : `<ol>${[2, 3].map((passage) => `<li><a href="chapter-${chapter}.xhtml#c${chapter}-p${passage}">Chapter ${chapter} passage ${passage}</a></li>`).join("")}</ol>`}</li>`).join("")}</ol></nav>`,
    ),
  );
  entries.set(
    "EPUB/package.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="media: http://www.idpf.org/epub/vocab/overlays/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:ambra:synthetic-media-overlay:${variant}:v1</dc:identifier><dc:title>Synthetic narration ${variant}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta><meta property="media:duration">${bookDuration}</meta><meta property="media:duration" refines="#mo1">${chapterDuration}</meta><meta property="media:duration" refines="#mo2">${chapterDuration}</meta><meta property="media:active-class">synthetic-narration-active</meta>${fixedLayout ? '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">both</meta>' : ""}</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${[1, 2].map((chapter) => `<item id="c${chapter}" href="chapter-${chapter}.xhtml" media-type="application/xhtml+xml" media-overlay="mo${chapter}"/><item id="mo${chapter}" href="overlay-${chapter}.smil" media-type="application/smil+xml"/><item id="a${chapter}" href="audio/chapter-${chapter}.wav" media-type="audio/wav"/>`).join("\n")}
</manifest><spine><itemref idref="c1"${fixedLayout ? ' properties="page-spread-left"' : ""}/><itemref idref="c2"${fixedLayout ? ' properties="page-spread-right"' : ""}/></spine></package>`,
  );
  const ordered = [
    "mimetype",
    ...[...entries.keys()].filter((entry) => entry !== "mimetype").sort(),
  ];
  for (const entry of ordered) {
    const target = path.join(source, entry);
    fs.writeFileSync(target, entries.get(entry));
    fs.utimesSync(target, timestamp, timestamp);
  }
  const target = path.join(fixtures, `${variant}.epub`);
  fs.rmSync(target, { force: true });
  // Fixed UTC DOS timestamps, sorted file entries, and no platform extra fields.
  const options = { cwd: source, env: { ...process.env, TZ: "UTC" } };
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], options);
  execFileSync("zip", ["-q", "-X", target, ...ordered.slice(1)], options);
  console.log(
    `${path.relative(path.resolve(here, "../../.."), target)}: ${fs.statSync(target).size} bytes`,
  );
}
