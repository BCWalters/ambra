import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

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

test("Go To rejects numeric prefixes and Escape leaves Book Details open", async () => {
  const { context, readerPage } = await launchReader(book);
  try {
    await readerPage.getByRole("button", { name: "Book details", exact: true }).click();
    const trigger = readerPage.getByRole("button", { name: "Go to Percentage…" });
    await trigger.click();
    const dialog = readerPage.getByRole("dialog", { name: "Go to Percentage", exact: true });
    const input = dialog.getByRole("spinbutton");
    for (const value of ["1e2", "9.9", "0", "101"]) {
      await input.fill(value);
      await expect(dialog.getByRole("button", { name: "Go", exact: true })).toBeDisabled();
    }
    await input.fill("25");
    await expect(dialog.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
    await input.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeFocused();
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
    await expect(match).toHaveCSS("color", "rgb(122, 62, 0)");
    await readerPage.getByRole("button", { name: "Settings", exact: true }).click();
    await readerPage.getByRole("menuitem", { name: /^Language/ }).click();
    await readerPage.getByRole("menuitemradio", { name: "Français", exact: true }).click();
    await expect(readerPage.locator("html")).toHaveAttribute("lang", "fr");
  } finally {
    await context.close();
  }
});
