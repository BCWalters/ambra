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
// Tooltip layout needs archive paths, not Alice's particular cross-references.
const TOOLTIP_EPUB = path.resolve(here, "..", "fixtures", "two-chapter.epub");

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
  test("ordinary Files and selected-path tooltips have no artificial scrollbar (#181)", async () => {
    const { context, readerPage } = await launchReader(TOOLTIP_EPUB, { viewport: { width: 1000, height: 800 } });
    try {
      await readerPage.mouse.move(350, 2);
      await openInspector(readerPage);
      const dialog = readerPage.getByRole("dialog", { name: "EPUB Inspector", exact: true });
      const file = dialog.locator("[data-file-path]").first();
      const path = (await file.getAttribute("data-file-path"))!;
      await file.click();
      const labels = dialog.getByLabel(path, { exact: true });
      await expect(labels).toHaveCount(2);
      for (const label of await labels.all()) {
        await readerPage.mouse.move(0, 0);
        await label.hover();
        const tooltip = readerPage.getByRole("tooltip").filter({ hasText: path });
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText(path);
        expect(await tooltip.evaluate(element => ({
          horizontal: element.scrollWidth - element.clientWidth,
          vertical: element.scrollHeight - element.clientHeight,
          childCount: element.children.length,
        }))).toEqual({ horizontal: 0, vertical: 0, childCount: 0 });
      }
    } finally {
      await context.close();
    }
  });

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
      await readerPage.getByRole("button", { name: "Back", exact: true }).click();
      await expect(readerPage.getByRole("tab", { name: /Spine/ })).toHaveAttribute("aria-selected", "true");

      await readerPage.getByRole("tab", { name: /Manifest/ }).click();
      await expect(readerPage.getByRole("button", { name: "OEBPS/content.opf" }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`Inspector keeps its accessibility scope through delayed flyout focus (${reducedMotion})`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { context, readerPage } = await launchReader(EPUB, {
        viewport: { width: 1400, height: 900 },
      });
      try {
        await readerPage.emulateMedia({ reducedMotion });
        await openInspector(readerPage);
        const dialog = readerPage.getByRole("dialog", { name: "EPUB Inspector", exact: true });
        const close = dialog.getByRole("button", { name: "Close EPUB Inspector", exact: true });
        await expect(dialog).toHaveAttribute("aria-modal", "true");
        await expect(close).toBeFocused();

        await dialog.getByRole("tab", { name: /Spine/ }).click();
        await dialog.locator("tbody tr").first().getByRole("button").click();
        await dialog.getByRole("button", { name: "Back", exact: true }).click();
        const manifest = dialog.getByRole("tab", { name: /Manifest/ });
        await manifest.click();
        // The old Book Details focus retry fired at 350ms and hid this
        // still-painted dialog from the accessibility tree.
        await readerPage.waitForTimeout(450);
        await expect(manifest).toBeFocused();
        await expect(dialog.getByRole("button", { name: "OEBPS/content.opf", exact: true })).toBeVisible();
        await expect(readerPage.getByRole("main", { name: "Book content" })).toHaveCount(0);

        await dialog.getByRole("button").last().focus();
        await readerPage.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await readerPage.screenshot({
          path: testInfo.outputPath(`inspector-accessible-${reducedMotion}.png`),
        });
        await readerPage.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        const trigger = readerPage.getByRole("button", { name: "EPUB Inspector", exact: true });
        await expect(trigger).toBeFocused();
        await trigger.press("Enter");
        await expect(close).toBeFocused();
        await close.click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      } finally {
        await context.close();
      }
    });
  }

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

      await readerPage.getByRole("button", { name: "Back", exact: true }).click();
      await expect.poll(() => selectedFilePath(readerPage)).toBe(frontMatterPath);
      const sourceLink = readerPage.locator('.ambra-navlink[data-nav-path="OEBPS/pgepub.css"]');
      await sourceLink.focus();
      await sourceLink.press("Space");
      await expect(readerPage.locator('button[data-file-path="OEBPS/pgepub.css"]')).toBeFocused();
      await readerPage.getByRole("button", { name: "Back", exact: true }).press("Enter");
      await expect(readerPage.getByRole("tab", { name: /^Files/ })).toBeFocused();
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

test.describe("EPUB Inspector spine properties (issue #96)", () => {
  // A fixed-layout fixture whose every spine `<itemref>` carries an
  // explicit `page-spread-left`/`page-spread-right` property — exactly
  // the kind of per-itemref metadata the Spine tab previously discarded
  // (it already parses `SpineItemRef.properties` internally to drive
  // spread placement; it just never surfaced the values themselves).
  const FXL_SPREAD_EPUB = path.resolve(here, "..", "fixtures", "fxl-spread-ltr.epub");

  test("the Spine tab's Properties column shows each itemref's own page-spread-* property", async () => {
    const { context, readerPage } = await launchReader(FXL_SPREAD_EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);
      await readerPage.getByRole("tab", { name: /Spine/ }).click();

      const rows = await readerPage.locator("tbody tr").all();
      const properties = await Promise.all(rows.map((row) => row.locator("td").last().textContent()));
      expect(properties).toEqual([
        "page-spread-right",
        "page-spread-left",
        "page-spread-right",
        "page-spread-left",
        "page-spread-right",
      ]);
    } finally {
      await context.close();
    }
  });

  test("a spine itemref with no properties renders an empty Properties cell rather than a placeholder", async () => {
    // This reflowable book's spine declares no page-spread/rendition
    // properties on any itemref — the column should just be blank, the
    // same convention the Manifest tab's own Properties column already
    // uses for manifest items with no properties.
    const { context, readerPage } = await launchReader(EPUB, { viewport: { width: 1400, height: 900 } });
    try {
      await openInspector(readerPage);
      await readerPage.getByRole("tab", { name: /Spine/ }).click();

      const firstRowProperties = await readerPage.locator("tbody tr").first().locator("td").last().textContent();
      expect(firstRowProperties).toBe("");
    } finally {
      await context.close();
    }
  });
});
