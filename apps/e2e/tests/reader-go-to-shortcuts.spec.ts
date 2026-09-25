import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

async function ready(page: Page) {
  await exposeReaderController(page);
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
  });
}
async function focusBook(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    for (const view of c.contentDocumentViews()) view.document.getSelection()?.removeAllRanges();
    c.restoreContentFocus();
  });
}
async function mod(page: Page) {
  return page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
}
const dialog = (page: Page, mode: "Page" | "Percentage") =>
  page.getByRole("dialog", { name: `Go to ${mode}`, exact: true });

test("Go to shortcuts seek pages and percentages, retain focus, and explain scrolling without switching mode", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  try {
    await ready(page);
    const modifier = await mod(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
    const count = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageCount as number);
    for (const [mode, value, expectedPage] of [
      ["Page", String(count), count],
      ["Page", "1", 1],
      ["Percentage", "50", Math.max(1, Math.round(count * 0.5))],
    ] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      const modal = dialog(page, mode);
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute("aria-keyshortcuts", `${modifier}+${mode === "Percentage" ? "Shift+" : ""}G`);
      const input = modal.getByRole("spinbutton");
      await expect(input).toBeFocused();
      await input.fill(value);
      await page.screenshot({ path: info.outputPath(`go-to-${mode.toLowerCase()}-${value}.png`), animations: "disabled" });
      await input.press("Enter");
      await expect(modal).toBeHidden();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookPageIndex)).toBe(expectedPage);
      await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);
    }

    await focusBook(page);
    await page.keyboard.press(`${modifier}+g`);
    const pageInput = dialog(page, "Page").getByRole("spinbutton");
    await expect(pageInput).toBeFocused();
    await pageInput.fill(String(count + 1));
    await expect(dialog(page, "Page").getByRole("button", { name: "Go", exact: true })).toBeDisabled();
    await pageInput.press("Enter");
    await expect(dialog(page, "Page")).toBeVisible();
    await pageInput.press("Escape");
    await expect(dialog(page, "Page")).toBeHidden();

    await page.keyboard.press("Alt+Shift+PageDown");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").snapshot().viewMode)).toBe("scroll");
    await ready(page);
    for (const mode of ["Page", "Percentage"] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toContainText("Go to requires paginated mode.");
      await expect(dialog(page, mode).getByRole("spinbutton")).toHaveCount(0);
      await expect(dialog(page, mode).getByRole("button", { name: "Go", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().viewMode)).toBe("scroll");
    }

    await focusBook(page);
    await page.keyboard.press(`${modifier}+/`);
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(guide.getByText("Go to page", { exact: true })).toBeVisible();
    await expect(guide.getByText("Go to percentage", { exact: true })).toBeVisible();
    const enabled = guide.getByRole("checkbox", { name: "Enable keyboard shortcuts" });
    await enabled.click();
    await expect(guide.getByRole("status")).toHaveText("Shortcut settings saved.");
    await expect(enabled).not.toBeChecked();
    await page.keyboard.press("Escape");
    await focusBook(page);
    await page.keyboard.press(`${modifier}+g`);
    await page.keyboard.press(`${modifier}+Shift+g`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Go to leaves editing, selections, widgets, and other modals in charge of keyboard input", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    const modifier = await mod(page);
    const toolbarButton = page.getByRole("button", { name: "Book details", exact: true });
    for (const mode of ["Page", "Percentage"] as const) {
      await toolbarButton.focus();
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toBeVisible();
      await expect(dialog(page, mode).getByRole("spinbutton")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);
    }
    for (const kind of ["input", "textarea", "select", "button", "slider", "contenteditable", "selection"]) {
      await page.evaluate(kind => {
        const doc = Reflect.get(window, "__readerController").contentDocumentViews()[0].document as Document;
        doc.getSelection()?.removeAllRanges();
        doc.getElementById("goto-keyboard-owner")?.remove();
        const element = doc.createElement(["slider", "contenteditable", "selection"].includes(kind) ? "div" : kind);
        element.id = "goto-keyboard-owner";
        element.tabIndex = 0;
        if (kind === "slider") element.setAttribute("role", "slider");
        if (kind === "contenteditable") element.contentEditable = "true";
        element.textContent = "Native keyboard owner";
        doc.body.prepend(element);
        element.focus();
        if (kind === "selection") doc.getSelection()!.selectAllChildren(element);
      }, kind);
      await page.keyboard.press(`${modifier}+g`);
      await page.keyboard.press(`${modifier}+Shift+g`);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await focusBook(page);
    await page.keyboard.press(`${modifier}+/`);
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
    await expect(guide).toBeVisible();
    await page.keyboard.press(`${modifier}+g`);
    await page.keyboard.press(`${modifier}+Shift+g`);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(guide).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Go to retains keyboard focus during pending seeks and after failure", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4]));
  try {
    await ready(page);
    const modifier = await mod(page);
    await page.waitForFunction(() => Reflect.get(window, "__readerController").snapshot().bookPageCount > 0);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.seekToFraction = () => new Promise<void>((_resolve, reject) => {
        Reflect.set(window, "__rejectGoToSeek", () => reject(new Error("Fixture seek failure")));
        Reflect.set(window, "__goToSeekCalls", (Reflect.get(window, "__goToSeekCalls") ?? 0) + 1);
      });
    });
    for (const [mode, target] of [["Page", "input"], ["Percentage", "submit"]] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      const modal = dialog(page, mode);
      const input = modal.getByRole("spinbutton");
      const go = modal.getByRole("button", { name: "Go", exact: true });
      await expect(input).toBeFocused();
      await input.fill("1");
      const control = target === "input" ? input : go;
      if (target === "submit") {
        await input.press("Tab");
        await expect(modal.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(go).toBeFocused();
      }
      const callsBefore = await page.evaluate(() => Reflect.get(window, "__goToSeekCalls") ?? 0);
      await control.press("Enter");
      await expect(input).toHaveAttribute("readonly", "");
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await expect(control).toBeFocused();
      await control.press("Enter");
      expect(await page.evaluate(() => Reflect.get(window, "__goToSeekCalls"))).toBe(callsBefore + 1);
      await page.evaluate(() => Reflect.get(window, "__rejectGoToSeek")());
      await expect(modal.getByRole("alert")).toHaveText("Could not go to that position. Please try again.");
      await expect(control).toBeFocused();
      await expect(input).not.toHaveAttribute("readonly", "");
      await expect(go).toBeEnabled();
      await control.press("Escape");
      await expect(modal).toBeHidden();
    }
  } finally {
    await context.close();
  }
});

test("Go to explains fixed-layout unavailability without moving the book", async () => {
  const book = fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(book);
  try {
    await ready(page);
    const modifier = await mod(page);
    const before = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex);
    for (const mode of ["Page", "Percentage"] as const) {
      await focusBook(page);
      await page.keyboard.press(`${modifier}+${mode === "Percentage" ? "Shift+" : ""}g`);
      await expect(dialog(page, mode)).toContainText("Go to is unavailable for fixed-layout content.");
      await expect(dialog(page, mode).getByRole("button", { name: "Go", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog(page, mode)).toBeHidden();
    }
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex)).toBe(before);
  } finally {
    await context.close();
  }
});
