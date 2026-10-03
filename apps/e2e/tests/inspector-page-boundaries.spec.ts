import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import type { ContentDocumentView } from "../../../packages/engine/src/reading/ContentDocumentView.js";
import { navigationFixture } from "../navigation-fixture.js";

const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));

async function openInspector(page: Page) {
  await page.getByRole("button", { name: "Book details", exact: true }).click();
  await page.getByRole("button", { name: "EPUB Inspector", exact: true }).click();
  const inspector = page.getByRole("dialog", { name: "EPUB Inspector", exact: true });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("switch")).toHaveCount(0);
  await expect(inspector.locator("[data-boundary-offset]")).toHaveCount(0);
  return inspector;
}

async function settle(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    return !controller.isLoadInFlight && !controller.isApplyingLayout &&
      !controller.pendingLayout && !controller.isTurningPage;
  })).toBe(true);
}

async function pageStartVisible(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>('[data-page-boundary="start"]');
    if (!marker) return false;
    const viewport = marker.closest("[data-inspector-source-viewport]")!.getBoundingClientRect();
    const bounds = marker.getBoundingClientRect();
    return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom &&
      bounds.left >= viewport.left && bounds.right <= viewport.right;
  });
}

async function verifyMarkers(page: Page) {
  await settle(page);
  const visible: { path: string; pageIndex: number }[] = await page.evaluate(async () =>
    Reflect.get(window, "__readerController").getInspectorReaderBridge().getVisiblePages());
  const pageCount = visible.length;
  expect(pageCount).toBeGreaterThan(0);
  await expect(page.locator("span").filter({ hasText: /^Page \d+$/ })).toHaveCount(pageCount);
  let interiorTextMarkers = 0;
  for (let index = 0; index < pageCount; index += 1) {
    await page.locator(`button[data-file-path="${visible[index]!.path}"]`).click();
    await expect(page.locator("[data-page-boundary]")).toHaveCount(
      visible.filter(candidate => candidate.path === visible[index]!.path).length * 2,
    );
    const boundaries = await page.evaluate(index => {
      const controller = Reflect.get(window, "__readerController");
      const views: ContentDocumentView[] = controller.contentDocumentViews();
      const view = views.filter(candidate => candidate.page)[index]!;
      const footers = Array.from(document.querySelectorAll("span"))
        .map(node => /^Page (\d+)$/.exec(node.textContent ?? ""))
        .filter(match => match !== null);
      const pageNumber = Number(footers[footers.length === 1 || view.physicalSide !== "right" ? 0 : 1]![1]);
      const source = document.querySelector("pre.ambra-hljs")!.textContent!;
      return (["start", "end"] as const).map(edge => {
        const point = edge === "start" ? view.page!.startBreak : view.page!.endBreak;
        const marker = document.querySelector<HTMLElement>(
          `[data-page-boundary="${edge}"][data-page-index="${view.page!.index}"]`,
        );
        const offset = Number(marker?.dataset.sourceOffset);
        const text = point.node.nodeType === 3 ? point.node.textContent! : undefined;
        const character = point.offset ?? 0;
        const prefix = document.createRange();
        prefix.selectNodeContents(document.querySelector("pre.ambra-hljs")!);
        if (marker) prefix.setEndBefore(marker);
        const copiedSource = document.createRange();
        copiedSource.selectNodeContents(document.querySelector("pre.ambra-hljs")!);
        return {
          found: !!marker, offset, text, character,
          label: marker?.getAttribute("aria-label"),
          expectedLabel: `[${pageNumber} ${edge}]`,
          generatedLabel: marker ? getComputedStyle(marker, "::before").content : "",
          actualOffset: prefix.toString().length,
          copiedSource: copiedSource.toString(), source,
          before: source.slice(Math.max(0, offset - Math.min(character, 20)), offset),
          after: source.slice(offset, offset + (text ? Math.min(text.length - character, 20) : 0)),
        };
      });
    }, index);
    for (const boundary of boundaries) {
      expect(boundary.found).toBe(true);
      expect(boundary.offset).toBeGreaterThanOrEqual(0);
      expect(boundary.actualOffset).toBe(boundary.offset);
      expect(boundary.label).toBe(boundary.expectedLabel);
      expect(boundary.generatedLabel).toBe(`"${boundary.expectedLabel}"`);
      expect(boundary.copiedSource).toBe(boundary.source);
      if (boundary.text !== undefined) {
        expect(boundary.before).toBe(boundary.text.slice(Math.max(0, boundary.character - 20), boundary.character));
        expect(boundary.after).toBe(boundary.text.slice(boundary.character, boundary.character + 20));
        if (boundary.character > 0 && boundary.character < boundary.text.length) interiorTextMarkers += 1;
      }
    }
  }
  return { pageCount, interiorTextMarkers };
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`opening Inspector reveals the current page start without clicking a file (${reducedMotion})`, async () => {
    const fixture = navigationFixture(test.info(), [1, 1], chapter =>
      `<p id="long-${chapter}">${"The river passes the orchard and the quiet footbridge before reaching the sea. ".repeat(120)}</p>`);
    const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 1400, height: 900 } });
    try {
      await page.emulateMedia({ reducedMotion });
      await exposeReaderController(page);
      await page.evaluate(async () => {
        const controller = Reflect.get(window, "__readerController");
        await controller.turnPage(1);
        await controller.turnPage(1);
      });
      const inspector = await openInspector(page);
      await expect(inspector.locator('[data-page-boundary="start"]')).toHaveCount(2);
      await expect.poll(() => pageStartVisible(page)).toBe(true);
      await inspector.evaluate(async node => {
        await Promise.allSettled(node.getAnimations({ subtree: true }).map(animation => animation.finished));
      });
      await expect.poll(() => pageStartVisible(page)).toBe(true);
      await inspector.getByRole("button", { name: "Close EPUB Inspector", exact: true }).click();
      await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      await openInspector(page);
      await expect.poll(() => pageStartVisible(page)).toBe(true);
    } finally {
      await context.close();
    }
  });
}

