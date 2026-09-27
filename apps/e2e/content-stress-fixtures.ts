import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ContentStressCase {
  id: string;
  chapters: number;
  sections: number;
  depth: number;
  feature: "notes" | "media" | "overflow" | "mixed";
  unicode?: boolean;
  encoded?: boolean;
  rtl?: boolean;
  width: number;
  mode?: "scroll";
}

export const contentStressCases: ContentStressCase[] = [
  {
    id: "toc-1000-nested-notes",
    chapters: 10,
    sections: 100,
    depth: 12,
    feature: "notes",
    width: 900,
  },
  {
    id: "toc-1000-unicode-spread",
    chapters: 10,
    sections: 100,
    depth: 6,
    feature: "mixed",
    unicode: true,
    width: 1400,
  },
  {
    id: "120-short-chapters-notes",
    chapters: 120,
    sections: 1,
    depth: 1,
    feature: "notes",
    width: 900,
  },
  {
    id: "80-short-chapters-rtl",
    chapters: 80,
    sections: 1,
    depth: 8,
    feature: "mixed",
    rtl: true,
    unicode: true,
    width: 1400,
  },
  {
    id: "deep-unicode-notes",
    chapters: 3,
    sections: 12,
    depth: 16,
    feature: "notes",
    unicode: true,
    width: 760,
  },
  {
    id: "transparent-extreme-media",
    chapters: 3,
    sections: 4,
    depth: 4,
    feature: "media",
    width: 900,
  },
  {
    id: "media-rtl-spread",
    chapters: 4,
    sections: 4,
    depth: 4,
    feature: "media",
    rtl: true,
    width: 1400,
  },
  {
    id: "wide-table-pre-narrow",
    chapters: 3,
    sections: 4,
    depth: 4,
    feature: "overflow",
    width: 600,
  },
  {
    id: "overflow-unicode-scroll",
    chapters: 3,
    sections: 6,
    depth: 8,
    feature: "overflow",
    unicode: true,
    width: 900,
    mode: "scroll",
  },
  {
    id: "mixed-writing-notes-scroll",
    chapters: 4,
    sections: 6,
    depth: 8,
    feature: "mixed",
    rtl: true,
    unicode: true,
    width: 760,
    mode: "scroll",
  },
];

export interface StressTarget {
  label: string;
  id: string;
  href: string;
  chapter: number;
}

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const document = (title: string, body: string, rtl = false) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${rtl ? "ar" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><title>${xml(title)}</title><style>body{font-family:serif}h2{font-size:1.2em}table{border-collapse:collapse}td,th{border:1px solid;padding:4px}figure{margin:0}img{max-width:100%;height:auto}</style></head><body>${body}</body></html>`;

function specimen(feature: ContentStressCase["feature"], chapter: number) {
  const note = `<section><blockquote><p>Nested field record <a id="reference-${chapter}" epub:type="noteref" href="#note-${chapter}">Read synthetic note</a>.</p></blockquote><aside id="note-${chapter}" epub:type="footnote"><p>Original note ${chapter}: the blue pebble marks the eastern path.</p><ol><li>Nested evidence remains readable.</li></ol><a href="#reference-${chapter}">Return to reference</a></aside></section>`;
  if (feature === "notes") return note;
  if (feature === "media")
    return `<figure><img src="transparent.svg" width="480" height="240" alt="Transparent synthetic rings"/><figcaption>Transparent rings above extremely wide and tall diagrams.</figcaption></figure><img src="wide.svg" width="2400" height="48" alt="Wide synthetic ruler"/><img src="tall.svg" width="48" height="2400" alt="Tall synthetic ruler"/><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80" role="img" aria-label="Inline translucent circles"><circle cx="100" cy="40" r="36" fill="#008080" fill-opacity=".5"/><circle cx="150" cy="40" r="36" fill="#b03060" fill-opacity=".5"/></svg>`;
  if (feature === "overflow")
    return `<p>Unbreakable field code: ${"ABCD0123456789".repeat(100)}</p><table><caption>Wide synthetic observations</caption><thead><tr>${Array.from({ length: 12 }, (_, i) => `<th>Column ${i + 1}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: 5 }, (_, row) => `<tr>${Array.from({ length: 12 }, (_, col) => `<td>Cell${row}-${col}-${"W".repeat(18)}</td>`).join("")}</tr>`).join("")}</tbody></table><pre>${Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: ${"0123456789".repeat(30)}`).join("\n")}</pre>`;
  return `<p dir="rtl">سجل الحديقة: سارت القافلة نحو النهر. <bdi dir="ltr">Field record 42 (east)</bdi> ثم عادت إلى البيت.</p><p>Mixed Unicode: café, 日本語, Ελληνικά, e&#x301;, 🧭. <ruby>川<rt>かわ</rt></ruby></p><p style="writing-mode:vertical-rl;height:140px">川の観察記録。春の小道。</p>${note}`;
}

