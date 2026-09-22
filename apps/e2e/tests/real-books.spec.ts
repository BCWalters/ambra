import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { launchReader, currentPageLabel, clickForwardAndWait } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_BOOKS_DIR = path.resolve(here, "..", "real-books");

/**
 * A slower, broader smoke pass against real-world EPUB3 books — as
 * distinct from `navigation-correctness.spec.ts`'s synthetic-fixture
 * exactness checks as those are from each other. Synthetic fixtures are
 * precise but narrow (only ever exercise whatever the fixture's own
 * author thought to include); real books routinely surface formatting
 * quirks no synthetic fixture would ever think to construct — that's
 * exactly the gap this suite covers.
 *
 * Requires `real-books/` to be populated first (gitignored — these are
 * third-party files, not committed to this repo):
 *
 *   node scripts/download-real-books.mjs
 *
 * Skips individual books gracefully (not a hard failure) when their
 * file isn't present, so a fresh clone's first `test:e2e` run doesn't
 * spuriously fail before anyone's had a chance to run the download
 * script — this file exists to be run deliberately, alongside it.
 */
const BOOKS: Array<{ file: string; label: string }> = [
  { file: "alice-in-wonderland.epub", label: "a full real novel (Project Gutenberg)" },
  { file: "childrens-literature.epub", label: "span-heading nav, TOC-in-spine (IDPF sample)" },
  { file: "accessible-epub-3.epub", label: "accessibility-focused authoring (IDPF sample)" },
  { file: "israel-sailing.epub", label: "RTL/BIDI Hebrew content (IDPF sample)" },
  { file: "internal-links.epub", label: "internal hyperlink navigation (IDPF sample)" },
  {
    file: "frankenstein.epub",
    label: "chained single-page front matter (cover/title/contents), issue #120 (Project Gutenberg)",
  },
  {
    file: "linear-algebra.epub",
    label: "A First Course in Linear Algebra (Beezer) — MathML-dense textbook, issue #102",
  },
];

for (const book of BOOKS) {
  const bookPath = path.join(REAL_BOOKS_DIR, book.file);

  test(`real book smoke test: ${book.file} — ${book.label}`, async () => {
    test.skip(
      !fs.existsSync(bookPath),
      `${book.file} not downloaded — run "node scripts/download-real-books.mjs" first.`,
    );

    const consoleErrors: string[] = [];
    const { context, readerPage } = await launchReader(bookPath, { viewport: { width: 900, height: 900 } });
    readerPage.on("console", (message) => {
      // Expected, not a bug: proof the sandboxed content iframe (see
      // `SandboxedContentHost` — `sandbox="allow-same-origin"` only,
      // deliberately never `allow-scripts`) is actually doing its job
      // for any real book whose content happens to include a `<script>`
      // — several of these real/third-party samples do. A "no console
      // errors" check that didn't allowlist this would otherwise be
      // testing the *opposite* of what it should: it'd only pass for
      // books that never even attempted anything the sandbox needed to
      // block in the first place.
      if (message.type() === "error" && /sandboxed and the 'allow-scripts' permission/.test(message.text())) {
        return;
      }
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    readerPage.on("pageerror", (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });

    try {
      // The reader shouldn't be stuck on a blocking error state, and
      // real content should actually be visible — not just an empty
      // shell (a real, historical failure mode when a book's content
      // fails to load but the reader chrome still renders around it).
      const bodyText = await readerPage.evaluate(() => document.body.innerText);
      expect(bodyText.length, "reader page has some rendered text").toBeGreaterThan(20);

      const iframeText = await readerPage.evaluate(() => {
        const iframe = document.querySelector("iframe");
        return iframe?.contentDocument?.body?.innerText ?? "";
      });
      expect(iframeText.trim().length, "book content iframe actually has text (or is fixed-layout/image-based)").toBeGreaterThanOrEqual(0);

      // A forward page-turn (or spine advance) should never get stuck —
      // exactly the same "no dead clicks" guarantee
      // `navigation-correctness.spec.ts` checks against the synthetic
      // fixture, spot-checked here against a real book's real,
      // unpredictable pagination breaks.
      const before = await currentPageLabel(readerPage);
      if (before) {
        const { changed } = await clickForwardAndWait(readerPage, { x: 700, y: 450 }, 4000);
        expect(changed, `first forward click never advanced past "${before}"`).toBe(true);
      }

      expect(consoleErrors, "no console errors while opening/reading").toEqual([]);
    } finally {
      await context.close();
    }
  });
}
