import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

export type ProgressMarkerFixture =
  | "sparse" | "fragments" | "dense-flat" | "dense-nested" | "crowded-parts"
  | "missing-landmarks" | "same-page" | "duplicate-target" | "unresolved"
  | "unresolved-landmarks" | "nested-reading-work" | "flat-100" | "flat-101";

interface Entry {
  label: string;
  target: string;
  children?: Entry[];
}

/** Original miniature books: atomic panels enforce real page separation even in
 * paginators that do not honor CSS page breaks, without a hundred spine files. */
export function progressMarkerFixture(
  info: TestInfo,
  kind: ProgressMarkerFixture,
  direction: "ltr" | "rtl" = "ltr",
): string {
  const name = `progress-${kind}-${direction}`;
  const source = info.outputPath(`${name}-source`);
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const files: Record<string, string> = {};
  const spine: string[] = [];
  const dense = ["dense-flat", "dense-nested", "crowded-parts", "flat-100", "flat-101"].includes(kind);
  const atomicAnchors = dense || kind === "nested-reading-work";
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><style>
body { margin: 0; }
.leaf { break-before: page; page-break-before: always; }
.leaf:first-child { break-before: auto; page-break-before: auto; }
h1 { font-size: 20px; } p { font-size: 16px; }
</style></head><body>${body}</body></html>`;
  const leaves = (label: string, count: number, id: string, extraAnchor = "") =>
    Array.from({ length: count }, (_, index) =>
      `<section class="leaf"${index === 0 && !atomicAnchors ? ` id="${id}"` : ""}>
${index === 0 ? extraAnchor : ""}
<svg xmlns="http://www.w3.org/2000/svg"${index === 0 && atomicAnchors ? ` id="${id}"` : ""} width="240" height="600" viewBox="0 0 240 600" style="display:block">
<title>${label}: leaf ${index + 1}</title>
<rect x="10" y="80" width="220" height="440" fill="#e4edf5"/>
<circle cx="120" cy="250" r="70" fill="#728ba4"/>
<text x="10" y="30" font-size="16">${label}: leaf ${index + 1}</text>
<text x="10" y="560" font-size="12">The keeper charts a new island.</text>
</svg></section>`).join("");
  const document = (name: string, body: string) => {
    spine.push(name);
    files[`EPUB/${name}.xhtml`] = xhtml(name, body);
  };
  const padding = 4;
  const toc: Entry[] = [];
  let firstTarget: string;
  if (kind === "nested-reading-work") {
    document("front", leaves("Front matter", 6, "front") + leaves("Frontispiece", 1, "frontispiece"));
    const chapterPages = [9, 23, 39, 56, 75, 94, 115, 133, 152, 170, 186, 200];
    const children: Entry[] = [];
    let body = leaves("The Lantern Atlas", 1, "work");
    chapterPages.forEach((page, index) => {
      const id = `chapter-${index + 1}`;
      const label = `Chapter ${index + 1}`;
      children.push({ label, target: `text.xhtml#${id}` });
      body += leaves(label, (chapterPages[index + 1] ?? 220) - page, id);
    });
    document("text", body);
    toc.push(
      { label: "Frontispiece", target: "front.xhtml#frontispiece" },
      { label: "The Lantern Atlas", target: "text.xhtml#work", children },
      { label: "About this atlas", target: "back.xhtml#back-start" },
      { label: "Production notes", target: "back.xhtml#credits" },
    );
    firstTarget = "text.xhtml#work";
  } else if (dense) {
    document("front", leaves("Front matter", padding, "front"));
    document("opening", leaves("Reading begins", padding, "body-start"));
    const sizes = kind === "crowded-parts" ? [1, 1, 1, 247]
      : kind === "flat-100" ? [25, 25, 25, 25]
      : kind === "flat-101" ? [26, 25, 25, 25]
      : [63, 63, 62, 62];
    let number = 0;
    sizes.forEach((count, part) => {
      const children: Entry[] = [];
      let body = "";
      for (let index = 0; index < count; index++) {
        number++;
        const id = `chapter-${number}`;
        children.push({ label: `Chapter ${number}`, target: `part-${part}.xhtml#${id}` });
        body += leaves(`Chapter ${number}`, 1, id);
      }
      document(`part-${part}`, body);
      const parent = { label: `Part ${part + 1}`, target: children[0]!.target, children };
      toc.push(...(["dense-flat", "flat-100", "flat-101"].includes(kind) ? children : [parent]));
    });
    firstTarget = "opening.xhtml#body-start";
  } else {
    document("front", leaves("Front matter", padding, "front"));
    const lengths = [6, 10, 14, 8];
    const fragments = kind === "fragments";
    let combined = fragments ? leaves("Reading begins", padding, "body-start") : "";
    if (!fragments) document("opening", leaves("Reading begins", padding, "body-start"));
    lengths.forEach((count, index) => {
      const file = fragments ? "text" : `chapter-${index + 1}`;
      const id = `chapter-${index + 1}`;
      const entry = { label: `Chapter ${index + 1}`, target: `${file}.xhtml#${id}` };
      toc.push(entry);
      const extra = kind === "same-page" && index === 0 ? '<span id="nearby">Nearby heading.</span>' : "";
      const body = leaves(entry.label, count, id, extra);
      if (fragments) combined += body;
      else document(file, body);
      if (index === 0 && kind === "same-page") {
        toc.push({ label: "A distinct heading on the same page", target: `${file}.xhtml#nearby` });
      }
      if (index === 0 && kind === "duplicate-target") {
        toc.push({ label: "The same chapter listed again", target: entry.target });
      }
    });
    if (fragments) document("text", combined);
    firstTarget = fragments ? "text.xhtml#body-start" : "opening.xhtml#body-start";
    if (kind === "unresolved") toc[1]!.target = "chapter-2.xhtml#does-not-exist";
  }
  document("back", kind === "nested-reading-work"
    ? leaves("About this atlas", 1, "back-start") + leaves("Production notes", 10, "credits")
    : leaves("Back matter", padding, "back-start"));
  if (kind === "unresolved-landmarks") firstTarget = firstTarget.replace("#body-start", "#missing-body");
  const backTarget = kind === "unresolved-landmarks" ? "back.xhtml#missing-back" : "back.xhtml#back-start";
  const renderEntries = (entries: Entry[]): string => `<ol>${entries.map(entry =>
    `<li><a href="${entry.target}">${entry.label}</a>${entry.children ? renderEntries(entry.children) : ""}</li>`).join("")}</ol>`;
  files["EPUB/nav.xhtml"] = xhtml("Contents",
    `<nav epub:type="toc">${renderEntries(toc)}</nav>${kind === "missing-landmarks" ? "" :
      `<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="${firstTarget}">Start reading</a></li>
<li><a epub:type="backmatter" href="${backTarget}">Notes and credits</a></li></ol></nav>`}`);
  files.mimetype = "application/epub+zip";
  files["META-INF/container.xml"] = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles>
<rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  files["EPUB/package.opf"] = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:ambra:${name}</dc:identifier>
<dc:title>Progress markers ${kind} ${direction}</dc:title><dc:language>en</dc:language>
<meta property="dcterms:modified">2026-09-28T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${spine.map((file, index) => `<item id="s${index}" href="${file}.xhtml" media-type="application/xhtml+xml" properties="svg"/>`).join("")}
</manifest><spine page-progression-direction="${direction}">
${spine.map((_, index) => `<itemref idref="s${index}"/>`).join("")}</spine></package>`;
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(source, file), content);
  const target = info.outputPath(`${name}.epub`);
  execFileSync("zip", ["-q", "-X", "-0", target, "mimetype"], { cwd: source });
  execFileSync("zip", ["-q", "-X", "-r", target, "META-INF", "EPUB"], { cwd: source });
  return target;
}
