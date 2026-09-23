import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("pointer bookmarking lets chrome hide without hiding keyboard focus (#147)", async () => {
  const { context, readerPage: page } = await launchReader(
    path.resolve(here, "../fixtures/two-chapter.epub"),
    { viewport: { width: 760, height: 900 } },
  );
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const bookmark = page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ });
    const opacity = () => bookmark.evaluate(element => getComputedStyle(element.parentElement!).opacity);
    await bookmark.click();
    await expect(bookmark).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(380, 450);
    await expect.poll(opacity).toBe("0");

    await bookmark.focus();
    await bookmark.press("Enter");
    await expect(bookmark).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(3000);
    await expect(bookmark).toBeFocused();
    expect(await opacity()).toBe("1");
  } finally {
    await context.close();
  }
});
