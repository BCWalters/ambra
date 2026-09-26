import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clickReadingPage, launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

async function ready(page: Page) {
  await page.locator("iframe").first().waitFor({ state: "attached" });
  await exposeReaderController(page);
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return (
      c?.host &&
      !c.isLoadInFlight &&
      !c.isTurningPage &&
      !c.isApplyingLayout &&
      !c.pendingLayout &&
      !c.readingHistory?.restoring
    );
  });
}

async function location(page: Page) {
  return page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const native = c.nativeReading.current();
    const point = native ?? c.host.currentPosition();
    const spine = native?.spineIndex ?? c.spineIndex;
    const doc = point.node.ownerDocument as Document;
    const selection = doc.getSelection();
    const visual = c.host.currentPosition();
    return {
      cfi: c.locatorResolver.generate(spine, point.node, point.offset).cfi as string,
      visual: c.locatorResolver.generate(c.spineIndex, visual.node, visual.offset).cfi as string,
      spine: spine as number,
      caret: selection?.anchorNode
        ? (c.locatorResolver.generate(spine, selection.anchorNode, selection.anchorOffset)
            .cfi as string)
        : undefined,
      collapsed: selection?.isCollapsed,
      focused: doc.defaultView?.frameElement === document.activeElement,
      history: history.state.__ambraReading as { cfi: string; index: number; session: string },
      length: history.length,
    };
  });
}

async function at(page: Page, cfi: string) {
  await expect
    .poll(async () => {
      await ready(page);
      return (await location(page)).cfi;
    })
    .toBe(cfi);
  await expect.poll(async () => (await location(page)).history.cfi).toBe(cfi);
}

