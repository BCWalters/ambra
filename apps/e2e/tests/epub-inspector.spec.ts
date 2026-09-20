import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// A real Gutenberg book (not a synthetic fixture) — the EPUB Inspector's
// whole point is showing a book's *actual* archive structure, so this
// suite specifically wants a book with a real OPF/manifest/spine, a
// cover, an EPUB3 Nav Document, a legacy NCX kept alongside it, and a
// content document (the "front" page) that itself links to a cover
// image, several stylesheets, and every other chapter in the book —
// exactly the cross-referencing surface issue #95 added.
const EPUB = path.resolve(here, "..", "real-books", "alice-in-wonderland.epub");

async function openInspector(readerPage: import("@playwright/test").Page): Promise<void> {
  await readerPage.getByRole("button", { name: "Book details" }).click();
  await readerPage.getByRole("button", { name: /inspector/i }).click();
  await readerPage.getByRole("tab", { name: /Files/ }).waitFor();
}

function selectedFilePath(readerPage: import("@playwright/test").Page): Promise<string | null> {
  return readerPage.evaluate(() => {
    const btn = document.querySelector('button[data-file-path][style*="colorNeutralBackground1Selected"]');
    return btn?.getAttribute("data-file-path") ?? null;
  });
}

test.describe("EPUB Inspector (issue #95)", () => {
  test("the Spine and Manifest tabs link to the OPF, and each Spine row links to its own file", async () => {
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);

      await readerPage.getByRole("tab", { name: /Spine/ }).click();
      const opfLinkOnSpineTab = readerPage.getByRole("button", { name: "OEBPS/content.opf" }).first();
      await expect(opfLinkOnSpineTab).toBeVisible();
      const firstSpineRowLink = readerPage.locator("tbody tr").first().locator("button");
      const firstSpinePath = await firstSpineRowLink.textContent();
      await firstSpineRowLink.click();
      await expect(readerPage.getByRole("tab", { name: /Files/ })).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => selectedFilePath(readerPage)).toBe(firstSpinePath);

      // Back returns to the Spine tab specifically (not just "the Files
      // tab, unselected") — this is what makes the OPF/spine links safe
      // to follow at all without ever losing your place.
      await readerPage.getByRole("button", { name: "Back" }).click();
      await expect(readerPage.getByRole("tab", { name: /Spine/ })).toHaveAttribute("aria-selected", "true");

      await readerPage.getByRole("tab", { name: /Manifest/ }).click();
      await expect(readerPage.getByRole("button", { name: "OEBPS/content.opf" }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("container.xml, the OPF, the Nav Document, and the cover each get their own distinct file icon", async () => {
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);

      const iconColors = await readerPage.evaluate(() => {
        const paths = [
          "META-INF/container.xml",
          "OEBPS/content.opf",
          "OEBPS/toc.xhtml",
          "OEBPS/toc.ncx",
          "OEBPS/3809243430796983855_cover.jpg",
        ];
        return Object.fromEntries(
          paths.map((path) => {
            const button = document.querySelector(`button[data-file-path="${path}"]`);
            const icon = button?.querySelector("svg");
            return [path, icon ? getComputedStyle(icon).color : undefined];
          }),
        );
      });

      // The Nav Document (toc.xhtml, `properties="nav"`) gets the special
      // "toc" icon; the legacy NCX kept alongside it does not (it falls
      // back to the ordinary per-category markup icon) — the Nav
      // Document is the one that's actually current in an EPUB3 book.
      expect(iconColors["META-INF/container.xml"]).toBeTruthy();
      expect(iconColors["OEBPS/content.opf"]).toBeTruthy();
      expect(iconColors["OEBPS/toc.xhtml"]).toBeTruthy();
      expect(iconColors["OEBPS/3809243430796983855_cover.jpg"]).toBeTruthy();
      expect(
        new Set([
          iconColors["META-INF/container.xml"],
          iconColors["OEBPS/content.opf"],
          iconColors["OEBPS/toc.xhtml"],
          iconColors["OEBPS/3809243430796983855_cover.jpg"],
        ]).size,
        "container.xml/OPF/Nav Document/cover should each render in their own distinct color",
      ).toBe(4);
      expect(
        iconColors["OEBPS/toc.ncx"],
        "the legacy NCX (kept alongside a Nav Document) should NOT get the special TOC icon — the Nav Document does",
      ).not.toBe(iconColors["OEBPS/toc.xhtml"]);
    } finally {
      await context.close();
    }
  });

  test("an href/src inside a content document's own markup that resolves to another archive file is clickable, and Back returns to it", async () => {
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);
      const frontMatterPath = "OEBPS/8761230412384829988_11-h-0.htm.xhtml";
      await readerPage.locator(`button[data-file-path="${frontMatterPath}"]`).click();

      // The navlink-marking effect runs after the file's own async
      // load/highlight/pretty-print — wait for it rather than assuming
      // any fixed delay is enough.
      await readerPage.locator(".ambra-navlink").first().waitFor();
      const navlinkTargets = await readerPage.evaluate(() =>
        Array.from(document.querySelectorAll(".ambra-navlink")).map((el) => (el as HTMLElement).dataset.navPath),
      );
      // This book's own front-matter page links its cover image, its own
      // stylesheet, and every other chapter in the book — all genuinely
      // present archive members, so all should have been recognized.
      expect(navlinkTargets).toContain("OEBPS/3809243430796983855_cover.jpg");
      expect(navlinkTargets).toContain("OEBPS/pgepub.css");
      expect(navlinkTargets).toContain("OEBPS/8761230412384829988_11-h-1.htm.xhtml");

      await readerPage.locator('.ambra-navlink[data-nav-path="OEBPS/pgepub.css"]').click();
      await expect.poll(() => selectedFilePath(readerPage)).toBe("OEBPS/pgepub.css");

      await readerPage.getByRole("button", { name: "Back" }).click();
      await expect.poll(() => selectedFilePath(readerPage)).toBe(frontMatterPath);
    } finally {
      await context.close();
    }
  });

  test("an external href (e.g. gutenberg.org) is never linkified — only files this archive actually has", async () => {
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);
      await readerPage.locator('button[data-file-path="OEBPS/8761230412384829988_11-h-0.htm.xhtml"]').click();
      await readerPage.locator(".ambra-navlink").first().waitFor();

      const hasExternalNavlink = await readerPage.evaluate(() =>
        Array.from(document.querySelectorAll(".ambra-navlink")).some((el) =>
          (el.textContent ?? "").includes("gutenberg.org"),
        ),
      );
      expect(hasExternalNavlink).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("the full screen toggle enlarges the Inspector dialog, and toggles back off", async () => {
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);

      const widthBefore = await readerPage.evaluate(() => document.querySelector('[role="dialog"]')?.clientWidth);
      await readerPage.getByRole("button", { name: "Full screen" }).click();
      await expect
        .poll(() => readerPage.evaluate(() => document.querySelector('[role="dialog"]')?.clientWidth))
        .toBeGreaterThan(widthBefore ?? 0);

      await readerPage.getByRole("button", { name: "Exit full screen" }).click();
      await expect
        .poll(() => readerPage.evaluate(() => document.querySelector('[role="dialog"]')?.clientWidth))
        .toBe(widthBefore);
    } finally {
      await context.close();
    }
  });
});
