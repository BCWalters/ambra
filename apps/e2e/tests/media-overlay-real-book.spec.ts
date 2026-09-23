import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

// W3C/IDPF sample: full text, recorded overlays for chapters 1-2.
// Keep third-party binaries outside source control; see its CC BY-SA license.
const sample = process.env.AMBRA_MEDIA_OVERLAY_BOOK
  ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../real-books/moby-dick-mo.epub");

test("real Moby-Dick narration opens from frontmatter and tracks authored phrases", async () => {
  test.skip(!existsSync(sample), "Set AMBRA_MEDIA_OVERLAY_BOOK to the W3C moby-dick-mo.epub sample.");
  const { context, readerPage: page } = await launchReader(sample);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const listen = page.getByRole("button", { name: "Listen", exact: true });
    await listen.focus();
    await listen.click();
    const audio = page.locator("audio[data-ambra-narration-audio]");
    await expect.poll(() => audio.evaluate(element => !(element as HTMLAudioElement).paused)).toBe(true);
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(0.2);
    const activeText = () => page.evaluate(() => Array.from(document.querySelectorAll("iframe"))
      .flatMap(frame => Array.from(frame.contentDocument?.querySelectorAll(".-epub-media-overlay-active") ?? []))
      .map(element => element.textContent).join(" "));
    await expect.poll(activeText).toMatch(/Call|me|Ishmael|years|ago/i);
    await expect(page.getByRole("button", { name: "Pause narration", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Pause narration", exact: true }).click();
    const time = await audio.evaluate(element => (element as HTMLAudioElement).currentTime);
    await page.getByRole("button", { name: "Next narrated passage", exact: true }).click();
    expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(true);
    await page.getByRole("button", { name: "Play narration", exact: true }).click();
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime)).toBeGreaterThan(time);
    await page.screenshot({ path: test.info().outputPath("moby-dick-narration.png") });
  } finally {
    await context.close();
  }
});
