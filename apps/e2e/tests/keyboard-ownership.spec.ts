import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/two-chapter.epub");

test("shell chapter shortcuts dispatch once and leave editing and dialogs alone", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 800, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const calls: number[] = [];
      Reflect.set(window, "__chapterCalls", calls);
      controller.goToChapter = async (direction: number) => { calls.push(direction); };
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Control+ArrowRight");
    expect(await page.evaluate(() => Reflect.get(window, "__chapterCalls"))).toEqual([1]);
    await page.evaluate(() => {
      const editor = document.createElement("textarea");
      document.body.append(editor);
      editor.focus();
    });
    await page.keyboard.press("Control+ArrowRight");
    await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.tabIndex = -1;
      document.body.append(dialog);
      dialog.focus();
    });
    await page.keyboard.press("Control+ArrowLeft");
    expect(await page.evaluate(() => Reflect.get(window, "__chapterCalls"))).toEqual([1]);
  } finally {
    await context.close();
  }
});

test("content keyboard scrolling and summary activation do not turn the page", async () => {
  const { context, readerPage: page } = await launchReader(book, { viewport: { width: 800, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.turnPage = async () => { throw new Error("Native content interaction turned a page"); };
      const frame = document.querySelector("iframe")!;
      const doc = frame.contentDocument!;
      const pre = doc.createElement("pre");
      pre.id = "keyboard-scroll";
      pre.style.cssText = "position:fixed;left:40px;top:100px;width:100px;overflow-x:auto;white-space:pre";
      pre.textContent = "A long line of code that must scroll horizontally instead of turning pages.";
      pre.tabIndex = 0;
      doc.body.append(pre);
      frame.focus();
      pre.focus({ preventScroll: true });
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() =>
      document.querySelector("iframe")!.contentDocument!.getElementById("keyboard-scroll")!.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(() => {
      const doc = document.querySelector("iframe")!.contentDocument!;
      const details = doc.createElement("details");
      details.id = "keyboard-details";
      details.style.cssText = "position:fixed;left:40px;top:200px";
      const summary = doc.createElement("summary");
      summary.textContent = "Disclosure";
      details.append(summary);
      doc.body.append(details);
      summary.focus({ preventScroll: true });
    });
    await page.keyboard.press("Space");
    expect(await page.evaluate(() =>
      document.querySelector("iframe")!.contentDocument!.querySelector("details")!.open)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
