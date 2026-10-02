import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("prototype toolbar ordering, responsive labels, stacked title, and system typography", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    const family = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      document.body.append(probe);
      const resolved = getComputedStyle(probe).fontFamily;
      probe.remove();
      return resolved;
    });
    for (const surface of [page, libraryPage]) {
      await expect(surface.locator(".fui-FluentProvider").first()).toHaveCSS("font-family", family);
      await expect(surface.locator(".fui-FluentProvider").first()).toHaveCSS("line-height", "21px");
    }
    await page.bringToFront();
    const publication = page.frameLocator("iframe").first().locator("body");
    const publicationFont = await publication.evaluate(element => getComputedStyle(element).fontFamily);
    const contents = page.getByRole("button", { name: "Show contents", exact: true });
    const toolbar = contents.locator("..");
    for (const width of [1400, 900, 801, 800, 600, 320, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      await contents.focus();
      await expect(toolbar).toHaveCSS("opacity", "1");
      const buttons = toolbar.getByRole("button");
      expect(await buttons.evaluateAll(elements => elements
        .filter(element => !element.closest("[data-ambra-toolbar-title]"))
        .map(element => element.getAttribute("aria-label")))).toEqual([
        "Show contents", "Library", "Search", "Text and page options", "Annotations",
        "Book details", "Ambra settings", "Help & About", "Bookmark this page",
      ]);
      for (const button of await buttons.all()) await expect(button).toBeInViewport({ ratio: 1 });
      const annotations = toolbar.getByRole("button", { name: "Annotations", exact: true });
      const label = annotations.getByText("Annotations", { exact: true });
      if (width > 800) {
        await expect(label).toBeVisible();
        await expect(annotations).toHaveCSS("font-size", "14px");
      } else {
        await expect(label).toBeHidden();
      }
      await expect(annotations).toHaveCSS("font-family", family);
      await expect(annotations).toHaveCSS("font-weight", "550");
      const title = page.locator("[data-ambra-toolbar-title]");
      if (await title.isVisible()) {
        await expect(title).toHaveCSS("flex-direction", "column");
        const titleBox = (await title.getByRole("button").boundingBox())!;
        const chapter = title.getByText("Chapter One", { exact: true });
        const chapterBox = (await chapter.boundingBox())!;
        expect(chapterBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
        await expect(chapter).toHaveText("Chapter One");
        await expect(chapter).toBeInViewport({ ratio: 1 });
        expect(chapterBox.y + chapterBox.height).toBeLessThanOrEqual(56);
      }
      expect(await toolbar.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 320 || width === 900) {
        await page.screenshot({ path: test.info().outputPath(`toolbar-${width}.png`) });
      }
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(publication).toHaveCSS("font-family", publicationFont);
    const settings = toolbar.getByRole("button", { name: "Ambra settings", exact: true });
    await settings.click();
    await expect(page.getByRole("dialog", { name: "Ambra settings", exact: true })).toHaveCSS("font-family", family);
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
  } finally {
    await context.close();
  }
});

for (const resume of [false, true]) {
  test(`toolbar publishes only the resolved ${resume ? "resume" : "initial"} chapter without sliding (#175)`, async () => {
    const { context, readerPage } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
    try {
      await exposeReaderController(readerPage);
      await readerPage.evaluate(async (resume) => {
        const controller = Reflect.get(window, "__readerController");
        if (resume) await controller.goToChapter(1);
        await controller.flushProgress();
      }, resume);
      await readerPage.addInitScript(() => {
        const observations: { text: string; left: string; transition: string }[] = [];
        Reflect.set(window, "__toolbarStartup", observations);
        new MutationObserver(() => {
          const title = document.querySelector<HTMLElement>("[data-ambra-toolbar-title]");
          if (!title) return;
          const state = {
            text: title.textContent ?? "",
            left: title.style.left,
            transition: getComputedStyle(title).transitionDuration,
          };
          if (JSON.stringify(observations.at(-1)) !== JSON.stringify(state)) observations.push(state);
        }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      await readerPage.reload();
      const title = readerPage.locator("[data-ambra-toolbar-title]");
      const chapter = resume ? "Chapter Two" : "Chapter One";
      await expect(title).toContainText(chapter);
      await expect(title).toHaveCSS("transition-duration", "0s");
      const observations = await readerPage.evaluate(() =>
        Reflect.get(window, "__toolbarStartup") as { text: string; left: string; transition: string }[],
      );
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every(state => state.transition === "0s")).toBe(true);
      expect(observations.every(state => state.left === "50%")).toBe(true);
      expect(observations.every(state => !state.text.includes(resume ? "Chapter One" : "Chapter Two"))).toBe(true);
      expect(observations.every(state => !state.text.trim().endsWith("—"))).toBe(true);
    } finally {
      await context.close();
    }
  });
}

test("pending scrubber seeks keep destination text without a visual progress caption (#176)", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    await readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.seekToFraction = () => new Promise<void>(resolve => {
        Reflect.set(window, "__completeTestSeek", resolve);
      });
    });
    await readerPage.mouse.move(450, 880);
    const slider = readerPage.getByRole("slider", { name: "Position in book", exact: true });
    await slider.focus();
    await readerPage.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", /^Going to position…:/);
    await expect(readerPage.getByText("Going to position…", { exact: true })).toHaveCount(0);
    await expect(readerPage.locator('[title="Chapter Two"]')).toBeVisible();
    await readerPage.evaluate(() => Reflect.get(window, "__completeTestSeek")());
    await expect(slider).not.toHaveAttribute("aria-valuetext", /^Going to position…:/);
    await expect(readerPage.locator('[title="Chapter Two"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
