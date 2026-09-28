import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const controller = Reflect.get(window, "__readerController");
    return controller?.snapshot().bookPageCount > 0 && !controller.isLoadInFlight &&
      !controller.isTurningPage && !controller.isApplyingLayout && !controller.pendingLayout;
  });
}

test("scrubber chapter labels follow destination fragments rather than the open page", async () => {
  const info = test.info();
  const book = navigationFixture(info, [24, 4]);
  const source = info.outputPath("navigation-source");
  const contentPath = path.join(source, "EPUB/c0.xhtml");
  let index = 0;
  fs.writeFileSync(contentPath, fs.readFileSync(contentPath, "utf8").replace(
    /<svg /g, () => `<svg id="section-${index++}" `,
  ));
  fs.writeFileSync(path.join(source, "EPUB/nav.xhtml"),
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><ol>
${[0, 6, 12, 18].map((page, section) => `<li><a href="c0.xhtml#section-${page}">Section ${section + 1}</a></li>`).join("")}
<li><a href="c1.xhtml">Afterword</a></li></ol></nav></body></html>`);
  execFileSync("zip", ["-q", "-X", "-r", book, "EPUB"], { cwd: source });
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    await settled(page);
    const slider = page.getByRole("slider", { name: "Position in book", exact: true });
    // Exercise both a loaded destination document and an unloaded one.
    for (const origin of [0.1, 0.65, 0.95]) {
      await page.evaluate(async fraction => Reflect.get(window, "__readerController").seekToFraction(fraction), origin);
      await settled(page);
      const destinations = await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const state = controller.snapshot();
        return (state.toc as { target: string; label: string }[]).slice(0, 4).map(point => {
          const target = (state.tocPageNumbers.get(point.target) as number) + 1;
          return {
            label: point.label, fraction: target / state.bookPageCount,
            preview: controller.previewSeek(target / state.bookPageCount).chapterLabel as string,
          };
        });
      });
      expect(destinations).toHaveLength(4);
      for (const destination of destinations) expect(destination.preview).toBe(destination.label);
      const before = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex as number);
      await slider.focus();
      const track = (await slider.boundingBox())!;
      await page.mouse.move(track.x + track.width * destinations[2]!.fraction, track.y + track.height / 2);
      await page.mouse.down();
      try {
        await expect(page.locator("[data-scrubber-preview]")).toContainText("Section 3");
        await page.keyboard.press("Escape");
      } finally { await page.mouse.up(); }
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex as number)).toBe(before);
    }
  } finally { await context.close(); }
});
