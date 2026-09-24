import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

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
