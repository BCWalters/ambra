import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const toolbar = (page: Page) =>
  page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ }).locator("..");
const popup = (page: Page) => page.getByRole("dialog", { name: "Highlight options" });
const progress = (page: Page) => page.getByRole("slider", { name: "Position in book" }).locator("..");

async function selectLine(page: Page, bottom = false) {
  await page.evaluate((bottom) => {
    const c = Reflect.get(window, "__readerController");
    const view = c.contentDocumentViews()[0];
    const doc = view.document as Document;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let range: Range | undefined;
    let lastY = -Infinity;
    const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      if (bottom && !node.textContent.startsWith("Original line ")) continue;
      const candidate = doc.createRange();
      candidate.setStart(node, 0);
      candidate.setEnd(node, Math.min(12, node.textContent.length));
      if (view.page && !view.page.containsPosition(node, 0, doc)) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.bottom > frame.height - 10)
        continue;
      if (!range || (bottom && rect.top > lastY)) {
        range = candidate;
        lastY = rect.top;
      }
      if (!bottom && range) break;
    }
    if (!range) throw new Error("Missing visible reading line");
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, bottom);
  await expect(page.getByRole("toolbar", { name: "Highlight this selection" })).toBeVisible();
}

async function clickHighlight(page: Page) {
  const point = await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const highlight = c.snapshot().highlights[0];
    const view = c.contentDocumentViews()[0];
    const range = c.highlightInteraction.resolveHighlightRange(
      highlight,
      view.spineIndex,
      view.document,
    );
    const rect = range.getClientRects()[0];
    const frame = view.document.defaultView.frameElement.getBoundingClientRect();
    view.document.getSelection().removeAllRanges();
    return { x: frame.left + rect.left + 3, y: frame.top + rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
}

for (const { width, zoom } of [
  { width: 900, zoom: 1 },
  { width: 360, zoom: 1 },
  { width: 1280, zoom: 2 },
]) {
  test(`${width}px ${zoom * 100}%: first-line annotation popup owns edge hover so inline delete stays reachable (#221)`, async () => {
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width, height: 900 },
    });
    try {
      if (zoom !== 1) {
        await page.evaluate(async (factor) => {
          const tab = await chrome.tabs.getCurrent();
          if (tab?.id === undefined) throw new Error("Reader tab not found");
          await chrome.tabs.setZoom(tab.id, factor);
        }, zoom);
      }
      await exposeReaderController(page);
      await page.mouse.move(width / 2, 350);
      await expect(toolbar(page)).toHaveCSS("opacity", "0");
      await selectLine(page);
      await page.getByRole("button", { name: "Yellow", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().highlights.length,
          ),
        )
        .toBe(1);
      await clickHighlight(page);
      await expect(popup(page)).toBeVisible();
      const remove = popup(page).getByRole("button", { name: "Delete highlight", exact: true });
      const bounds = (await remove.boundingBox())!;
      expect(bounds.y).toBeLessThan(96);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await expect(progress(page)).toHaveCSS("pointer-events", "none");
      await expect
        .poll(() =>
          remove.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
            );
          }),
        )
        .toBe(true);
      await page.screenshot({ path: test.info().outputPath("inline-delete-reachable.png") });
      await remove.click();
      await expect(popup(page)).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().highlights.length,
          ),
        )
        .toBe(0);
      await page.reload();
      await page.locator("iframe").first().waitFor();
      await exposeReaderController(page);
      expect(
        await page.evaluate(
          () => Reflect.get(window, "__readerController").snapshot().highlights.length,
        ),
      ).toBe(0);
    } finally {
      await context.close();
    }
  });
}