async function go(page: Page, value: number, percentage = false) {
  await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+${percentage ? "Shift+" : ""}g`);
  const modal = page.getByRole("dialog", {
    name: `Go to ${percentage ? "Percentage" : "Page"}`,
    exact: true,
  });
  await expect(modal).toBeVisible();
  await modal.getByRole("spinbutton").fill(String(value));
  await modal.getByRole("spinbutton").press("Enter");
  await expect(modal).toBeHidden();
  await ready(page);
  await expect.poll(async () => (await location(page)).focused).toBe(true);
}

async function toc(page: Page, label: string) {
  await page.mouse.move(350, 2);
  await page.getByRole("button", { name: "Show contents", exact: true }).click();
  const panel = page.getByRole("navigation", { name: "Table of contents" });
  await panel
    .getByRole("button")
    .filter({
      has: page.locator("span").filter({ hasText: new RegExp(`^${label}$`) }),
    })
    .click();
  await expect(panel).toBeHidden();
  await ready(page);
}

test("native Back/Forward preserves A → jump B → ordinary C, branching and reload without new UI or book reload", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await page.waitForFunction(
      () => Reflect.get(window, "__readerController").snapshot().bookPageCount === 10,
    );
    await page.evaluate(() => {
      Reflect.set(window, "__historyDocument", "same-reader-document");
      history.replaceState({ ...history.state, unrelated: { preserved: true } }, "");
    });
    const a = await location(page);
    await go(page, 4);
    const b = await location(page);
    expect(b.cfi).not.toBe(a.cfi);
    expect(b.length).toBe(a.length + 1);
    await clickReadingPage(page, "right");
    await ready(page);
    const c = await location(page);
    expect(c.cfi).not.toBe(b.cfi);
    expect(c.length).toBe(b.length);
    await page.goBack();
    await at(page, a.cfi);
    expect((await location(page)).focused).toBe(true);
    expect((await location(page)).collapsed).toBe(true);
    await page.goForward();
    await at(page, c.cfi);
    expect(await page.evaluate(() => Reflect.get(window, "__historyDocument"))).toBe(
      "same-reader-document",
    );
    expect(await page.evaluate(() => history.state.unrelated)).toEqual({ preserved: true });
    expect(page.url()).not.toContain("epubcfi");

    await toc(page, "Chapter 3");
    const d = await location(page);
    await page.goBack();
    await at(page, c.cfi);
    await page.reload();
    await ready(page);
    await at(page, c.cfi);
    expect((await location(page)).history.session).toBe(a.history.session);
    await page.goForward();
    await at(page, d.cfi);
    await page.goBack();
    await at(page, c.cfi);
    await go(page, 20, true);
    const branch = await location(page);
    expect(branch.cfi).not.toBe(d.cfi);
    await page.goForward();
    await at(page, branch.cfi);
    await page.goBack();
    await at(page, c.cfi);
    await page.goBack();
    await at(page, a.cfi);
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await expect(page).toHaveURL(/library\/index\.html\?view=tab/);
    expect(await page.evaluate(() => history.scrollRestoration)).toBe("auto");
    await page.goBack();
    await ready(page);
    await at(page, a.cfi);
  } finally {
    await context.close();
  }
});

for (const mode of ["paginated", "scroll"]) {
  test(`${mode}: saved text offsets survive typography, resize and reload without rewriting bookmarks`, async () => {
    const book = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
    const { context, readerPage: page } = await launchReader(book);
    try {
      await ready(page);
      const saved = await page.evaluate(async (mode) => {
        const c = Reflect.get(window, "__readerController");
        await c.setViewMode(mode);
        const doc = c.contentDocumentViews()[0].document as Document;
        const paragraphs = doc.querySelectorAll("p");
        const text = paragraphs[Math.floor(paragraphs.length * 0.6)]!.firstChild!;
        const cfi = c.locatorResolver.generate(0, text, 7).cfi as string;
        await c.library.addBookmark(c.bookId, cfi, "Exact text destination");
        await c.refreshBookmarks();
        return cfi;
      }, mode);
      await ready(page);
      const origin = await location(page);
      const openSaved = async () => {
        await page.mouse.move(350, 2);
        await page.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
        const panel = page.getByRole("navigation", { name: "Bookmarks and highlights" });
        await panel.locator("[data-bookmark-link]").click();
        await expect(panel).toBeHidden();
        await ready(page);
      };
      await openSaved();
      await at(page, saved);
      expect((await location(page)).caret).toBe(saved);
      const destination = await location(page);
      await page.evaluate(async () => {
        const c = Reflect.get(window, "__readerController");
        await c.setFontScale(1.4);
        await c.setLineSpacing(1.6);
      });
      await page.setViewportSize({ width: 1400, height: 780 });
      await ready(page);
      expect((await location(page)).length).toBe(destination.length);
      expect((await location(page)).history.cfi).toBe(saved);
      const next = await page.evaluate(
        () => Reflect.get(window, "__readerController").snapshot().toc[1].label as string,
      );
      await toc(page, next);
      await page.goBack();
      await at(page, saved);
      expect((await location(page)).caret).toBe(saved);
      expect((await location(page)).collapsed).toBe(true);
      await page.reload();
      await ready(page);
      await at(page, saved);
      expect(
        await page.evaluate(
          () => Reflect.get(window, "__readerController").snapshot().bookmarks[0].cfi,
        ),
      ).toBe(saved);
      await page.goBack();
      await at(page, origin.cfi);
      await page.goForward();
      await at(page, saved);

      if (mode === "scroll") {
        const length = (await location(page)).length;
        await page.evaluate(() => {
          const c = Reflect.get(window, "__readerController");
          Reflect.set(window, "__historyScrollEnd", new Promise<void>(resolve =>
            c.contentDocumentViews()[0].document.addEventListener("scrollend", resolve, { once: true })));
        });
        await page.mouse.move(500, 430);
        await page.mouse.wheel(0, 750);
        await page.evaluate(() => Reflect.get(window, "__historyScrollEnd"));
        await expect.poll(async () => (await location(page)).cfi).not.toBe(saved);
        const current = await location(page);
        expect(current.cfi).not.toBe(saved);
        await page.goBack();
        await at(page, origin.cfi);
        await page.goForward();
        await at(page, current.cfi);
        expect((await location(page)).length).toBe(length);
      }
    } finally {
      await context.close();
    }
  });
}

test("legacy parent-offset bookmarks remain unchanged across history restoration and spread reflow", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [4, 3]));
  try {
    await ready(page);
    const legacy = await page.evaluate(async () => {
      const c = Reflect.get(window, "__readerController");
      const doc = c.contentDocumentViews()[0].document;
      const cfi = c.locatorResolver.generate(0, doc.body, 2).cfi as string;
      await c.library.addBookmark(c.bookId, cfi, "Legacy parent offset");
      await c.refreshBookmarks();
      return cfi;
    });
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
    await page.locator("[data-bookmark-link]").click();
    await ready(page);
    await at(page, legacy);
    await page.evaluate(() => Reflect.get(window, "__readerController").setFontScale(1.2));
    await page.setViewportSize({ width: 1400, height: 900 });
    await ready(page);
    await toc(page, "Chapter 2");
    await page.goBack();
    await at(page, legacy);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookmarks[0].cfi)).toBe(legacy);
  } finally {
    await context.close();
  }
});

test("search result jumps and saved highlight/note routes use the same history boundary", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  try {
    await ready(page);
    const origin = await location(page);
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search this book…" }).fill("C3Para 2");
    const result = page.getByRole("button", { name: /Chapter 3.*C3Para 2/ });
    await expect(result).toHaveCount(1);
    await result.click();
    await ready(page);
    const found = await location(page);
    expect(found.spine).toBe(2);
    expect(found.length).toBe(origin.length + 1);
    await page.goBack();
    await at(page, origin.cfi);
    await page.goForward();
    await at(page, found.cfi);
    for (const method of ["goToHighlight", "goToReadOnlyAnnotation"] as const) {
      await page.evaluate(
        async ({ method, cfi }) => {
          const c = Reflect.get(window, "__readerController");
          await c[method](cfi);
        },
        { method, cfi: origin.cfi },
      );
      await at(page, origin.cfi);
      await page.goBack();
      await at(page, found.cfi);
    }
    expect(
      await page.evaluate(() => {
        const c = Reflect.get(window, "__readerController");
        return {
          toolbar: c.selectionToolbar,
          selection: c.pendingSelectionRange,
          note: c.activeHighlight,
        };
      }),
    ).toEqual({ toolbar: undefined, selection: undefined, note: undefined });
  } finally {
    await context.close();
  }
});

async function holdIncomingFrame(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")!;
    const gate = { held: false, release: (_fail = false) => {} };
    Reflect.set(window, "__historyGate", gate);
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      ...descriptor,
      set(this: HTMLIFrameElement, value: string) {
        if (!gate.held && c.containerEl.contains(this)) {
          gate.held = true;
          Object.defineProperty(HTMLIFrameElement.prototype, "src", descriptor);
          const block = (event: Event) => event.stopImmediatePropagation();
          this.addEventListener("load", block, true);
          gate.release = (fail = false) => {
            this.removeEventListener("load", block, true);
            if (fail) this.dispatchEvent(new Event("error"));
            else if (this.isConnected) descriptor.set!.call(this, value);
          };
          return;
        }
        descriptor.set!.call(this, value);
      },
    });
  });
}

test("rapid native traversals cancel stale loads; failed jumps/restores keep content and stack recoverable", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await ready(page);
    const a = await location(page);
    await toc(page, "Chapter 2");
    const b = await location(page);
    await toc(page, "Chapter 3");
    const c = await location(page);
    await holdIncomingFrame(page);
    await page.goBack();
    await page.waitForFunction(() => Reflect.get(window, "__historyGate").held);
    await page.goBack();
    await at(page, a.cfi);
    await page.evaluate(() => Reflect.get(window, "__historyGate").release(true));
    await at(page, a.cfi);
    await page.goForward();
    await at(page, b.cfi);
    await holdIncomingFrame(page);
    await page.goBack();
    await page.waitForFunction(() => Reflect.get(window, "__historyGate").held);
    await page.evaluate(() => Reflect.get(window, "__historyGate").release(true));
    await expect.poll(async () => (await location(page)).history.index).toBe(b.history.index);
    await at(page, b.cfi);
    await page.goBack();
    await at(page, a.cfi);
    await page.goForward();
    await at(page, b.cfi);
    await page.goForward();
    await at(page, c.cfi);
    await holdIncomingFrame(page);
    const failedJump = toc(page, "Chapter 1");
    await page.waitForFunction(() => Reflect.get(window, "__historyGate").held);
    await page.evaluate(() => Reflect.get(window, "__historyGate").release(true));
    await failedJump;
    expect((await location(page)).length).toBe(c.length);
    expect((await location(page)).cfi).toBe(c.cfi);
    await page.evaluate(() => Reflect.get(window, "__readerController").goToBookmark("epubcfi(/6/2!/4:999999)"));
    expect((await location(page)).length).toBe(c.length);
    expect((await location(page)).cfi).toBe(c.cfi);
    await page.goBack();
    await at(page, b.cfi);
    await holdIncomingFrame(page);
    const cancelledJump = toc(page, "Chapter 1");
    await page.waitForFunction(() => Reflect.get(window, "__historyGate").held);
    await toc(page, "Chapter 3");
    await page.evaluate(() => Reflect.get(window, "__historyGate").release(true));
    await cancelledJump;
    await at(page, c.cfi);
    expect((await location(page)).length).toBe(c.length);
    expect((await location(page)).history.index).toBe(c.history.index);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("committed scrubber jumps record once; drag preview, ordinary turns, no-op and cancelled Go do not", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [3, 4, 3]));
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    const slider = page.getByRole("slider", { name: "Position in book" });
    await expect(slider).toHaveAttribute("aria-valuetext", /^Page 1 of 10/);
    const a = await location(page);
    await slider.focus();
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2, { steps: 8 });
    expect((await location(page)).length).toBe(a.length);
    expect((await location(page)).cfi).toBe(a.cfi);
    await page.mouse.up();
    await ready(page);
    const b = await location(page);
    expect(b.length).toBe(a.length + 1);
    await go(page, 7);
    expect((await location(page)).length).toBe(b.length);
    await page.evaluate(() => Reflect.get(window, "__readerController").restoreContentFocus());
    const modifier = await page.evaluate(() =>
      /Mac/i.test(navigator.platform) ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+g`);
    await page.getByRole("dialog", { name: "Go to Page" }).getByRole("spinbutton").fill("9");
    await page.keyboard.press("Escape");
    expect((await location(page)).length).toBe(b.length);
    await clickReadingPage(page, "right");
    await ready(page);
    const c = await location(page);
    expect(c.length).toBe(b.length);
    await page.goBack();
    await at(page, a.cfi);
    await page.goForward();
    await at(page, c.cfi);
  } finally {
    await context.close();
  }
});