/** Original, deterministic EPUB3 sources; ZIP timestamps are normalized too. */
export function generateContentStressFixture(directory: string, variation: ContentStressCase) {
  const root = path.resolve(directory);
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "META-INF"), { recursive: true });
  fs.mkdirSync(path.join(source, "EPUB"), { recursive: true });
  const targets: StressTarget[] = Array.from(
    { length: variation.chapters * variation.sections },
    (_, i) => {
      const chapter = Math.floor(i / variation.sections) + 1;
      const id = variation.unicode ? `節-${i + 1}-café-ملاحظة` : `section-${i + 1}`;
      return {
        chapter,
        id,
        label: `Record ${String(i + 1).padStart(4, "0")}`,
        href: `ch${chapter}.xhtml#${variation.encoded ? encodeURIComponent(id) : id}`,
      };
    },
  );
  const navItem = (target: StressTarget, children = "") =>
    `<li><a href="${xml(target.href)}">${target.label}</a>${children ? `<ol>${children}</ol>` : ""}</li>`;
  const depth = Math.min(variation.depth, targets.length);
  let nested = "";
  for (let i = depth - 1; i >= 0; i--) nested = navItem(targets[i]!, nested);
  const entries: Record<string, string> = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml":
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "EPUB/nav.xhtml": document(
      "Contents",
      `<nav epub:type="toc"><ol>${nested}${targets
        .slice(depth)
        .map((t) => navItem(t))
        .join("")}</ol></nav>`,
    ),
  };
  for (let chapter = 1; chapter <= variation.chapters; chapter++) {
    entries[`EPUB/ch${chapter}.xhtml`] = document(
      `Synthetic chapter ${chapter}`,
      targets
        .filter((t) => t.chapter === chapter)
        .map(
          (target, index) =>
            `<section><h2 id="${target.id}">${target.label}</h2><p>Sentinel ${target.label}. We counted blue stones beside the river, recorded the calm weather, and followed the marked path home. This original observation belongs only to chapter ${chapter}, section ${index + 1}.</p>${index === 0 && (chapter === 1 || chapter === variation.chapters) ? specimen(variation.feature, chapter) : ""}<p>End sentinel ${target.label}.</p></section>`,
        )
        .join(""),
      variation.rtl,
    );
  }
  const assets = variation.feature === "media" ? ["transparent", "wide", "tall"] : [];
  if (assets.length) {
    entries["EPUB/transparent.svg"] =
      '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><circle cx="140" cy="120" r="95" fill="none" stroke="#305080" stroke-width="20"/><circle cx="330" cy="120" r="95" fill="#c03080" fill-opacity=".4"/></svg>';
    for (const [name, width, height] of [
      ["wide", 2400, 48],
      ["tall", 48, 2400],
    ] as const)
      entries[`EPUB/${name}.svg`] =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#008080" fill-opacity=".5"/><path d="M0 0L${width} ${height}" stroke="black" stroke-width="4"/></svg>`;
  }
  entries["EPUB/package.opf"] =
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:ambra:content-stress:${variation.id}:v1</dc:identifier><dc:title>Content stress ${variation.id}</dc:title><dc:language>${variation.rtl ? "ar" : "en"}</dc:language><meta property="dcterms:modified">2026-09-26T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${Array.from({ length: variation.chapters }, (_, i) => `<item id="c${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"${variation.feature === "media" && (i === 0 || i === variation.chapters - 1) ? ' properties="svg"' : ""}/>`).join("")}${assets.map((name) => `<item id="${name}" href="${name}.svg" media-type="image/svg+xml"/>`).join("")}</manifest><spine page-progression-direction="${variation.rtl ? "rtl" : "ltr"}">${Array.from({ length: variation.chapters }, (_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`;
  const timestamp = new Date("2026-01-01T00:00:00Z");
  for (const [name, content] of Object.entries(entries)) {
    const filename = path.join(source, name);
    fs.writeFileSync(filename, content);
    fs.utimesSync(filename, timestamp, timestamp);
  }
  const book = path.join(root, `${variation.id}.epub`);
  fs.rmSync(book, { force: true });
  for (const names of [
    ["mimetype"],
    Object.keys(entries)
      .filter((name) => name !== "mimetype")
      .sort(),
  ]) {
    execFileSync("zip", ["-q", "-X", ...(names[0] === "mimetype" ? ["-0"] : []), book, ...names], {
      cwd: source,
    });
  }
  fs.writeFileSync(
    path.join(root, "scenario.json"),
    JSON.stringify({ variation, targets }, null, 2),
  );
  return { book, targets, source };
}
