import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function frameFor(page: Page, spineIndex: number) {
  const index = await page.evaluate(spineIndex => {
    const controller = Reflect.get(window, "__readerController");
    const view = controller.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === spineIndex);
    return [...document.querySelectorAll("iframe")].indexOf(view.document.defaultView.frameElement);
  }, spineIndex);
  return page.frameLocator("iframe").nth(index);
}

async function focusedSpine(page: Page) {
  return page.evaluate(() => {
    const controller = Reflect.get(window, "__readerController");
    return controller.contentDocumentViews().find((view: { document: Document }) =>
      document.activeElement === view.document.defaultView?.frameElement,
    )?.spineIndex;
  });
}

for (const { mode, width } of [
  { mode: "paginated", width: 900 },
  { mode: "paginated", width: 1400 },
  { mode: "scroll", width: 900 },
] as const) {
  test(`${mode} ${width}px: chapter-end native navigation is reachable, focus-visible, explicit, and final`, async () => {
    const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"), {
      viewport: { width, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(async mode => {
        const controller = Reflect.get(window, "__readerController");
        await controller.setPageTurnAnimationStyle("none");
        if (mode === "scroll") await controller.setViewMode(mode);
        else await controller.seekToFraction(0.3);
      }, mode);
      const frame = await frameFor(page, 0);
      const nav = frame.getByRole("navigation", { name: "Continue reading" });
      const next = nav.getByRole("button", { name: /^Next chapter: / });
      await expect(next).toHaveCount(1);
      await expect(nav).toHaveCSS("clip-path", "inset(50%)");

      // Native AX order includes the actual end-of-document navigation, despite
      // visual clipping. This does not emulate VoiceOver's separate virtual cursor.
      const ax = await frame.locator("body").ariaSnapshot();
      expect(ax).toContain('navigation "Continue reading"');
      expect(ax.lastIndexOf('navigation "Continue reading"')).toBeGreaterThan(ax.lastIndexOf("- paragraph:"));
      const before = await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex);
      expect(before).toBe(0);

      // Place native focus at the final publication paragraph, then Tab, not a
      // programmatic click on an off-screen control.
      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.contentDocumentViews()[0].document as Document;
        const last = [...doc.querySelectorAll("p")].at(-1)!;
        controller.accessibility.focusContent(doc, last);
      });
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
      await expect(nav).toHaveCSS("clip-path", "none");
      const bounds = await nav.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          height: innerHeight, width: innerWidth, scroll: document.scrollingElement?.scrollTop ?? 0 };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
      if (mode === "paginated") expect(bounds.scroll).toBe(0);
      expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().spineIndex)).toBe(0);

      // Space must activate the native button once, not the reader's page shortcut.
      await page.keyboard.press("Space");
      await expect.poll(() => focusedSpine(page)).toBe(1);
      const destination = await frameFor(page, 1);
      await expect(destination.getByRole("button", { name: /^Next / })).toHaveCount(0);
      const end = destination.getByText("End of book", { exact: true });
      await expect(end).toHaveCount(1);
      expect(await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const doc = controller.contentDocumentViews()[0].document as Document;
        return !doc.activeElement?.hasAttribute("data-ambra-boundary") &&
          doc.activeElement?.getRootNode() === doc;
      })).toBe(true);
      await end.focus();
      await expect(end).toBeFocused();
      await expect(destination.getByRole("navigation", { name: "Continue reading" })).toHaveCSS("clip-path", "none");
    } finally {
      await context.close();
    }
  });
}