test("EPUB anchor links share top-level history, while popup footnotes and broken targets do not move", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const book = navigationFixture(info, [4, 3]);
  const source = info.outputPath("navigation-source");
  const chapter = path.join(source, "EPUB/c0.xhtml");
  let content = fs
    .readFileSync(chapter, "utf8")
    .replace("<html xmlns=", '<html xmlns:epub="http://www.idpf.org/2007/ops" xmlns=');
  content = content.replace(
    "<body>",
    '<body><p><a href="#middle">Same chapter</a> <a href="c1.xhtml">Other chapter</a> <a href="#missing">Broken target</a> <a href="#note" epub:type="noteref">Popup note</a> <a href="https://history.example/elsewhere">External page</a></p>',
  );
  let svg = 0;
  content = content.replace(/<svg /g, (match) => `${match}${++svg === 3 ? 'id="middle" ' : ""}`);
  content = content.replace("</svg>", '<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="c1.xhtml"><text x="20" y="80" font-size="20">SVG chapter</text></a></svg>');
  content = content.replace(
    "</body>",
    '<aside id="note" epub:type="footnote">Original popup note text.</aside></body>',
  );
  fs.writeFileSync(chapter, content);
  execFileSync("zip", ["-q", "-X", book, "EPUB/c0.xhtml"], { cwd: source });
  const { context, readerPage: page } = await launchReader(book);
  try {
    await ready(page);
    const a = await location(page);
    const clickLink = async (name: string) => {
      const url = await page.evaluate(
        () =>
          Reflect.get(window, "__readerController").contentDocumentViews()[0].document
            .URL as string,
      );
      const link = page
        .frames()
        .find((frame) => frame.url() === url)!
        .locator("a").filter({ hasText: new RegExp(`^${name}$`) });
      await link.focus();
      const origin = await location(page);
      await link.click();
      return origin;
    };
    await clickLink("Popup note");
    await expect(page.getByText("Original popup note text.", { exact: true })).toBeVisible();
    expect((await location(page)).length).toBe(a.length);
    await page.keyboard.press("Escape");
    await clickLink("Broken target");
    await expect(
      page.getByText(/The linked reading position #missing was not found/),
    ).toBeVisible();
    expect((await location(page)).length).toBe(a.length);
    expect((await location(page)).visual).toBe(a.visual);
    const sameOrigin = await clickLink("Same chapter");
    await ready(page);
    const b = await location(page);
    expect(b.cfi).not.toBe(a.cfi);
    expect(b.length).toBe(a.length + 1);
    await page.goBack();
    await at(page, sameOrigin.cfi);
    const otherOrigin = await clickLink("Other chapter");
    await ready(page);
    expect((await location(page)).spine).toBe(1);
    expect((await location(page)).length).toBe(a.length + 1);
    await page.goBack();
    await at(page, otherOrigin.cfi);
    const svgOrigin = await clickLink("SVG chapter");
    await ready(page);
    expect((await location(page)).spine).toBe(1);
    expect((await location(page)).length).toBe(a.length + 1);
    await page.goBack();
    await at(page, svgOrigin.cfi);
    await clickReadingPage(page, "left");
    await ready(page);
    await context.route("https://history.example/elsewhere", route => route.fulfill({ body: "<h1>External document</h1>", contentType: "text/html" }));
    const popup = context.waitForEvent("page");
    await clickLink("External page");
    const external = await popup;
    await expect(external).toHaveURL("https://history.example/elsewhere");
    await external.close();
    expect((await location(page)).length).toBe(a.length + 1);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("iframe")].every(
          (frame) => frame.getAttribute("sandbox") === "allow-same-origin",
        ),
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("RTL mixed-layout navigation preserves reflowable anchors between fixed-layout pages", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const book = navigationFixture(info, [1, 3, 1]);
  const source = info.outputPath("navigation-source");
  const opf = path.join(source, "EPUB/package.opf");
  fs.writeFileSync(opf, fs.readFileSync(opf, "utf8")
    .replace("<spine>", '<spine page-progression-direction="rtl">')
    .replace('<itemref idref="c0"/>', '<itemref idref="c0" properties="rendition:layout-pre-paginated"/>')
    .replace('<itemref idref="c2"/>', '<itemref idref="c2" properties="rendition:layout-pre-paginated"/>'));
  for (const index of [0, 2]) {
    const file = path.join(source, `EPUB/c${index}.xhtml`);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("</head>", '<meta name="viewport" content="width=600,height=800"/></head>'));
  }
  execFileSync("zip", ["-q", "-X", "-r", book, "EPUB"], { cwd: source });
  const { context, readerPage: page } = await launchReader(book);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    const a = await location(page);
    await toc(page, "Chapter 2");
    const b = await location(page);
    expect(b.spine).toBe(1);
    await clickReadingPage(page, "left");
    await ready(page);
    const c = await location(page);
    expect(c.cfi).not.toBe(b.cfi);
    expect(c.spine).toBe(1);
    expect(c.length).toBe(b.length);
    await toc(page, "Chapter 3");
    const d = await location(page);
    expect(d.spine).toBe(2);
    expect(d.length).toBe(a.length + 2);
    await page.setViewportSize({ width: 1400, height: 900 });
    await ready(page);
    await page.goBack();
    await at(page, c.cfi);
    await page.goBack();
    await at(page, a.cfi);
    await page.goForward();
    await at(page, c.cfi);
    await page.goForward();
    await at(page, d.cfi);
  } finally {
    await context.close();
  }
});

