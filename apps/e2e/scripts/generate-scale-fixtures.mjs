#!/usr/bin/env node
// Issues #130–132. Run from the repository root:
// node apps/e2e/scripts/generate-scale-fixtures.mjs
// Generated binaries/sources stay in the already-ignored real-books directory.
// Uses the same independent system zip / stored-first mimetype convention as
// packages/engine/scripts/build-fixtures.sh. All prose and pixels are synthetic.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../real-books/scale-validation",
);
fs.mkdirSync(root, { recursive: true });
const passage =
  "The expedition followed the river through quiet fields and wooded hills. Each evening the travellers recorded their observations in a notebook, comparing the landscape with the maps they had brought from home. Small villages appeared beside the water, and distant mountains changed colour as the sun descended. Their patient journey continued the following morning with fresh provisions, careful measurements, and stories shared along the road.";
const xhtml = (title, content) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>${title}</title><style>body{font-family:serif}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid;padding:6px}svg{max-width:100%}figure{margin:1em 0}</style></head><body><h1>${title}</h1>${content}</body></html>`;

function book(name, chapters, assets = []) {
  const source = path.join(root, `${name}-src`);
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  fs.writeFileSync(path.join(source, "mimetype"), "application/epub+zip");
  fs.writeFileSync(
    path.join(source, "META-INF/container.xml"),
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  chapters.forEach((chapter, i) =>
    fs.writeFileSync(
      path.join(source, `EPUB/ch${i + 1}.xhtml`),
      xhtml(chapter.title, chapter.content),
    ),
  );
  for (const asset of assets)
    fs.writeFileSync(path.join(source, "EPUB", asset.name), asset.bytes());
  fs.writeFileSync(
    path.join(source, "EPUB/nav.xhtml"),
    xhtml(
      "Contents",
      `<nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${c.title}</a></li>`).join("")}</ol></nav>`,
    ),
  );
  fs.writeFileSync(
    path.join(source, "EPUB/package.opf"),
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:ambra:scale-validation:${name}:v1</dc:identifier><dc:title>${name}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-22T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"${c.properties ? ` properties="${c.properties}"` : ""}/>`).join("")}${assets.map((a, i) => `<item id="a${i}" href="${a.name}" media-type="${a.type}"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`,
  );
  const target = path.join(root, `${name}.epub`);
  fs.rmSync(target, { force: true });
  for (const args of [
    ["-q", "-X", "-0", target, "mimetype"],
    ["-q", "-X", "-r", target, "META-INF", "EPUB"],
  ]) {
    const result = spawnSync("zip", args, { cwd: source, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "zip failed");
  }
  return { bytes: fs.statSync(target).size, chapters: chapters.length, assets: assets.length };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
function png(seed) {
  const width = 768,
    height = 512;
  const raw = Buffer.alloc((1 + width * 3) * height);
  let state = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x <= width * 3; x++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      raw[y * (1 + width * 3) + x] = state & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const imageAssets = Array.from({ length: 96 }, (_, i) => ({
  name: `image${i + 1}.png`,
  type: "image/png",
  bytes: () => png(i + 1),
}));
const images = book(
  "large-images",
  Array.from({ length: 24 }, (_, c) => ({
    title: `Image chapter ${c + 1}`,
    content: Array.from(
      { length: 4 },
      (_, i) =>
        `<figure><img src="image${c * 4 + i + 1}.png" width="768" height="512" alt="Synthetic image ${c * 4 + i + 1}"/><figcaption>Image ${c * 4 + i + 1}</figcaption></figure><p>${passage}</p>`,
    ).join(""),
  })),
  imageAssets,
);
if (images.bytes < 100 * 1024 * 1024) throw new Error("Image EPUB must exceed 100 MiB");

const chapters = Array.from({ length: 120 }, (_, c) => ({
  title: `Omnibus chapter ${String(c + 1).padStart(3, "0")}`,
  content:
    Array.from(
      { length: 24 },
      (_, p) => `<p id="p${p + 1}">Chapter ${c + 1} paragraph ${p + 1}. ${passage}</p>`,
    ).join("") +
    `<p>Destinationtoken${String(c + 1).padStart(3, "0")} End of chapter ${c + 1}.</p>`,
}));
const long = book("long-omnibus", chapters);
long.words = chapters
  .map((c) => c.content.replace(/<[^>]+>/g, " "))
  .join(" ")
  .trim()
  .split(/\s+/).length;

const specimens = [
  {
    title: "Tables",
    content: `<table id="specimen"><caption>Survey results</caption><thead><tr><th scope="col">Site</th><th scope="col">Count</th></tr></thead><tbody><tr><th scope="row">River</th><td>42</td></tr><tr><th scope="row">Hill</th><td>27</td></tr></tbody></table>`,
  },
  {
    title: "Definition lists",
    content: `<dl id="specimen"><dt>Estuary</dt><dd>The tidal mouth of a river.</dd><dt>Tributary</dt><dd>A stream flowing into a larger river.</dd></dl>`,
  },
  {
    title: "Footnotes and asides",
    content: `<p>A referenced observation<a id="reference" epub:type="noteref" href="#footnote">1</a>.</p><aside id="footnote" epub:type="footnote"><p id="specimen">A carefully recorded footnote observation.</p></aside><aside><p>A supplementary aside.</p></aside>`,
  },
  {
    title: "Details and summary",
    content: `<details id="specimen"><summary>Open expedition notes</summary><p id="disclosure">The hidden expedition record is now revealed.</p></details>`,
  },
  {
    title: "MathML",
    properties: "mathml",
    content: `<math id="specimen" xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow></math>`,
  },
  {
    title: "Inline SVG",
    properties: "svg",
    content: `<svg id="specimen" xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120" role="img" aria-label="Landscape diagram"><title>Landscape diagram</title><rect width="320" height="120" fill="#bde"/><circle cx="70" cy="50" r="25" fill="#fa0"/><path d="M0 120 L150 40 L320 120Z" fill="#486"/></svg>`,
  },
  {
    title: "Ruby text",
    content: `<p id="specimen"><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby> beside ordinary prose.</p>`,
  },
];
const variety = book(
  "html-variety",
  specimens.map((s) => ({
    ...s,
    content:
      s.content +
      Array.from({ length: 12 }, (_, i) => `<p>Variety paragraph ${i + 1}. ${passage}</p>`).join(
        "",
      ) +
      `<p id="chapter-end">End of ${s.title}.</p>`,
  })),
);
const report = { images: { ...images, width: 768, height: 512 }, long, variety };
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
