import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";

test("original W3C pub-xml-names: opening errors stay friendly and recoverable (#383)", async () => {
  const original = process.env.AMBRA_XML_NAMES_EPUB;
  test.skip(!original, "Set AMBRA_XML_NAMES_EPUB to the pinned original publication.");
  if (!original) throw new Error("The original XML-names publication path is required.");
  const { context, libraryPage } = await launchReader(navigationFixture(test.info(), [1]));
  try {
    await libraryPage.locator('input[type="file"]').setInputFiles(original);
    const [page] = await Promise.all([
      context.waitForEvent("page"),
      libraryPage.getByRole("button", { name: /^Open pub-xml-names/ }).first().click(),
    ]);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("snickerdoodles");
    await expect(alert.getByRole("link", { name: "Open library", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Contents", exact: true }).click();
    await page.getByRole("button", { name: /^Link to main page/ }).click();
    await page.waitForTimeout(8500);
    await expect(alert).toContainText("snickerdoodles");
    await alert.getByRole("link", { name: "Open library", exact: true }).click();
    await expect(page.locator('input[type="file"]')).toBeEnabled();
  } finally {
    await context.close();
  }
});

for (const scenario of ["missing-book", "invalid-content", "invalid-content-and-nav"] as const) {
  test(`${scenario}: blocking errors offer keyboard recovery to the full Library (#383)`, async () => {
    const info = test.info();
    const book = navigationFixture(info, [1]);
    const { context, libraryPage, readerPage, extensionId } = await launchReader(book);
    let page = readerPage;
    try {
      if (scenario === "missing-book") {
        await page.goto(`chrome-extension://${extensionId}/src/reader/index.html?bookId=missing`);
      } else {
        const source = info.outputPath("navigation-source");
        const opf = path.join(source, "EPUB/package.opf");
        fs.writeFileSync(
          opf,
          fs.readFileSync(opf, "utf8").replace("Navigation boundaries", "Unreadable chapter"),
        );
        fs.writeFileSync(
          path.join(source, "EPUB/c0.xhtml"),
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Invalid</title></head><body><p>Unclosed',
        );
        if (scenario === "invalid-content-and-nav") {
          fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"), '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Broken</title></head><body></body></html>');
        }
        const invalid = info.outputPath("invalid-content.epub");
        fs.copyFileSync(book, invalid);
        execFileSync("zip", ["-q", "-X", invalid, "EPUB/package.opf", "EPUB/c0.xhtml", "EPUB/nav.xhtml"], {
          cwd: source,
        });
        await libraryPage.locator('input[type="file"]').setInputFiles(invalid);
        [page] = await Promise.all([
          context.waitForEvent("page"),
          libraryPage.getByRole("button", { name: /^Open Unreadable chapter/ }).click(),
        ]);
      }
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("snickerdoodles");
      await expect(alert.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
      const recover = alert.getByRole("link", { name: "Open library", exact: true });
      await expect(recover).toHaveAttribute(
        "href",
        `chrome-extension://${extensionId}/src/library/index.html?view=tab`,
      );
      await page.keyboard.press("Tab");
      await expect(recover).toBeFocused();
      const pages = context.pages().length;
      await page.keyboard.press("Enter");
      await page.waitForURL(`chrome-extension://${extensionId}/src/library/index.html?view=tab`);
      await expect(page.locator('input[type="file"]')).toBeEnabled();
      await expect(
        page
          .getByRole("main")
          .getByRole("button", { name: /^Open Navigation boundaries/ })
          .first(),
      ).toBeVisible();
      expect(context.pages()).toHaveLength(pages);
      await expect(page.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

  for (const initiallyBroken of [false, true]) {
    test(`${initiallyBroken ? "opening" : "navigation"} failure preserves Contents recovery and previous-page dismissal (#383)`, async () => {
      const info = test.info();
      const book = navigationFixture(info, [1, 1, 1]);
      const { context, libraryPage } = await launchReader(book);
      try {
        const source = info.outputPath("navigation-source");
        const opf = path.join(source, "EPUB/package.opf");
        fs.writeFileSync(opf, fs.readFileSync(opf, "utf8").replace("Navigation boundaries", "Partly unreadable"));
        const brokenChapter = initiallyBroken ? 0 : 1;
        fs.writeFileSync(path.join(source, `EPUB/c${brokenChapter}.xhtml`),
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Invalid name</title></head><body><p::p>Invalid XML</p::p></body></html>');
        const invalid = info.outputPath("partly-unreadable.epub");
        fs.copyFileSync(book, invalid);
        execFileSync("zip", ["-q", "-X", invalid, "EPUB/package.opf", `EPUB/c${brokenChapter}.xhtml`], { cwd: source });
        await libraryPage.locator('input[type="file"]').setInputFiles(invalid);
        const [page] = await Promise.all([
          context.waitForEvent("page"),
          libraryPage.getByRole("button", { name: /^Open Partly unreadable/ }).first().click(),
        ]);
        const chapter = async (number: number) => {
          await page.getByRole("button", { name: "Contents", exact: true }).click();
          await page.getByRole("button", { name: new RegExp(`^Chapter ${number}(,|$)`) }).click();
        };
        if (!initiallyBroken) await chapter(2);
        const alert = page.getByRole("alert");
        await expect(alert).toContainText("snickerdoodles");
        await expect(alert.getByRole("link", { name: "Open library", exact: true })).toBeVisible();
        await page.waitForTimeout(8500);
        await expect(alert).toContainText("snickerdoodles");
        await expect(page.getByRole("button", { name: "Contents", exact: true })).toHaveCSS("pointer-events", "auto");
        if (!initiallyBroken) {
          await alert.getByRole("button", { name: "Dismiss", exact: true }).click();
          await expect(alert).toHaveCount(0);
          await expect(page.getByRole("main").locator("iframe").first()).toBeFocused();
          await chapter(2);
          await expect(alert).toContainText("snickerdoodles");
        }
        await chapter(3);
        await expect(alert).toHaveCount(0);
        await expect.poll(() => page.getByRole("main").locator("iframe").first().evaluate(frame =>
          (frame as HTMLIFrameElement).contentDocument?.querySelector("text")?.textContent,
        )).toBe("C3Para 1.");
        await chapter(brokenChapter + 1);
        await expect(alert).toContainText("snickerdoodles");
        await alert.getByRole("link", { name: "Open library", exact: true }).click();
        await expect(page.locator('input[type="file"]')).toBeEnabled();
      } finally {
        await context.close();
      }
    });
  }