for (const width of [760, 1400]) {
  test(`${width}px: precise visible-page markers follow page turns, wrapping and docking`, async () => {
    const longParagraphBook = navigationFixture(test.info(), [1, 1], chapter =>
      `<p id="long-${chapter}">${"The river passes the orchard and the quiet footbridge before reaching the sea. ".repeat(120)}</p>`);
    const { context, readerPage: page } = await launchReader(longParagraphBook, { viewport: { width, height: 900 } });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await exposeReaderController(page);
      await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      const inspector = await openInspector(page);
      const first = await verifyMarkers(page);
      expect(first.pageCount).toBe(width === 1400 ? 2 : 1);
      expect(first.interiorTextMarkers).toBeGreaterThan(0);
      const previous = await inspector.locator("[data-page-boundary]").evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-label")));
      await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
      await expect.poll(() => inspector.locator("[data-page-boundary]").evaluateAll(nodes =>
        nodes.map(node => node.getAttribute("data-label")))).not.toEqual(previous);
      await verifyMarkers(page);
      const end = inspector.locator("[data-page-boundary]").last();
      await end.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => {
        const pre = document.querySelector("pre.ambra-hljs")!;
        const viewport = pre.closest("[data-inspector-source-viewport]")!.getBoundingClientRect();
        const last = Array.from(document.querySelectorAll<HTMLElement>("[data-page-boundary]")).at(-1)!;
        const bounds = last.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom &&
          bounds.left >= viewport.left && bounds.right <= viewport.right;
      })).toBe(true);
      await inspector.getByRole("button", { name: "Turn on line wrapping", exact: true }).click();
      await verifyMarkers(page);
      await inspector.getByRole("button", { name: "Dock right", exact: true }).click();
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").width))
        .toBe(width - Math.min(560, width * 0.45));
      await verifyMarkers(page);
      await page.setViewportSize({ width: width - 60, height: 820 });
      await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").width))
        .toBe(width - 60 - Math.min(560, (width - 60) * 0.45));
      await verifyMarkers(page);
      await page.screenshot({ path: test.info().outputPath(`page-boundaries-${width}.png`) });
      await expect(inspector.locator("[data-boundary-offset]")).toHaveCount(0);
      await expect(inspector.getByRole("switch")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("pending book-wide numbers update without moving the source viewport", async () => {
  const fixture = navigationFixture(test.info(), [1, 1], chapter =>
    `<p id="long-${chapter}">${"The river passes the orchard and the quiet footbridge before reaching the sea. ".repeat(120)}</p>`);
  const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 760, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(async () => {
      const controller = Reflect.get(window, "__readerController");
      await controller.turnPage(1);
      const pagination = Reflect.get(controller, "bookPagination");
      const positionFor = pagination.positionFor;
      pagination.positionFor = () => ({ currentPage: undefined, totalPages: undefined });
      Reflect.get(controller, "notify").call(controller);
      Reflect.set(window, "__restoreInspectorNumbers", () => {
        pagination.positionFor = positionFor;
        Reflect.get(controller, "notify").call(controller);
      });
    });
    const inspector = await openInspector(page);
    await expect(inspector.locator('[data-page-boundary="start"]')).toHaveAttribute("data-label", "[start]");
    await expect(inspector.locator('[data-page-boundary="end"]')).toHaveAttribute("data-label", "[end]");
    const viewport = inspector.locator("[data-inspector-source-viewport]");
    await viewport.evaluate(node => { node.scrollLeft = 1000; });
    await page.evaluate(() => {
      Reflect.get(window, "__restoreInspectorNumbers")();
      Reflect.deleteProperty(window, "__restoreInspectorNumbers");
    });
    await expect(inspector.locator('[data-page-boundary="start"]')).toHaveAttribute("data-label", "[2 start]");
    await expect(inspector.locator('[data-page-boundary="end"]')).toHaveAttribute("data-label", "[2 end]");
    expect(await viewport.evaluate(node => node.scrollLeft)).toBe(1000);
    await verifyMarkers(page);
  } finally { await context.close(); }
});

test("a cross-chapter spread marks each visible page in its own source file", async () => {
  const fixture = navigationFixture(test.info(), [3, 2]);
  const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 1400, height: 900 } });
  try {
    await exposeReaderController(page);
    await page.evaluate(() => Reflect.get(window, "__readerController").turnPage(1));
    const inspector = await openInspector(page);
    await verifyMarkers(page);
    await inspector.locator('button[data-file-path="EPUB/c0.xhtml"]').click();
    await expect(inspector.locator('[data-page-boundary="start"]')).toHaveAttribute("data-label", "[3 start]");
    await inspector.locator('button[data-file-path="EPUB/c1.xhtml"]').click();
    await expect(inspector.locator("pre.ambra-hljs")).toContainText("Chapter 2");
    await expect(inspector.locator('[data-page-boundary="start"]')).toHaveAttribute("data-label", "[4 start]");
    await expect(inspector.locator("[data-page-boundary]")).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("cross-chapter-page-boundaries.png") });
  } finally {
    await context.close();
  }
});

for (const mode of ["scroll", "fixed-layout"]) {
  test(`${mode}: no invented pagination boundaries`, async () => {
    const fixture = mode === "scroll" ? book : fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url));
    const { context, readerPage: page } = await launchReader(fixture, { viewport: { width: 1400, height: 900 } });
    try {
      await exposeReaderController(page);
      if (mode === "scroll") await page.evaluate(() => Reflect.get(window, "__readerController").setViewMode("scroll"));
      await settle(page);
      const inspector = await openInspector(page);
      await expect(inspector.locator("[data-page-boundary]")).toHaveCount(0);
      await expect(inspector).not.toContainText("fixed-layout");
      await expect(inspector).not.toContainText("Page boundaries");
    } finally {
      await context.close();
    }

  });
}
