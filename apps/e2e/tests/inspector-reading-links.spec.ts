import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentPageLabel, launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function openInspector(page: Page) {
  const details = page.getByRole("button", { name: "Book details", exact: true });
  await details.focus();
  await details.click();
  await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function highlightedSource(page: Page) {
  return page.evaluate(() => {
    const pre = document.querySelector("pre.ambra-hljs");
    if (!pre) return "";
    for (const highlight of CSS.highlights.values()) {
      for (const range of highlight) {
        if (!pre.contains(range.startContainer)) continue;
        const prefix = document.createRange();
        prefix.selectNodeContents(pre);
        prefix.setEnd(range.startContainer, range.startOffset);
        return pre.textContent!.slice(prefix.toString().length, prefix.toString().length + 250);
      }
    }
    return "";
  });
}

async function sourceHighlightVisible(page: Page) {
  return page.evaluate(() => {
    const pre = document.querySelector("pre.ambra-hljs");
    if (!pre) return false;
    const viewport = pre.parentElement!.getBoundingClientRect();
    for (const highlight of CSS.highlights.values()) {
      for (const range of highlight) {
        if (!(range instanceof Range) || !pre.contains(range.startContainer)) continue;
        const rect = range.getBoundingClientRect();
        return rect.top >= viewport.top && rect.bottom <= viewport.bottom &&
          rect.left >= viewport.left && rect.right <= viewport.right;
      }
    }
    return false;
  });
}

async function selectSource(pre: Locator, marker: string) {
  await pre.evaluate((element, marker) => {
    const offset = element.textContent!.indexOf(marker);
    if (offset < 0) throw new Error(`Missing source marker: ${marker}`);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent!.length;
      if (consumed + length > offset) {
        element.focus();
        const selection = document.getSelection()!;
        const range = document.createRange();
        range.setStart(node, offset - consumed);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      consumed += length;
    }
    throw new Error("Could not place the source caret.");
  }, marker);
}

for (const mode of ["paginated", "scroll"]) {
  test(`${mode}: current chapter, captured passage, source navigation and reading focus`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.resolve(here, "../fixtures/two-chapter.epub"),
      { viewport: { width: 760, height: 900 } },
    );
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (mode === "scroll") {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("menuitemradio", { name: "Scroll", exact: true }).click();
        await expect(page.getByRole("slider", { name: "Position in book" })).toHaveCount(0);
      }
      await page.evaluate(() => document.querySelector("iframe")!.contentWindow!.focus());
      await page.keyboard.press("Alt+PageDown");
      await expect(page.frameLocator("iframe").first().locator("h1")).toHaveText("CHAPTER TWO");
      const passage = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!;
        const doc = frame.contentDocument!;
        const paragraph = doc.querySelectorAll("p")[1]!;
        paragraph.scrollIntoView();
        const range = doc.createRange();
        range.selectNodeContents(paragraph);
        const selection = doc.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return paragraph.textContent!.split(".")[0]!;
      });
      const dialog = await openInspector(page);
      const pre = dialog.locator("pre.ambra-hljs");
      await expect(pre).toContainText("CHAPTER TWO");
      await dialog.getByRole("tab", { name: "Metadata", exact: true }).click();
      await dialog.getByRole("button", { name: "Locate current passage", exact: true }).click();
      await expect(dialog.getByRole("tab", { name: /Files/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect.poll(() => highlightedSource(page)).toContain(passage);
      await expect.poll(() => sourceHighlightVisible(page)).toBe(true);
      await dialog.screenshot({ path: test.info().outputPath(`${mode}-inspector-links.png`) });

      await dialog.locator('button[data-file-path="OEBPS/content.opf"]').click();
      const show = dialog.getByRole("button", { name: "Show in book", exact: true });
      await expect(show).toBeDisabled();
      await dialog.locator('button[data-file-path="OEBPS/ch1.xhtml"]').click();
      await expect(pre).toContainText("C1Para 80.");
      await selectSource(pre, "C1Para 80.");
      await pre.press("Shift+ArrowRight");
      expect(await pre.evaluate(() => document.getSelection()?.toString())).toBe("C");
      await expect.poll(() => highlightedSource(page)).toContain("C1Para 80.");
      await show.click();
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(450);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const doc = document.querySelector("iframe")!.contentDocument!;
            return {
              tag: doc.activeElement?.tagName.toLowerCase(),
              text: doc.activeElement?.textContent?.slice(0, 10),
              focused: document.activeElement?.tagName,
            };
          }),
        )
        .toEqual({ tag: "p", text: "C1Para 80.", focused: "IFRAME" });
      await expect(
        page
          .frameLocator("iframe")
          .first()
          .locator("p")
          .filter({
            hasText: /^C1Para 80\./,
          }),
      ).toBeInViewport();
      const spotlight = () => page.evaluate(() => {
        const doc = document.querySelector("iframe")!.contentDocument!;
        const target: Highlight | undefined = Reflect.get(doc.defaultView!, "CSS")
          .highlights.get("ambra-navigation-target");
        return target ? [...target].map(range => range.toString()).join("") : "";
      });
      await expect.poll(spotlight).toMatch(/^C1Para 80\./);
      await expect.poll(spotlight, { timeout: 6000 }).toBe("");
      if (mode === "paginated") expect(await currentPageLabel(page)).not.toContain("Page 1 of");

      await dialog.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
      const reopened = await openInspector(page);
      await expect(reopened.locator("pre.ambra-hljs")).toContainText("CHAPTER ONE");
      await reopened.getByRole("button", { name: "Locate current passage", exact: true }).click();
      await expect.poll(() => highlightedSource(page)).toContain("C1Para 80.");
      await page.keyboard.press("Escape");
      await expect(reopened).toBeHidden();
    } finally {
      await context.close();
    }
  });
}

