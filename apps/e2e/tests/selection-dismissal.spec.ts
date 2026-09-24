import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader, outerMarginPoint } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const width of [760, 1400]) {
  test(`${width}px: dismissing a selection does not turn a page (#148)`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.resolve(here, "../fixtures/two-chapter.epub"),
      { viewport: { width, height: 900 } },
    );
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const position = async () => (await currentPageLabel(page))?.match(/^Page \d+/)?.[0];
      await expect.poll(position).toBeTruthy();
      const before = await position();
      const margin = await outerMarginPoint(page);
      await page.evaluate(() => {
        const doc = document.querySelector("iframe")!.contentDocument!;
        const range = doc.createRange();
        range.selectNodeContents(doc.querySelector("p")!);
        doc.getSelection()!.removeAllRanges();
        doc.getSelection()!.addRange(range);
      });

      await page.mouse.click(margin.x, margin.y);
      await page.waitForTimeout(300);
      expect(await position()).toBe(before);
      expect(await page.evaluate(() => Array.from(document.querySelectorAll("iframe"))
        .every(frame => frame.contentDocument?.getSelection()?.isCollapsed !== false))).toBe(true);

      await page.mouse.click(margin.x, margin.y);
      await expect.poll(position).not.toBe(before);
    } finally {
      await context.close();
    }
  });
}