test("reader boundaries do not alter text, CFIs, page counts, or duplicate-spread exposure after reflow", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "two-chapter.epub"), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const snapshot = () => {
        const view = controller.contentDocumentViews()[0];
        const doc: Document = view.document;
        const text = [...doc.querySelectorAll("p")].at(-1)!.firstChild!;
        return {
          text: doc.body.textContent,
          cfi: controller.locatorResolver.generate(view.spineIndex, text, 3).toString(),
          count: controller.host.pageCount,
        };
      };
      const withBoundary = snapshot();
      controller.boundaryCleanup();
      controller.host.relayout(controller.width, controller.height);
      const withoutBoundary = snapshot();
      controller.setUpContentBoundaries();
      controller.host.relayout(controller.width, controller.height);
      const afterReflow = snapshot();
      const frames = [...document.querySelectorAll("iframe")];
      return {
        withBoundary, withoutBoundary, afterReflow,
        hidden: frames.filter(frame => frame.getAttribute("aria-hidden") === "true")
          .map(frame => frame.contentDocument!.querySelectorAll("[data-ambra-boundary]").length),
        roots: frames.filter(frame => frame.getAttribute("aria-hidden") !== "true")
          .map(frame => frame.contentDocument!.querySelectorAll("[data-ambra-boundary]").length),
      };
    });
    expect(result.withBoundary).toEqual(result.withoutBoundary);
    expect(result.afterReflow).toEqual(result.withoutBoundary);
    expect(result.hidden).toEqual([0]);
    expect(result.roots).toEqual([1]);
  } finally {
    await context.close();
  }
});

test("one-line sections expose a whole focused control, preserve their clip on blur, and include non-linear content", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "reading-boundaries.epub"));
  try {
    await exposeReaderController(page);
    const frame = await frameFor(page, 0);
    const next = frame.getByRole("button", { name: "Next section", exact: true });
    const before = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews()[0];
      const iframe = view.document.defaultView.frameElement as HTMLIFrameElement;
      return { height: iframe.style.height, clip: iframe.style.clipPath, pages: controller.host.pageCount,
        pageHeight: view.page.height, bodyClip: view.document.body.style.clipPath };
    });
    expect(before.pageHeight).toBeLessThan(25);
    await next.focus();
    await expect(next).toBeFocused();
    const focused = await next.evaluate(button => {
      const iframe = document.defaultView!.frameElement as HTMLIFrameElement;
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewport: innerHeight,
        clip: iframe.style.clipPath, bodyClip: document.body.style.clipPath,
        hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.hasAttribute("data-ambra-boundary") };
    });
    expect(focused.clip).toBe("");
    expect(focused.bodyClip).toMatch(/^polygon/);
    expect(focused.top).toBeGreaterThanOrEqual(0);
    expect(focused.bottom).toBeLessThanOrEqual(focused.viewport);
    expect(focused.hit).toBe(true);
    await next.evaluate(button => (button as HTMLElement).blur());
    expect(await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const view = controller.contentDocumentViews()[0];
      const iframe = view.document.defaultView.frameElement as HTMLIFrameElement;
      return { height: iframe.style.height, clip: iframe.style.clipPath, pages: controller.host.pageCount,
        pageHeight: view.page.height, bodyClip: view.document.body.style.clipPath };
    })).toEqual(before);
    await next.focus();
    await next.press("Enter");
    await expect.poll(() => focusedSpine(page)).toBe(1);
    const second = await frameFor(page, 1);
    const final = second.getByRole("button", { name: "Next chapter: Final chapter", exact: true });
    await final.focus();
    await final.press("Enter");
    await expect.poll(() => focusedSpine(page)).toBe(2);
    await expect((await frameFor(page, 2)).getByText("End of book", { exact: true })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("boundary installation preserves every mid-paragraph page and canonical offset", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "reading-entry.epub"));
  try {
    await exposeReaderController(page);
    const result = await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      const host = controller.host;
      const snapshot = () => ({
        text: host.element.contentDocument.body.textContent,
        pages: host.pages.map((page: {
          startBreak: { node: Node; offset?: number }; endBreak: { node: Node; offset?: number };
          height: number; topY: number;
        }) => ({
          start: controller.locatorResolver.generate(0, page.startBreak.node, page.startBreak.offset).toString(),
          endOffset: page.endBreak.offset,
          height: page.height,
          top: page.topY,
        })),
      });
      controller.boundaryCleanup();
      host.relayout(controller.width, controller.height);
      const before = snapshot();
      controller.setUpContentBoundaries();
      host.relayout(controller.width, controller.height);
      return { before, after: snapshot() };
    });
    expect(result.before.pages.length).toBeGreaterThan(10);
    expect(result.after).toEqual(result.before);
  } finally {
    await context.close();
  }
});