test("browser traversal keeps narration playing without resuming follow or stale selection", async () => {
  const book = fileURLToPath(new URL("../fixtures/media-overlay/narrated.epub", import.meta.url));
  const { context, readerPage: page } = await launchReader(book);
  try {
    await ready(page);
    await page.mouse.move(350, 2);
    await page.getByRole("button", { name: "Listen", exact: true }).click();
    const audio = page.locator("audio[data-ambra-narration-audio]");
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    await ready(page);
    const a = await location(page);
    await toc(page, "Narrated chapter 2");
    const b = await location(page);
    await expect(page.getByRole("button", { name: "Return to narration", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const c = Reflect.get(window, "__readerController");
      const doc = c.contentDocumentViews()[0].document as Document;
      const text = doc.querySelector("p")!.firstChild!;
      const range = doc.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(3, text.textContent!.length));
      doc.getSelection()!.removeAllRanges();
      doc.getSelection()!.addRange(range);
    });
    await page.goBack();
    await at(page, a.cfi);
    expect((await location(page)).collapsed).toBe(true);
    expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().narration.following)).toBe(false);
    await page.goForward();
    await at(page, b.cfi);
    expect(await audio.evaluate(element => (element as HTMLAudioElement).paused)).toBe(false);
  } finally {
    await context.close();
  }
});

