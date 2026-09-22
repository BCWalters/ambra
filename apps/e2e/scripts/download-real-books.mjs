#!/usr/bin/env node
// Downloads a small, diverse set of real-world EPUB3 books into
// `real-books/` (gitignored — not committed, both for repo size and to
// avoid re-distributing third-party content ourselves) for the slower,
// occasional "real book" smoke suite (`tests/real-books.spec.ts`) — see
// this package's README for why that suite is kept separate from the
// synthetic-fixture-based correctness suite.
//
// Sources, deliberately all unambiguously free to use:
// - Project Gutenberg: public domain in the US (published before 1929).
// - IDPF's own official EPUB3 samples repo (github.com/IDPF/epub3-samples):
//   built specifically as open test content for reading-system developers,
//   CC-BY-SA 3.0 unless individually noted otherwise.
//
// Run manually (`node scripts/download-real-books.mjs`) — never as part
// of `test:e2e` itself, so a normal e2e run never depends on network
// access or these third-party servers being up.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "real-books");
fs.mkdirSync(outDir, { recursive: true });

const BOOKS = [
  {
    name: "alice-in-wonderland.epub",
    url: "https://www.gutenberg.org/ebooks/11.epub3.images",
    note: "Project Gutenberg #11 — a full, real reflowable novel with a real multi-chapter TOC.",
  },
  {
    name: "childrens-literature.epub",
    url: "https://github.com/IDPF/epub3-samples/releases/download/20230704/childrens-literature.epub",
    note: "IDPF EPUB3 samples — span-element nav headings, TOC in spine, hidden page-list.",
  },
  {
    name: "accessible-epub-3.epub",
    url: "https://github.com/IDPF/epub3-samples/releases/download/20230704/accessible_epub_3.epub",
    note: "IDPF EPUB3 samples — authored specifically to exercise accessibility strategies.",
  },
  {
    name: "israel-sailing.epub",
    url: "https://github.com/IDPF/epub3-samples/releases/download/20230704/israelsailing.epub",
    note: "IDPF EPUB3 samples — BIDI/RTL Hebrew content, page-progression-direction: rtl.",
  },
  {
    name: "internal-links.epub",
    url: "https://github.com/IDPF/epub3-samples/releases/download/20230704/internallinks.epub",
    note: "IDPF EPUB3 samples — dedicated internal-hyperlink-navigation test document.",
  },
  {
    name: "frankenstein.epub",
    url: "https://www.gutenberg.org/ebooks/84.epub3.images",
    note:
      "Project Gutenberg #84 — a chain of several very short front-matter " +
      "spine items (a single-page cover, a two-page title/boilerplate " +
      "page, a one-page contents list) right before the real chapters, " +
      "which exposed issue #120: navigating backward across more than " +
      "one merged single-page chapter in a row landed on a stale, " +
      "incorrectly re-paginated spread instead of the book's own true " +
      "start.",
  },
  // "linear-algebra.epub" (Robert Beezer's "A First Course in Linear
  // Algebra", GNU FDL) is deliberately *not* listed here — it's the
  // MathML-dense textbook that exposed issue #102's pagination
  // performance cliff, and no stable, directly-downloadable EPUB URL
  // for the exact 2.30 build could be confirmed from this environment
  // (the book's own site, linear.ups.edu, mainly distributes PDF/HTML;
  // archive.org only has newer 3.50-series uploads). If you have a copy
  // (this exact filename, from the reported issue), just drop it in
  // `real-books/` by hand — `real-books.spec.ts`'s smoke test and
  // `mathml-perf.spec.ts`'s issue #102 regression test both already
  // reference it and skip gracefully when it's absent.
];

for (const book of BOOKS) {
  const dest = path.join(outDir, book.name);
  if (fs.existsSync(dest)) {
    console.log(`skip (already downloaded): ${book.name}`);
    continue;
  }
  console.log(`downloading ${book.name} ← ${book.url}`);
  const response = await fetch(book.url, { redirect: "follow" });
  if (!response.ok) {
    console.error(`  failed: HTTP ${response.status}`);
    continue;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  console.log(`  saved ${buffer.length} bytes — ${book.note}`);
}
console.log("Done.");
