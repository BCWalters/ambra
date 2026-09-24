import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const modes = [
  ["dock-left", "Dock left"],
  ["dock-right", "Dock right"],
  ["fullscreen", "Full screen"],
  ["popover", "Popover view"],
] as const;

async function settle(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    return !!c?.host && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout && !c.isTurningPage;
  })).toBe(true);
}

test("Inspector modes preserve source state, share the viewport, and never close on Show in book", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    await page.getByRole("button", { name: "Book details", exact: true }).click();
    await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await expect(inspector).toHaveAttribute("data-inspector-view", "popover");
    const source = inspector.locator("pre.ambra-hljs");
    await expect(source).toContainText("CHAPTER ONE");
    for (const [mode, label] of modes) {
      await source.evaluate(node => { node.dataset.mountIdentity = "same-source"; });
      const control = inspector.getByRole("button", { name: label, exact: true });
      await control.click();
      await expect(control).toHaveAttribute("aria-pressed", "true");
      await expect(inspector).toHaveAttribute("data-inspector-view", mode);
      await expect(source).toHaveAttribute("data-mount-identity", "same-source");
      await expect(source).toContainText("CHAPTER ONE");
      await settle(page);
      await page.screenshot({ path: test.info().outputPath(`inspector-${mode}.png`) });
      const main = page.getByRole("main", { name: "Book content", exact: true });
      if (mode.startsWith("dock-")) {
        await expect.poll(async () => {
          const pane = await main.boundingBox();
          const dock = await inspector.boundingBox();
          if (!pane || !dock) return false;
          return mode === "dock-left"
            ? Math.abs(pane.x - dock.x - dock.width) < 2
            : Math.abs(pane.x + pane.width - dock.x) < 2;
        }).toBe(true);
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").width)).toBe(840);
        expect(await inspector.getAttribute("aria-modal")).not.toBe("true");
      }
      await inspector.locator('button[data-file-path="OEBPS/ch2.xhtml"]').click();
      await expect(source).toContainText("CHAPTER TWO");
      await inspector.getByRole("button", { name: "Show in book", exact: true }).click();
      await expect(inspector).toBeVisible();
      await expect(inspector).toHaveAttribute("data-inspector-view", mode === "fullscreen" ? "popover" : mode);
      await expect.poll(() => page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return c.snapshot().spineIndex;
      })).toBe(1);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME");
      await expect(source).toContainText("CHAPTER TWO");
      if (mode === "dock-left" || mode === "dock-right") {
        await page.keyboard.press("Alt+PageUp");
        await expect.poll(() => page.evaluate(() =>
          Reflect.get(window, "__readerController").snapshot().spineIndex)).toBe(0);
        await expect(inspector).toBeVisible();
      }
      await inspector.locator('button[data-file-path="OEBPS/ch1.xhtml"]').click();
      await expect(source).toContainText("CHAPTER ONE");
    }
    await inspector.getByRole("button", { name: "Dock right", exact: true }).click();
    await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
    await expect(inspector).toBeHidden();
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").width)).toBe(1400);
  } finally {
    await context.close();
  }
});

test("docked Inspector fits a narrow viewport and remains keyboard dismissible", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 760, height: 900 },
  });
  try {
    await page.getByRole("button", { name: "Book details", exact: true }).click();
    await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
    await inspector.getByRole("button", { name: "Dock left", exact: true }).click();
    await page.setViewportSize({ width: 400, height: 800 });
    await expect.poll(() => inspector.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    for (const [, label] of modes) {
      await expect(inspector.getByRole("button", { name: label, exact: true })).toBeInViewport();
    }
    await page.screenshot({ path: test.info().outputPath("inspector-narrow-dock.png") });
    await inspector.getByRole("button", { name: "Dock left", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();
  } finally {
    await context.close();
  }
});
