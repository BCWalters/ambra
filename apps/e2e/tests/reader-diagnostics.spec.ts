import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
async function report(page: Page): Promise<string> {
  return page.evaluate(() => Reflect.get(window, "__readerController").getDiagnosticsText());
}
async function reveal(page: Page) {
  await page.mouse.move(10, 2);
  await expect(page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
    .locator("..")).toHaveCSS("pointer-events", "auto");
}

test("diagnostics identify panel/dialog modes and settings, and copy all 500 retained events (#177)", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.waitForFunction(() => {
      const c = Reflect.get(window, "__readerController");
      return c?.host && !c.isLoadInFlight && !c.isTurningPage && !c.isApplyingLayout && !c.pendingLayout;
    });
    for (const [name, surface] of [
      ["Show contents", "toc"], ["Bookmarks and highlights", "annotations"],
      ["Search", "search"], ["Book details", "details"],
    ] as const) {
      await reveal(page);
      await page.getByRole("button", { name, exact: true }).click();
      await expect.poll(() => report(page)).toContain(`surface ${surface} opened`);
      await page.keyboard.press("Escape");
      await expect.poll(() => report(page)).toContain(`surface ${surface} closed`);
    }

    const mod = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
    for (const [label, mode] of [["Page", "page"], ["Percentage", "percentage"]] as const) {
      await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
      await page.keyboard.press(`${mod}+${mode === "percentage" ? "Shift+" : ""}g`);
      await expect(page.getByRole("dialog", { name: `Go to ${label}`, exact: true })).toBeVisible();
      await expect.poll(() => report(page)).toContain(`surface go-to opened mode=${mode}`);
      await page.keyboard.press("Escape");
      await expect.poll(() => report(page)).toContain(`surface go-to closed mode=${mode}`);
    }
    await page.evaluate(async () => {
      await Reflect.get(window, "__readerController").setBrightness(0.8);
    });
    await expect.poll(() => report(page)).toContain('setting requested name="brightness" before=1 after=0.8');

    await reveal(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("menuitem", { name: "Help & About", exact: true }).click();
    const help = page.getByRole("dialog", { name: "Help & About", exact: true });
    await expect(help).toBeVisible();
    await expect.poll(() => report(page)).toContain("surface help opened");
    // Capture only the explicitly requested clipboard write, not the OS clipboard.
    // Seed more than the cap after UI settling to prove neither export nor Copy
    // has the previous 100-entry limitation.
    const generated = await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => { Reflect.set(window, "__copiedDiagnostics", text); },
      });
      const c = Reflect.get(window, "__readerController");
      for (let index = 0; index < 510; index++) {
        c.recordDiagnosticEvent({ kind: "search", queryLength: 10000 + index });
      }
      return c.getDiagnosticsText() as string;
    });
    expect(generated).toContain("retained 500/500");
    expect(generated).not.toContain("queryLength=10009");
    expect(generated).toContain("queryLength=10010");
    expect(generated).toContain("queryLength=10509");
    expect(generated.match(/\] search queryLength=/g)).toHaveLength(500);
    await help.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__copiedDiagnostics"))).toContain("queryLength=10509");
    const copied = await page.evaluate(() => Reflect.get(window, "__copiedDiagnostics") as string);
    expect(copied.match(/\] search queryLength=/g)).toHaveLength(500);
    expect(copied).toContain("queryLength=10010");
    expect(copied).toContain("review before sharing");
    expect(copied.length).toBeLessThan(310000);
  } finally {
    await context.close();
  }
});
