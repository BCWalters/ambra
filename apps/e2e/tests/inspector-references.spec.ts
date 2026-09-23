import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const book = path.resolve(here, "../real-books/alice-in-wonderland.epub");

for (const standalone of [false, true]) {
  test(`${standalone ? "Library" : "reader"} Inspector help and image/CSS references`, async () => {
    const { context, readerPage, libraryPage, extensionId } = await launchReader(book, {
      viewport: { width: 1200, height: 900 },
    });
    try {
      const page = standalone ? libraryPage : readerPage;
      if (standalone) {
        await readerPage.close();
        await page.goto(`chrome-extension://${extensionId}/src/library/index.html?view=tab`);
        const details = page.getByRole("button", { name: "Alice's Adventures in Wonderland details" });
        await page.getByText("Alice's Adventures", { exact: false }).hover();
        await details.click();
      } else {
        await page.getByRole("button", { name: "Book details", exact: true }).click();
      }
      await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
      await expect(dialog).toBeVisible();
      await expect(page.getByText(/^Click or select source text/)).toHaveCount(0);
      await dialog.getByRole("button", { name: "Inspector help", exact: true }).click();
      const help = page.getByText(/^For images and CSS, Find references/);
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();
      await expect(dialog).toBeVisible();
      if (standalone) {
        await expect(dialog.getByRole("button", { name: "Show in book", exact: true })).toHaveCount(0);
      } else {
        const show = dialog.getByRole("button", { name: "Show in book", exact: true });
        const background = await show.evaluate(element => element.style.backgroundColor);
        expect(background).not.toBe("");
        expect(background).not.toBe("rgb(255, 255, 255)");
      }

      for (const asset of ["OEBPS/3809243430796983855_cover.jpg", "OEBPS/pgepub.css"]) {
        await dialog.locator(`button[data-file-path="${asset}"]`).click();
        await dialog.getByRole("button", { name: "Find references", exact: true }).click();
        const results = dialog.getByRole("region", { name: "Find references", exact: true });
        const first = results.locator("button[data-reference-source]").first();
        await expect(first).toBeVisible();
        await expect(first).toContainText(/Original source line \d+/i);
        const source = await first.getAttribute("data-reference-source");
        expect(source).toMatch(/\.(xhtml|html|svg|css)$/);
        await first.click();
        await expect(dialog.locator("pre.ambra-hljs")).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const pre = document.querySelector("pre.ambra-hljs")!;
          const range = CSS.highlights.get("ambra-inspector-source")?.values().next().value;
          return range && pre.contains(range.startContainer) ? range.toString() : "";
        })).toContain(asset.split("/").at(-1)!);
        await expect.poll(() => page.evaluate(() => {
          const pre = document.querySelector("pre.ambra-hljs")!;
          const range = CSS.highlights.get("ambra-inspector-source")?.values().next().value;
          if (!(range instanceof Range)) return false;
          const rect = range.getBoundingClientRect();
          const viewport = pre.parentElement!.getBoundingClientRect();
          return rect.bottom > viewport.top && rect.top < viewport.bottom;
        })).toBe(true);
        await dialog.getByRole("button", { name: "Back", exact: true }).click();
        await expect(results.locator("button[data-reference-source]").first()).toHaveAttribute(
          "data-reference-source", source!,
        );
      }
      await dialog.screenshot({ path: test.info().outputPath("inspector-references.png") });
    } finally {
      await context.close();
    }
  });
}