test("a merged reflowable spread visits its next document without replacing the spread", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "reading-boundaries.epub"), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await exposeReaderController(page);
    expect(await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      Reflect.set(window, "__boundaryHost", controller.host);
      return controller.contentDocumentViews().map((view: { spineIndex: number }) => view.spineIndex);
    })).toEqual([0, 1]);
    const first = (await frameFor(page, 0)).getByRole("button", { name: "Next section", exact: true });
    await first.focus();
    await first.press("Enter");
    await expect.poll(() => focusedSpine(page)).toBe(1);
    expect(await page.evaluate(() =>
      Reflect.get(window, "__readerController").host === Reflect.get(window, "__boundaryHost"),
    )).toBe(true);
    const second = (await frameFor(page, 1)).getByRole("button", { name: "Next chapter: Final chapter", exact: true });
    await second.focus();
    await second.press("Enter");
    await expect.poll(() => focusedSpine(page)).toBe(2);
  } finally {
    await context.close();
  }
});

test("a failed boundary load retains the current document and allows retry", async () => {
  const { context, readerPage: page } = await launchReader(path.join(fixtures, "reading-boundaries.epub"));
  try {
    await exposeReaderController(page);
    const frame = await frameFor(page, 0);
    const next = frame.getByRole("button", { name: "Next section", exact: true });
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      Reflect.set(window, "__boundaryOriginalLoad", controller.contentLoader.loadContentDocument);
      controller.contentLoader.loadContentDocument = async () => { throw new Error("Boundary load test failure"); };
    });
    await next.focus();
    await next.press("Enter");
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "__readerController").isLoadInFlight)).toBe(false);
    expect(await focusedSpine(page)).toBe(0);
    await expect(next).toBeFocused();
    await page.evaluate(() => {
      const controller = Reflect.get(window, "__readerController");
      controller.contentLoader.loadContentDocument = Reflect.get(window, "__boundaryOriginalLoad");
    });
    await next.press("Enter");
    await expect.poll(() => focusedSpine(page)).toBe(1);
  } finally {
    await context.close();
  }
});

for (const direction of ["ltr", "rtl"] as const) {
  test(`FXL ${direction}: Next page visits both spread documents in logical order before advancing`, async () => {
    const { context, readerPage: page } = await launchReader(path.join(fixtures, `fxl-spread-${direction}.epub`), {
      viewport: { width: 1200, height: 900 },
    });
    try {
      await exposeReaderController(page);
      await page.evaluate(() => Reflect.get(window, "__readerController").setPageTurnAnimationStyle("none"));
      for (let spineIndex = 0; spineIndex < 4; spineIndex++) {
        const frame = await frameFor(page, spineIndex);
        const next = frame.getByRole("button", { name: "Next page", exact: true });
        await next.focus();
        await next.press("Enter");
        await expect.poll(() => focusedSpine(page)).toBe(spineIndex + 1);
        expect(await page.evaluate(spineIndex => {
          const controller = Reflect.get(window, "__readerController");
          const view = controller.contentDocumentViews().find((view: { spineIndex: number }) => view.spineIndex === spineIndex);
          return view.document.getSelection()?.anchorNode?.getRootNode() === view.document &&
            !view.document.activeElement?.hasAttribute("data-ambra-boundary");
        }, spineIndex + 1)).toBe(true);
        if (spineIndex === 1) {
          const order = await page.evaluate(() =>
            Reflect.get(window, "__readerController").contentDocumentViews()
              .map((view: { spineIndex: number; physicalSide: string }) => [view.spineIndex, view.physicalSide]),
          );
          expect(order).toEqual(direction === "ltr" ? [[1, "left"], [2, "right"]] : [[1, "right"], [2, "left"]]);
          const columns = await page.evaluate(() => {
            const controller = Reflect.get(window, "__readerController");
            const views = controller.contentDocumentViews() as { document: Document; spineIndex: number }[];
            return Array.from(controller.host.element.querySelectorAll("iframe") as NodeListOf<HTMLIFrameElement>)
              .map(frame => ({
                spine: views.find(view => view.document === frame.contentDocument)?.spineIndex,
                x: frame.getBoundingClientRect().x,
              }));
          });
          expect(columns.map(column => column.spine)).toEqual([1, 2]);
          expect(columns[0]!.x < columns[1]!.x).toBe(direction === "ltr");
        }
      }
      const final = await frameFor(page, 4);
      await expect(final.getByText("End of book", { exact: true })).toHaveCount(1);
      await expect(final.getByRole("button", { name: "Next page", exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