test("fixed-layout source linking follows the selected spread document, not just the primary page", async () => {
  const { context, readerPage: page } = await launchReader(
    path.resolve(here, "../fixtures/fxl-spread-ltr.epub"),
    { viewport: { width: 1400, height: 900 } },
  );
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("ArrowRight");
    await expect(page.frameLocator("iframe").nth(1).locator("h1")).toHaveText("P2");
    await page.evaluate(() => {
      const frame = document.querySelectorAll("iframe")[1]!;
      const doc = frame.contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("h1")!);
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });

    const dialog = await openInspector(page);
    await expect(dialog.locator("pre.ambra-hljs")).toContainText("<title>P2</title>");
    await dialog.getByRole("button", { name: "Locate current passage", exact: true }).click();
    await expect.poll(() => highlightedSource(page)).toContain("<h1>P2</h1>");
    await dialog.locator('button[data-file-path="OEBPS/p4.xhtml"]').click();
    await expect(dialog.locator("pre.ambra-hljs")).toContainText("<h1>P4</h1>");
    await selectSource(dialog.locator("pre.ambra-hljs"), "P4</h1>");
    await expect.poll(() => highlightedSource(page)).toContain("<h1>P4</h1>");
    await dialog.getByRole("button", { name: "Show in book", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(450);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const frame = document.activeElement;
          return frame instanceof HTMLIFrameElement
            ? frame.contentDocument?.activeElement?.textContent
            : undefined;
        }),
      )
      .toBe("P4");
    await expect.poll(() => page.evaluate(() => {
      const frame = document.activeElement;
      if (!(frame instanceof HTMLIFrameElement)) return "";
      const doc = frame.contentDocument!;
      const target: Highlight | undefined = Reflect.get(doc.defaultView!, "CSS")
        .highlights.get("ambra-navigation-target");
      return target ? [...target].map(range => range.toString()).join("") : "";
    })).toBe("P4");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll("iframe")].some(frame =>
        frame.contentWindow && Reflect.get(frame.contentWindow, "CSS")
          ?.highlights?.has("ambra-navigation-target"),
      ),
    )).toBe(false);
  } finally {
    await context.close();
  }
});

for (const backwards of [false, true]) {
  test(`#192 complete source-element selection highlights in the book (${backwards ? "backward" : "forward"})`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.resolve(here, "../fixtures/two-chapter.epub"),
      { viewport: { width: 1400, height: 900 } },
    );
    try {
      const inspector = await openInspector(page);
      const pre = inspector.locator("pre.ambra-hljs");
      await expect(pre).toContainText("C1Para 4.");
      for (const mode of ["Dock left", "Dock right", "Full screen", "Popover view"]) {
        await inspector.getByRole("button", { name: mode, exact: true }).click();
        await pre.evaluate((element, backwards) => {
          const text = element.textContent!;
          const paragraph = text.indexOf("C1Para 4.");
          const start = text.lastIndexOf("<p", paragraph);
          const end = text.indexOf("</p>", paragraph) + 4;
          if (start < 0 || end < 4) throw new Error("Fixture paragraph was not found");
          function point(offset: number): [Node, number] {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const size = node.textContent!.length;
              if (offset <= size) return [node, offset];
              offset -= size;
            }
            throw new Error("Selection offset outside source");
          }
          const [startNode, startOffset] = point(start);
          const [endNode, endOffset] = point(end);
          element.focus();
          document.getSelection()!.setBaseAndExtent(
            backwards ? endNode : startNode, backwards ? endOffset : startOffset,
            backwards ? startNode : endNode, backwards ? startOffset : endOffset,
          );
        }, backwards);
        await expect.poll(() => highlightedSource(page)).toMatch(/^<p>C1Para 4\./);
        await inspector.getByRole("button", { name: "Show in book", exact: true }).click();
        await expect(inspector).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const frame = document.activeElement;
          if (!(frame instanceof HTMLIFrameElement)) return "";
          const spotlight: Highlight | undefined = Reflect.get(frame.contentWindow!, "CSS")
            .highlights.get("ambra-navigation-target");
          return spotlight ? [...spotlight].map(range => range.toString()).join("") : "";
        })).toMatch(/^C1Para 4\./);
      }
    } finally {
      await context.close();
    }
  });
}
