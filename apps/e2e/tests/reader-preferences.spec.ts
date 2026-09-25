import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

for (const surface of ["reader", "library"] as const) {
  test(`${surface}: consistent Settings flyouts preserve previews, typography and compact height`, async () => {
    const testInfo = test.info();
    const { context, readerPage, libraryPage } = await launchReader(path.join(fixtures, "two-chapter.epub"));
    const page = surface === "reader" ? readerPage : libraryPage;
    try {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const menu = page.getByRole("menu", { name: "Settings", exact: true });
      const title = menu.getByText("Ambra settings", { exact: true });
      await expect(title).toHaveCSS("font-size", "14px");
      await expect(title).toHaveCSS("font-weight", "600");
      await expect(title).toHaveCSS("opacity", "1");
      await expect(title).toHaveCSS("color", "rgb(36, 36, 36)");
      for (const name of ["Page theme", "Brightness", "Reading mode", "Reader theme", "Page turn"]) {
        const label = menu.getByText(name, { exact: true });
        await expect(label).toHaveCSS("font-size", "14px");
        await expect(label).toHaveCSS("font-weight", "400");
      }
      await expect(menu.getByRole("menuitemradio")).toHaveCount(0);
      await expect(page.getByRole("menu")).toHaveCount(1);
      await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
      const dimensions = await menu.locator("..").evaluate(element => ({
        height: element.getBoundingClientRect().height,
        overflow: element.scrollHeight - element.clientHeight,
      }));
      expect(dimensions.height).toBeLessThanOrEqual(400);
      expect(dimensions.overflow).toBeLessThanOrEqual(1);
      let previousBottom = 0;
      for (const name of ["Reader theme", "Page theme", "Brightness", "Reading mode", "Page turn", "Language", "Help & About"]) {
        if (surface === "library" && name === "Help & About") continue;
        const control = name === "Brightness"
          ? menu.getByRole("slider", { name, exact: true })
          : menu.getByRole("menuitem", { name: new RegExp(`^${name}`) });
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(previousBottom);
        previousBottom = box.y + box.height;
      }
      for (const [label, value] of [
        ["Page theme", "White"], ["Reading mode", "Paginated"],
        ["Page turn", "Slide"], ["Reader theme", "Ambra"], ["Language", "System default"],
      ]) {
        await expect(menu.getByRole("menuitem", { name: new RegExp(`^${label}`) })
          .getByText(value!, { exact: true })).toHaveCSS("font-size", "14px");
      }
      const screenshot = testInfo.outputPath(`${surface}-full-settings.png`);
      await menu.locator("..").screenshot({ path: screenshot });
      await testInfo.attach(`${surface}-full-settings`, { path: screenshot, contentType: "image/png" });
      for (const [name, labels] of [
        ["Page theme", ["White", "Sepia", "Dark"]],
        ["Reading mode", ["Paginated", "Scroll"]],
        ["Page turn", ["Slide", "Film strip", "Page flip", "Off"]],
        ["Reader theme", ["Ambra", "Silver", "Green", "Blue", "Purple"]],
      ] as const) {
        const parent = menu.getByRole("menuitem", { name: new RegExp(`^${name}`) });
        await parent.press("ArrowRight");
        const submenu = page.getByRole("menu").last();
        await expect(submenu.getByRole("menuitemradio")).toHaveCount(labels.length);
        for (const label of labels) {
          const choice = submenu.getByRole("menuitemradio", { name: new RegExp(`^${label}`) });
          await expect(choice).toBeVisible();
          await expect(choice.getByText(label, { exact: true })).toHaveCSS("font-size", "14px");
          await expect(choice.getByText(label, { exact: true })).toHaveCSS("font-weight", "400");
        }
        if (name === "Page turn") {
          await expect(submenu.getByRole("menuitemradio", { name: /^Page flip/ })).toContainText("Experimental");
        } else if (name === "Page theme") {
          for (const [label, background, foreground] of [
            ["White", "rgb(255, 255, 255)", "rgb(26, 26, 26)"],
            ["Sepia", "rgb(250, 247, 241)", "rgb(35, 32, 25)"],
            ["Dark", "rgb(35, 35, 35)", "rgb(232, 230, 225)"],
          ]) {
            const preview = submenu.getByRole("menuitemradio", { name: label, exact: true })
              .locator('span[aria-hidden="true"]').first();
            await expect(preview).toHaveCSS("background-color", background!);
            await expect(preview.locator("span")).toHaveCount(2);
            for (const line of await preview.locator("span").all()) await expect(line).toHaveCSS("background-color", foreground!);
            await expect(preview).toBeInViewport({ ratio: 1 });
          }
          const previewScreenshot = testInfo.outputPath(`${surface}-page-theme-previews.png`);
          await submenu.locator("..").screenshot({ path: previewScreenshot });
          await testInfo.attach(`${surface}-page-theme-previews`, { path: previewScreenshot, contentType: "image/png" });
        } else if (name === "Reading mode" && surface === "reader") {
          for (const [label, chord] of [["Paginated", "Alt+Shift+PageUp"], ["Scroll", "Alt+Shift+PageDown"]]) {
            const choice = submenu.getByRole("menuitemradio", { name: label, exact: true });
            await expect(choice).toHaveAttribute("aria-keyshortcuts", chord!);
            await expect(choice.getByText(/Page(?:Up|Down)/)).toBeVisible();
          }
        } else if (name === "Reader theme") {
          for (const item of await submenu.getByRole("menuitemradio").all()) {
            await expect(item.locator('span[aria-hidden="true"]').first()).toBeVisible();
          }
        }
        await page.keyboard.press("Escape");
        await expect(parent).toBeFocused();
        await expect(page.getByRole("menu")).toHaveCount(1);
      }
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

test("settings retain choices across reading-mode changes and disable animation only in scroll mode", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"));
  try {
    const trigger = page.getByRole("button", { name: "Settings", exact: true });
    await trigger.click();
    await expect(page.getByRole("menu", { name: "Settings", exact: true })).toHaveAccessibleDescription("Ambra settings");
    const readerTheme = page.getByRole("menuitem", { name: /^Reader theme/ });
    await readerTheme.press("ArrowRight");
    const blue = page.getByRole("menuitemradio", { name: "Blue", exact: true });
    await blue.click();
    await expect(blue).toHaveAttribute("aria-checked", "true");
    await blue.press("Escape");
    await expect(readerTheme).toBeFocused();
    await expect(readerTheme).toContainText("Blue");
    const readingMode = page.getByRole("menuitem", { name: /^Reading mode/ });
    await readingMode.press("ArrowRight");
    await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Scroll", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const pageTurn = page.getByRole("menuitem", { name: /^Page turn/ });
    await expect(pageTurn).toBeDisabled();
    await expect(readerTheme).toContainText("Blue");
    await page.getByRole("menuitemradio", { name: "Paginated", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Paginated", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(readingMode).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(pageTurn).toBeEnabled();
    await pageTurn.press("ArrowRight");
    const filmStrip = page.getByRole("menuitemradio", { name: "Film strip", exact: true });
    await expect(filmStrip).toBeEnabled();
    await filmStrip.click();
    await expect(filmStrip).toHaveAttribute("aria-checked", "true");
    await filmStrip.press("Escape");
    await expect(pageTurn).toBeFocused();
    await expect(pageTurn).toContainText("Film strip");
    const brightness = page.getByRole("slider", { name: "Brightness", exact: true });
    const pageTheme = page.getByRole("menuitem", { name: /^Page theme/ });
    await pageTheme.press("ArrowRight");
    const sepia = page.getByRole("menuitemradio", { name: "Sepia", exact: true });
    await sepia.click();
    await expect(sepia).toBeFocused();
    await expect(sepia).toHaveAttribute("aria-checked", "true");
    await sepia.press("Escape");
    await expect(pageTheme).toBeFocused();
    await pageTheme.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await pageTheme.press("ArrowRight");
    await expect(sepia).toHaveAttribute("aria-checked", "true");
    await sepia.press("Escape");
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
    await expect(page.getByRole("menuitem", { name: /^Reading mode/ })).toHaveCount(0);
    await expect(page.getByRole("menuitemradio", { name: "Paginated", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitemradio", { name: "Scroll", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^Page turn/ }).click();
    const off = page.getByRole("menuitemradio", { name: "Off", exact: true });
    await off.click();
    await expect(off).toHaveAttribute("aria-checked", "true");
    await off.press("Escape");
    await page.getByRole("menuitem", { name: /^Reader theme/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "Ambra", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
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
