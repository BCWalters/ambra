import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

for (const surface of ["reader", "library"] as const) {
  test(`${surface}: shared Ambra settings retain task order, native choices and viewport bounds`, async () => {
    const testInfo = test.info();
    const { context, readerPage, libraryPage } = await launchReader(path.join(fixtures, "two-chapter.epub"));
    const page = surface === "reader" ? readerPage : libraryPage;
    try {
      const trigger = page.getByRole("button", { name: "Ambra settings", exact: true });
      await trigger.click();
      const settings = page.getByRole("dialog", { name: "Ambra settings", exact: true });
      await expect(settings.getByRole("heading", { name: "Ambra settings", exact: true })).toBeVisible();
      const reading = settings.locator("details").filter({ hasText: "Reading preferences" });
      await expect(reading).toHaveJSProperty("open", surface === "reader");
      if (surface === "reader") {
        await expect(settings.getByRole("combobox", { name: "Page theme", exact: true })).toBeFocused();
      } else {
        await expect(settings.getByRole("combobox", { name: "Page theme", exact: true })).toBeHidden();
        await reading.locator("summary").click();
      }
      await expect(settings.getByRole("menuitemradio")).toHaveCount(0);
      await expect(settings.getByRole("slider", { name: "Font size", exact: true })).toHaveCount(0);
      await expect(settings.getByRole("switch", { name: "Always show one page", exact: true })).toHaveCount(0);
      await expect(settings).toBeInViewport({ ratio: 1 });
      expect(await settings.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      let previousBottom = 0;
      const readingNames = ["Page theme", "Brightness", "Reading mode", "Page turn", "Progress landmarks"];
      const interfaceNames = ["Interface theme", "Language"];
      for (const name of surface === "reader" ? [...readingNames, ...interfaceNames] : [...interfaceNames, ...readingNames]) {
        const control = name === "Brightness"
          ? settings.getByRole("slider", { name, exact: true })
          : settings.getByRole("combobox", { name, exact: true });
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(previousBottom);
        previousBottom = box.y + box.height;
      }
      for (const [label, value] of [
        ["Page theme", "white"], ["Reading mode", "paginated"],
        ["Page turn", "slide"], ["Interface theme", "ambra"], ["Language", "system"],
      ]) {
        await expect(settings.getByRole("combobox", { name: label, exact: true })).toHaveValue(value!);
      }
      const screenshot = testInfo.outputPath(`${surface}-full-settings.png`);
      await settings.screenshot({ path: screenshot });
      await testInfo.attach(`${surface}-full-settings`, { path: screenshot, contentType: "image/png" });
      for (const [name, labels] of [
        ["Page theme", ["White", "Sepia", "Dark"]],
        ["Reading mode", ["Paginated", "Scroll"]],
        ["Page turn", ["Slide", "Film strip", "Page flip", "Off"]],
        ["Interface theme", ["Ambra", "Silver", "Green", "Blue", "Purple"]],
      ] as const) {
        await expect(settings.getByRole("combobox", { name, exact: true }).locator("option")).toHaveText([...labels]);
      }
      await settings.getByRole("combobox", { name: "Interface theme", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

test("typography cascades preserve keyboard focus, checked choices and slider resets", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    const trigger = page.getByRole("button", { name: "Text and page options", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.getByRole("menu", { name: "Text and page options", exact: true })).toHaveAccessibleDescription("Book options");
    await expect(page.getByRole("combobox", { name: /^(Page theme|Reading mode|Interface theme|Language)$/ })).toHaveCount(0);
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
    const onePage = page.getByRole("switch", { name: "Always show one page", exact: true });
    await onePage.press("Space");
    await expect(onePage).toBeChecked();
    await onePage.press("Escape");
    await expect(pageMenu).toBeFocused();
    await pageMenu.press("Escape");
    await expect(trigger).toBeFocused();
  } finally {
    await context.close();
  }
});

test("global settings retain choices across modes, reload and library while disabling animation only in scroll mode", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    // A trapped settings dialog removes its background trigger from the accessibility tree.
    const trigger = page.locator("[data-ambra-page-band]")
      .getByRole("button", { name: "Ambra settings", exact: true, includeHidden: true });
    await trigger.click();
    const settings = page.getByRole("dialog", { name: "Ambra settings", exact: true });
    const readerTheme = settings.getByRole("combobox", { name: "Interface theme", exact: true });
    await readerTheme.selectOption("blue");
    await expect(readerTheme).toHaveValue("blue");
    const readingMode = settings.getByRole("combobox", { name: "Reading mode", exact: true });
    await readingMode.selectOption("scroll");
    await expect(readingMode).toHaveValue("scroll");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const pageTurn = settings.getByRole("combobox", { name: "Page turn", exact: true });
    await expect(pageTurn).toBeDisabled();
    await expect(readerTheme).toHaveValue("blue");
    await readingMode.selectOption("paginated");
    await expect(readingMode).toHaveValue("paginated");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(pageTurn).toBeEnabled();
    await pageTurn.selectOption("scroll");
    await expect(pageTurn).toHaveValue("scroll");
    const brightness = settings.getByRole("slider", { name: "Brightness", exact: true });
    const pageTheme = settings.getByRole("combobox", { name: "Page theme", exact: true });
    await pageTheme.focus();
    await pageTheme.selectOption("sepia");
    await expect(pageTheme).toBeFocused();
    await expect(pageTheme).toHaveValue("sepia");
    await pageTheme.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(pageTheme).toBeFocused();
    await expect(pageTheme).toHaveValue("sepia");
    await expect(readerTheme).toHaveValue("blue");
    await expect(pageTurn).toHaveValue("scroll");
    const originalBrightness = await brightness.inputValue();
    await brightness.focus();
    await brightness.press("ArrowLeft");
    await expect(brightness).not.toHaveValue(originalBrightness);
    await page.getByRole("button", { name: "Reset Brightness to default", exact: true }).click();
    await expect(brightness).toHaveValue(originalBrightness);
    await brightness.press("Escape");
    await expect(trigger).toBeFocused();
    await page.reload();
    await expect(page.locator("iframe").first()).toBeAttached();
    await trigger.click();
    await expect(pageTheme).toHaveValue("sepia");
    await expect(readerTheme).toHaveValue("blue");
    await expect(pageTurn).toHaveValue("scroll");
    await expect(readingMode).toHaveValue("paginated");
    await expect(brightness).toHaveValue(originalBrightness);

    await libraryPage.getByRole("button", { name: "Ambra settings", exact: true }).click();
    const librarySettings = libraryPage.getByRole("dialog", { name: "Ambra settings", exact: true });
    await expect(librarySettings.getByRole("combobox", { name: "Interface theme", exact: true })).toHaveValue("blue");
    const reading = librarySettings.locator("details").filter({ hasText: "Reading preferences" });
    await expect(reading).toHaveJSProperty("open", false);
    await reading.locator("summary").click();
    await expect(librarySettings.getByRole("combobox", { name: "Page theme", exact: true })).toHaveValue("sepia");
    await expect(librarySettings.getByRole("combobox", { name: "Page turn", exact: true })).toHaveValue("scroll");
    await expect(librarySettings.getByRole("combobox", { name: "Reading mode", exact: true })).toHaveValue("paginated");
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
    await page.getByRole("button", { name: "Ambra settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Ambra settings", exact: true });
    await expect(settings.getByRole("combobox", { name: "Reading mode", exact: true })).toHaveCount(0);
    const pageTurn = settings.getByRole("combobox", { name: "Page turn", exact: true });
    await pageTurn.selectOption("none");
    await expect(pageTurn).toHaveValue("none");
    await expect(settings.getByRole("combobox", { name: "Interface theme", exact: true })).toHaveValue("ambra");
    await expect(settings.getByRole("slider", { name: "Brightness", exact: true })).toBeVisible();
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
    const note = dialog.getByPlaceholder("Add a note…");
    const close = dialog.getByRole("button", { name: "Close", exact: true });
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
    await expect(close).toBeFocused();
    await close.press("Tab");
    await expect(note).toBeFocused();
    await note.press("Shift+Tab");
    await expect(close).toBeFocused();
    await close.press("Shift+Tab");
    await expect(green).toBeFocused();
    await green.press("Space");
    await expect(green).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("slider", { name: "Position in book" })).toHaveAttribute(
      "aria-valuenow",
      position!,
    );
    await note.fill("Keyboard color note");
    await note.press("Tab");
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    const remove = dialog.getByRole("button", { name: "Delete highlight", exact: true });
    await expect(cancel).toBeFocused();
    await cancel.press("Tab");
    await expect(save).toBeFocused();
    await save.press("Tab");
    await expect(remove).toBeFocused();
    await remove.press("Shift+Tab");
    await expect(save).toBeFocused();
    await save.press("Enter");
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
