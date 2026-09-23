import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

test("typography cascades preserve keyboard focus, checked choices and slider resets", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    const trigger = page.getByRole("button", { name: "Text and page options", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.getByRole("menu", { name: "Text and page options", exact: true })).toHaveAccessibleDescription("Only this book");
    const text = page.getByRole("menuitem", { name: "Text", exact: true });
    await text.press("ArrowRight");
    const size = page.getByRole("slider", { name: "Font size", exact: true });
    const originalSize = await size.inputValue();
    await size.focus();
    await size.press("ArrowRight");
    await expect(size).not.toHaveValue(originalSize);
    await page.getByRole("button", { name: "Reset Font size to default", exact: true }).click();
    await expect(size).toHaveValue(originalSize);
    const georgia = page.getByRole("menuitemradio", { name: "Georgia", exact: true });
    await georgia.click();
    await expect(georgia).toHaveAttribute("aria-checked", "true");
    await georgia.press("Escape");
    await expect(text).toBeFocused();
    const pageMenu = page.getByRole("menuitem", { name: "Page", exact: true });
    await pageMenu.press("ArrowRight");
    const sepia = page.getByRole("menuitemradio", { name: "Sepia", exact: true });
    await sepia.click();
    await expect(sepia).toHaveAttribute("aria-checked", "true");
    await sepia.press("Escape");
    await expect(pageMenu).toBeFocused();
    await pageMenu.press("Escape");
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("settings retain choices across reading-mode changes and disable animation only in scroll mode", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    const trigger = page.getByRole("button", { name: "Settings", exact: true });
    await trigger.click();
    await expect(page.getByRole("menu", { name: "Settings", exact: true })).toHaveAccessibleDescription("All books");
    const blue = page.getByRole("menuitemradio", { name: "Blue", exact: true });
    await blue.click();
    await expect(blue).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
    // Replacing the content host restores book focus and dismisses the menu.
    await expect(trigger).not.toHaveAttribute("aria-expanded", "true");
    await trigger.click();
    await expect(page.getByRole("menuitemradio", { name: "Slide", exact: true })).toBeDisabled();
    await expect(blue).toHaveAttribute("aria-checked", "true");
    await page.getByRole("menuitemradio", { name: "Paginated", exact: true }).click();
    await expect(trigger).not.toHaveAttribute("aria-expanded", "true");
    await trigger.click();
    const filmStrip = page.getByRole("menuitemradio", { name: "Film strip", exact: true });
    await expect(filmStrip).toBeEnabled();
    await filmStrip.click();
    await expect(filmStrip).toHaveAttribute("aria-checked", "true");
    const brightness = page.getByRole("slider", { name: "Brightness", exact: true });
    const originalBrightness = await brightness.inputValue();
    await brightness.focus();
    await brightness.press("ArrowLeft");
    await expect(brightness).not.toHaveValue(originalBrightness);
    await page.getByRole("button", { name: "Reset Brightness to default", exact: true }).click();
    await expect(brightness).toHaveValue(originalBrightness);
    await brightness.press("Escape");
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("fixed-layout books retain theme, animation and brightness but hide typography and reading modes", async () => {
  const { context, readerPage: page } = await launchReader(
    path.join(fixtures, "fxl-spread-ltr.epub"),
  );
  try {
    await expect(
      page.getByRole("button", { name: "Text and page options", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Paginated", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("menuitemradio", { name: "Scroll", exact: true })).toHaveCount(0);
    const off = page.getByRole("menuitemradio", { name: "Off", exact: true });
    await off.click();
    await expect(off).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("menuitemradio", { name: "Ambra", exact: true })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Brightness", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("highlight colors are one Tab stop with wrapping arrow selection and unchanged reading position", async () => {
  const { context, readerPage: page } = await launchReader(
    path.join(fixtures, "long-content.epub"),
  );
  try {
    await page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && (text.textContent?.trim().length ?? 0) < 30) text = walker.nextNode();
      if (!text) throw new Error("No highlightable text");
      const range = doc.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 30);
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Highlight options", exact: true });
    const group = dialog.getByRole("radiogroup", { name: "Highlight color" });
    const yellow = group.getByRole("radio", { name: "Yellow", exact: true });
    await yellow.focus();
    const position = await page
      .getByRole("slider", { name: "Position in book" })
      .getAttribute("aria-valuenow");
    await yellow.press("ArrowLeft");
    const underline = group.getByRole("radio", { name: "Underline", exact: true });
    await expect(underline).toBeFocused();
    await expect(underline).toHaveAttribute("aria-checked", "true");
    await underline.press("ArrowRight");
    await expect(yellow).toBeFocused();
    await expect(yellow).toHaveAttribute("aria-checked", "true");
    await yellow.press("ArrowDown");
    const green = group.getByRole("radio", { name: "Green", exact: true });
    await expect(green).toBeFocused();
    await expect(green).toHaveAttribute("aria-checked", "true");
    await expect(group.locator('[tabindex="0"]')).toHaveCount(1);
    await green.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Delete highlight", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(green).toBeFocused();
    await green.press("Space");
    await expect(green).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("slider", { name: "Position in book" })).toHaveAttribute(
      "aria-valuenow",
      position!,
    );
    await dialog.getByPlaceholder("Add a note…").fill("Keyboard color note");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "This highlight has a note", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Green", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(dialog.getByPlaceholder("Add a note…")).toHaveValue("Keyboard color note");
  } finally {
    await context.close();
  }
});
