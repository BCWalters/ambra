import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("reader error variants keep headings, explanations and technical details separated", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    for (const severity of ["blocking", "actionFailed", "transient", "info"] as const) {
      await readerPage.evaluate((severity) => {
        const controller = Reflect.get(window, "__readerController");
        controller.setNotification("First sentence. Second sentence.", severity, "Technical explanation.");
        controller.notify();
      }, severity);
      const card = readerPage.getByRole(severity === "blocking" || severity === "actionFailed" ? "alert" : "status")
        .filter({ hasText: "First sentence. Second sentence." });
      await expect(card).toBeVisible();
      const paragraphs = card.locator("p");
      for (const paragraph of await paragraphs.all()) {
        await expect(paragraph).toHaveCSS("display", "block");
      }
      const bounds = await paragraphs.evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }));
      for (let index = 1; index < bounds.length; index++) {
        expect(bounds[index]!.top).toBeGreaterThan(bounds[index - 1]!.bottom);
      }
      await expect(card).toContainText("First sentence. Second sentence.");
      if (severity === "actionFailed") {
        await expect(card).toContainText("Error details: Technical explanation.");
      }
    }
  } finally {
    await context.close();
  }
});

test("repeated identical reader notifications receive a fresh full lifetime", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await exposeReaderController(readerPage);
    await readerPage.clock.install();
    const notify = () => readerPage.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.reportInfo("Repeated acknowledgement");
      return controller.snapshot().errorNotificationId;
    });
    const first = await notify();
    const message = readerPage.getByText("Repeated acknowledgement", { exact: true });
    await expect(message).toBeVisible();
    await readerPage.clock.runFor(7000);
    expect(await notify()).toBeGreaterThan(first);
    await readerPage.clock.runFor(1500);
    await expect(message).toBeVisible();
    await readerPage.clock.runFor(6600);
    await expect(message).toBeHidden();
  } finally {
    await context.close();
  }
});

test("a keyboard-focused scrubber stays visible after the chrome inactivity delay", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.mouse.move(450, 450);
    const slider = readerPage.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    await expect(slider).toBeFocused();
    await readerPage.waitForTimeout(3000);
    await expect(slider.locator("..")).toHaveCSS("opacity", "1");
  } finally {
    await context.close();
  }
});

test("Go To shortcuts replace Book Details controls and retain native numeric validation", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    await expect(readerPage.getByRole("button", { name: /^Go to (Page|Percentage)/ })).toHaveCount(0);
    await readerPage.keyboard.press("Escape");
    const mod = await readerPage.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
    await readerPage.keyboard.press(`${mod}+Shift+g`);
    const dialog = readerPage.getByRole("dialog", { name: "Go to Percentage", exact: true });
    const input = dialog.getByRole("spinbutton");
    await expect(input).toBeFocused();
    for (const value of ["1e2", "9.9", "0", "101"]) {
      await input.fill(value);
      await expect(dialog.getByRole("button", { name: "Go", exact: true })).toBeDisabled();
    }
    await input.fill("25");
    await expect(dialog.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
    await input.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => readerPage.evaluate(() => document.activeElement instanceof HTMLIFrameElement)).toBe(true);
  } finally {
    await context.close();
  }
});

test("search uses accessible text emphasis and changing UI language updates the shell", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.getByRole("button", { name: "Search", exact: true }).click();
    await readerPage.getByRole("searchbox").fill("chapter");
    const match = readerPage.getByRole("navigation", { name: "Search" }).locator("strong").first();
    await expect(match).toBeVisible();
    const contrasts = await match.evaluate(element => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.map(Number);
        if (channels.length === 4 && channels[3] !== 1) throw new Error(`Expected opaque contrast color: ${color}`);
        const [r, g, b] = channels.slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
      };
      const foreground = luminance(getComputedStyle(element).color);
      const panel = getComputedStyle(element.closest("nav")!);
      // Chrome paints an opaque gradient, not its transparent background-color.
      const backgrounds = panel.backgroundImage === "none"
        ? [panel.backgroundColor] : panel.backgroundImage.match(/rgba?\([^)]+\)/g);
      if (!backgrounds?.length) throw new Error(`Unrecognized panel background: ${panel.backgroundImage}`);
      return backgrounds.map(color => {
        const background = luminance(color);
        return { color, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
    });
    for (const { color, ratio } of contrasts) expect(ratio, `Search emphasis against ${color}`).toBeGreaterThanOrEqual(4.5);
    await readerPage.getByRole("button", { name: "Ambra settings", exact: true }).click();
    await readerPage.getByRole("dialog", { name: "Ambra settings", exact: true })
      .getByRole("combobox", { name: "Language", exact: true }).selectOption("fr");
    await expect(readerPage.locator("html")).toHaveAttribute("lang", "fr");
  } finally {
    await context.close();
  }
});
