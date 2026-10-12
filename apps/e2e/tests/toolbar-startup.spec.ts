import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("opaque toolbar and scrubber preserve native appearance without sampling the publication backdrop", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() =>
      Reflect.get(window, "__readerController").snapshot().bookPageCount !== undefined);
    const bookmark = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ });
    const toolbar = bookmark.locator("..");
    const slider = page.getByRole("slider", { name: "Position in book" });
    const scrubber = page.locator("[data-ambra-page-band]").filter({ has: slider });
    await expect(scrubber).toHaveCount(1);
    await page.mouse.move(1399, 2);
    await slider.focus();
    for (const media of [
      { colorScheme: "light", forcedColors: "none" },
      { colorScheme: "dark", forcedColors: "none" },
      { colorScheme: "dark", forcedColors: "active" },
    ] as const) {
      await page.emulateMedia(media);
      const appearance = `${media.colorScheme}-${media.forcedColors}`;
      for (const [name, surface] of [["toolbar", toolbar], ["scrubber", scrubber]] as const) {
        await expect(surface).toHaveCSS("opacity", "1");
        await expect(surface).toHaveCSS("backdrop-filter", "none");
        await expect(surface).toHaveCSS("background-color", /^rgb\(/);
        const bounds = (await surface.boundingBox())!;
        const top = Math.max(0, bounds.y - 16);
        const clip = { ...bounds, y: top, height: Math.min(900, bounds.y + bounds.height + 16) - top };
        for (const opacity of [1, 0.5]) {
          await surface.evaluate((element, opacity) => {
            element.style.transition = "none";
            element.style.opacity = String(opacity);
            element.style.backdropFilter = "blur(12px) saturate(1.1)";
            element.style.setProperty("-webkit-backdrop-filter", "blur(12px) saturate(1.1)");
          }, opacity);
          const original = await page.screenshot({ clip, animations: "disabled" });
          await surface.evaluate(element => {
            element.style.backdropFilter = "none";
            element.style.setProperty("-webkit-backdrop-filter", "none");
          });
          const optimized = await page.screenshot({ clip, animations: "disabled" });
          const differences = await page.evaluate(async ([original, optimized]) => {
            const decode = async (encoded: string) => {
              const image = new Image();
              image.src = `data:image/png;base64,${encoded}`;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d")!;
              context.drawImage(image, 0, 0);
              return context.getImageData(0, 0, canvas.width, canvas.height).data;
            };
            const [before, after] = await Promise.all([decode(original!), decode(optimized!)]);
            if (before.length !== after.length) throw new Error("Chrome screenshot dimensions changed.");
            let changedChannels = 0;
            let maximumDifference = 0;
            let totalDifference = 0;
            for (let index = 0; index < before.length; index++) {
              if (before[index] !== after[index]) changedChannels++;
              const difference = Math.abs(before[index]! - after[index]!);
              maximumDifference = Math.max(maximumDifference, difference);
              totalDifference += difference;
            }
            return { changedChannels, maximumDifference, meanDifference: totalDifference / before.length };
          }, [original.toString("base64"), optimized.toString("base64")]);
          await test.info().attach(`${appearance}-${name}-${opacity}-original`, { body: original, contentType: "image/png" });
          await test.info().attach(`${appearance}-${name}-${opacity}-optimized`, { body: optimized, contentType: "image/png" });
          await test.info().attach(`${appearance}-${name}-${opacity}-comparison`, {
            body: JSON.stringify(differences), contentType: "application/json",
          });
          // The additional compositor surface can round an eight-bit channel by one step.
          expect(differences.maximumDifference, `${appearance} ${name} at opacity ${opacity}`).toBeLessThanOrEqual(1);
        }
        await surface.evaluate(element => {
          element.style.transition = "";
          element.style.opacity = "1";
        });
      }
    }
  } finally {
    await context.close();
  }
});

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
    const contents = page.getByRole("button", { name: "Contents", exact: true });
    const toolbar = contents.locator("..");
    for (const width of [1400, 900, 801, 800, 600, 320, 1400]) {
      await page.setViewportSize({ width, height: 900 });
      await contents.focus();
      await expect(toolbar).toHaveCSS("opacity", "1");
      const buttons = toolbar.getByRole("button");
      expect(await buttons.evaluateAll(elements => elements
        .filter(element => !element.closest("[data-ambra-toolbar-title]"))
        .map(element => element.getAttribute("aria-label")))).toEqual([
        "Contents", "Library", "Search", "Text and page options", "Annotations",
        "Book details", "Ambra settings", "Help & About", "Bookmark this page",
      ]);
      for (const button of await buttons.all()) await expect(button).toBeInViewport({ ratio: 1 });
      const annotations = toolbar.getByRole("button", { name: "Annotations", exact: true });
      await expect(annotations.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(annotations.locator("svg")).toHaveAttribute("focusable", "false");
      await expect(annotations.locator("svg path")).toHaveAttribute("d", "M5 3h14v18H5Zm4 5h6m-6 4h6m-6 4h4");
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
