import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader, clickReadingPage } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

// W3C/IDPF sample: full text, recorded overlays for chapters 1-2.
// Keep third-party binaries outside source control; see its CC BY-SA license.
const sample = process.env.AMBRA_MEDIA_OVERLAY_BOOK
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../real-books/moby-dick-mo.epub");

const samples = [
  { title: "Moby-Dick", file: sample, opening: /Call|me|Ishmael|years|ago/i },
  {
    title: "ReadBeyond A Horseman in the Sky",
    file: process.env.AMBRA_READBEYOND_BOOK,
    opening: /\S/,
  },
];

for (const book of samples) {
  test(`real ${book.title} narration starts at narrated content and follows reading navigation`, async () => {
    test.skip(!book.file || !existsSync(book.file), "Set the corresponding external narrated-book sample path.");
    const { context, readerPage: page } = await launchReader(book.file!);
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await exposeReaderController(page);
      const startsWithNarration = await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return !!c.pkg.spine[c.snapshot().spineIndex].manifestItem.mediaOverlayId;
      });
      const listen = page.getByRole("button", { name: "Play narration", exact: true });
      await listen.focus();
      await listen.click();
      const audio = page.locator("audio[data-ambra-narration-audio]");
      if (!startsWithNarration) {
        await expect(page.locator("[data-narration-controls]"))
          .toContainText("There is no recorded narration at this reading position.");
        expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
        await page.evaluate(async () => {
          const c = Reflect.get(window, "__readerController");
          const narrated = c.pkg.spine.find((ref: { manifestItem: { mediaOverlayId?: string } }) =>
            ref.manifestItem.mediaOverlayId,
          );
          if (!narrated) throw new Error("The external sample has no narrated spine document.");
          await c.goToNavPoint({ path: narrated.manifestItem.path });
        });
        await listen.click();
      }
      await expect.poll(() => audio.evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0.2);
      const activeText = () => page.evaluate(() => Array.from(document.querySelectorAll("iframe"))
        .flatMap(frame => Array.from(frame.contentDocument?.querySelectorAll(".-epub-media-overlay-active") ?? []))
        .map(element => element.textContent).join(" "));
      await expect.poll(activeText).toMatch(book.opening);
      await expect(page.getByRole("button", { name: "Pause narration", exact: true })).toBeFocused();
      await clickReadingPage(page, "right");
      await expect(page.getByRole("button", { name: "Return to narration", exact: true })).toHaveCount(0);
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
      await page.getByRole("button", { name: "Pause narration", exact: true }).click();
      const passage = () => page.evaluate(() => {
        const cursor = Reflect.get(window, "__readerController").narration.cursor;
        return { association: cursor.association, index: cursor.index };
      });
      const before = await passage();
      await page.getByRole("button", { name: "Next narrated passage", exact: true }).click();
      await expect.poll(passage).not.toEqual(before);
      await expect.poll(() => page.evaluate(() =>
        Reflect.get(window, "__readerController").snapshot().narration.status,
      )).toBe("paused");
      expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
      const cuedTime = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
      await page.getByRole("button", { name: "Play narration", exact: true }).click();
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
      await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(cuedTime + 0.1);
      await page.screenshot({ path: test.info().outputPath("real-book-narration.png") });
    } finally {
      await context.close();
    }
  });
}