for (const direction of ["ltr", "rtl"]) {
  test(`${direction} fixed-layout companion identity survives browser traversal and spread resize`, async () => {
    const book = fileURLToPath(
      new URL(`../fixtures/fxl-spread-${direction}.epub`, import.meta.url),
    );
    const { context, readerPage: page } = await launchReader(book, {
      viewport: { width: 1400, height: 900 },
    });
    try {
      await ready(page);
      const a = await location(page);
      const slider = page.getByRole("slider", { name: "Position in book" });
      await expect(slider).toHaveAttribute("aria-valuetext", "Page 1 of 5");
      await slider.focus();
      await slider.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "Page 2 of 5");
      await ready(page);
      const b = await location(page);
      expect(b.spine).toBe(1);
      await slider.focus();
      await slider.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", "Page 3 of 5");
      await ready(page);
      const c = await location(page);
      expect(c.spine).toBe(2);
      await page.setViewportSize({ width: 760, height: 900 });
      await ready(page);
      expect((await location(page)).length).toBe(c.length);
      await page.goBack();
      await at(page, b.cfi);
      expect((await location(page)).spine).toBe(1);
      await page.goBack();
      await at(page, a.cfi);
      await page.goForward();
      await at(page, b.cfi);
      await page.goForward();
      await at(page, c.cfi);
      expect((await location(page)).spine).toBe(2);
    } finally {
      await context.close();
    }
  });
}