for (const direction of ["ltr", "rtl"]) {
  test(`${direction}: bottom-page selection and note popup preserve saved text and keyboard focus`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const fixture = navigationFixture(info, [1]);
    const source = info.outputPath("navigation-source");
    const opf = path.join(source, "EPUB/package.opf");
    fs.writeFileSync(
      opf,
      fs
        .readFileSync(opf, "utf8")
        .replace("<spine>", `<spine page-progression-direction="${direction}">`),
    );
    fs.writeFileSync(
      path.join(source, "EPUB/c0.xhtml"),
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Popup edges</title><style>p{font-size:18px;line-height:28px;margin:0}</style></head><body>${Array.from(
        { length: 36 },
        (_, i) => `<p>Original line ${i + 1} for popup interaction.</p>`,
      ).join("")}</body></html>`,
    );
    execFileSync("zip", ["-q", "-X", "-r", fixture, "EPUB"], { cwd: source });
    const { context, readerPage: page } = await launchReader(fixture, {
      viewport: { width: 760, height: 900 },
    });
    try {
      await exposeReaderController(page);
      const history = await page.evaluate(() => ({
        length: window.history.length,
        index: window.history.state.__ambraReading.index,
      }));
      await page.mouse.move(400, 400);
      await expect(toolbar(page)).toHaveCSS("opacity", "0");
      await selectLine(page, true);
      const selection = page.getByRole("toolbar", { name: "Highlight this selection" });
      const addNote = selection.getByRole("button", { name: "Add note", exact: true });
      const bounds = (await addNote.boundingBox())!;
      expect(bounds.y + bounds.height / 2).toBeGreaterThan(700);
      await addNote.hover();
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await addNote.click();
      await expect(popup(page)).toBeVisible();
      const input = popup(page).getByRole("textbox", { name: "Add a note…" });
      await expect(input).toBeFocused();
      await input.pressSequentially("Bottom-edge note");
      await expect(input).toBeFocused();
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      const save = popup(page).getByRole("button", { name: "Save", exact: true });
      await save.hover();
      await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
      await save.click();
      await expect(popup(page)).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () => Reflect.get(window, "__readerController").snapshot().highlights[0]?.note,
          ),
        )
        .toBe("Bottom-edge note");
      const saved = await page.evaluate(() => {
        const highlight = Reflect.get(window, "__readerController").snapshot().highlights[0];
        return { start: highlight.startCfi, end: highlight.endCfi };
      });
      await clickHighlight(page);
      await expect(popup(page)).toBeVisible();
      await expect(input).toHaveValue("Bottom-edge note");
      await input.press("Escape");
      await expect(popup(page)).toBeHidden();
      expect(
        await page.evaluate(() => ({
          length: window.history.length,
          index: window.history.state.__ambraReading.index,
        })),
      ).toEqual(history);
      expect(
        await page.evaluate(() => {
          const highlight = Reflect.get(window, "__readerController").snapshot().highlights[0];
          return { start: highlight.startCfi, end: highlight.endCfi };
        }),
      ).toEqual(saved);
      const chromeButton = page.getByRole("button", { name: "Library", exact: true });
      await chromeButton.focus();
      await expect(chromeButton).toBeFocused();
      await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
      await page.reload();
      await page.locator("iframe").first().waitFor();
      await exposeReaderController(page);
      expect(
        await page.evaluate(
          () => Reflect.get(window, "__readerController").snapshot().highlights[0]?.note,
        ),
      ).toBe("Bottom-edge note");
    } finally {
      await context.close();
    }
  });
}

test("bottom-edge narration controls and their portalled menu do not summon the progress bar", async () => {
  const narrated = fileURLToPath(
    new URL("../fixtures/media-overlay/narrated.epub", import.meta.url),
  );
  const { context, readerPage: page } = await launchReader(narrated);
  try {
    await exposeReaderController(page);
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    const controls = page.getByRole("region", { name: "Narration controls" });
    await expect(controls).toBeVisible();
    const speed = controls.getByRole("button", { name: /^Narration speed/ });
    await page.mouse.move(450, 450);
    await expect(toolbar(page)).toHaveCSS("opacity", "0");
    const rect = (await speed.boundingBox())!;
    expect(rect.y + rect.height / 2).toBeGreaterThan(900 - 96);
    await speed.hover();
    await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
    await expect(progress(page)).toHaveCSS("pointer-events", "none");
    await speed.click();
    const menu = page.getByRole("menu", { name: "Narration speed" });
    await expect(menu).toBeVisible();
    const slow = menu.getByRole("menuitemradio", { name: "0.75×", exact: true });
    await slow.hover();
    await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
    await expect(progress(page)).toHaveCSS("pointer-events", "none");
    await slow.click();
    await expect(menu).toBeHidden();
    await speed.focus();
    await speed.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(speed).toBeFocused();
    await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
    const audio = page.locator("audio[data-ambra-narration-audio]");
    expect(await audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(false);
    await page.mouse.move(450, 450);
    await page.mouse.move(10, 2);
    await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
    await expect(progress(page)).toHaveCSS("pointer-events", "auto");
  } finally {
    await context.close();
  }
});

test("footnote popup owns top-edge hover and Escape; ordinary edge reveal remains available after dismissal", async () => {
  const fixture = fileURLToPath(new URL("../fixtures/footnote.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(fixture);
  try {
    await exposeReaderController(page);
    await page.mouse.move(450, 450);
    await expect(toolbar(page)).toHaveCSS("opacity", "0");
    const frameUrl = await page.evaluate(
      () =>
        Reflect.get(window, "__readerController").contentDocumentViews()[0].document.URL as string,
    );
    await page
      .frames()
      .find((frame) => frame.url() === frameUrl)!
      .locator("#fnref1")
      .click();
    const footnote = page.getByRole("dialog", { name: "Footnote" });
    await expect(footnote).toBeVisible();
    const close = footnote.getByRole("button", { name: "Close", exact: true });
    const rect = (await close.boundingBox())!;
    expect(rect.y).toBeLessThan(96);
    await close.hover();
    await expect(toolbar(page)).toHaveCSS("pointer-events", "none");
    await footnote.press("Escape");
    await expect(footnote).toBeHidden();
    await page.mouse.move(450, 450);
    await page.mouse.move(10, 2);
    await expect(toolbar(page)).toHaveCSS("pointer-events", "auto");
    const library = page.getByRole("button", { name: "Library", exact: true });
    await library.focus();
    await expect(library).toBeFocused();
  } finally {
    await context.close();
  }
});
