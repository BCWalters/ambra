import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("annotation actions stay behind reader panels (#149)", async () => {
  const { context, readerPage: page } = await launchReader(
    path.resolve(here, "../fixtures/two-chapter.epub"),
    { viewport: { width: 1400, height: 900 } },
  );
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("p")!);
      doc.getSelection()!.addRange(range);
      doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    const actions = page.getByRole("toolbar", { name: "Highlight this selection" });
    await expect(actions).toBeVisible();
    const contents = page.getByRole("button", { name: "Show contents", exact: true });
    await contents.focus();
    await contents.click();
    await expect(page.getByRole("button", { name: "Pin contents panel", exact: true })).toBeVisible();
    await expect.poll(() => actions.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(false);
  } finally {
    await context.close();
  }
});
