import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { navigationFixture } from "../navigation-fixture.js";
import { exposeReaderController } from "../reader-controller.js";

const proseBook = fileURLToPath(new URL("../fixtures/two-chapter.epub", import.meta.url));
const shortcutDialog = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
const bookmark = (page: Page) => page.getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ });

async function ready(page: Page) {
  await expect(page.locator("iframe").first()).toBeAttached();
  await exposeReaderController(page);
  await settled(page);
}

async function settled(page: Page) {
  await page.waitForFunction(() => {
    const c = Reflect.get(window, "__readerController");
    return c?.host && !c.isApplyingLayout && !c.isLoadInFlight && !c.isTurningPage && !c.pendingLayout;
  });
}

// Observe the mounted controller, but never stub dispatch or navigation: every
// tested command below enters through a real shell/iframe keyboard event.
async function position(page: Page) {
  return page.evaluate(() => {
    const s = Reflect.get(window, "__readerController").snapshot();
    return { spine: s.spineIndex as number, page: s.pageIndex as number };
  });
}

async function bookmarkCount(page: Page): Promise<number> {
  return page.evaluate(() => Reflect.get(window, "__readerController").snapshot().bookmarks.length);
}

async function viewMode(page: Page): Promise<string> {
  return page.evaluate(() => Reflect.get(window, "__readerController").snapshot().viewMode);
}

async function rememberReadingPosition(page: Page) {
  await page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const native = c.nativeReading.current();
    const spineIndex = native?.spineIndex ?? c.spineIndex;
    const point = native ?? c.host.currentPosition();
    Reflect.set(window, "__shortcutReadingPosition", {
      spineIndex, locator: c.locatorResolver.generate(spineIndex, point.node, point.offset),
    });
  });
}

async function expectReadingPositionVisible(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const c = Reflect.get(window, "__readerController");
    const saved = Reflect.get(window, "__shortcutReadingPosition");
    return c.contentDocumentViews().some(({ document: doc, spineIndex }: { document: Document; spineIndex: number }) => {
      if (spineIndex !== saved.spineIndex) return false;
      const resolved = c.locatorResolver.resolveInDocument(saved.locator, spineIndex, doc);
      const range = doc.createRange();
      if (resolved.node.nodeType === Node.TEXT_NODE) {
        const offset = resolved.characterOffset ?? 0;
        range.setStart(resolved.node, offset);
        range.setEnd(resolved.node, Math.min(offset + 1, resolved.node.textContent.length));
      } else {
        range.selectNodeContents(resolved.node);
      }
      return [...range.getClientRects()].some(rect =>
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < doc.defaultView!.innerHeight &&
        rect.right > 0 && rect.left < doc.defaultView!.innerWidth);
    });
  })).toBe(true);
}

async function mod(page: Page) {
  return page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control");
}

async function focusReading(page: Page, spine?: number) {
  await settled(page);
  await page.evaluate(spine => {
    const views = Reflect.get(window, "__readerController").contentDocumentViews() as {
      document: Document; spineIndex: number;
    }[];
    const view = spine === undefined ? views[0] : views.find(view => view.spineIndex === spine);
    if (!view) throw new Error(`No rendered document for spine ${spine}`);
    view.document.getSelection()?.removeAllRanges();
    (view.document.defaultView!.frameElement as HTMLElement).focus({ preventScroll: true });
    view.document.body.tabIndex = -1;
    view.document.body.focus({ preventScroll: true });
  }, spine);
}

async function focusShell(page: Page) {
  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges();
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
  });
}

async function expectReadingFocus(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const frame = document.activeElement;
    return frame instanceof HTMLIFrameElement && frame.getAttribute("aria-hidden") !== "true" &&
      !!frame.contentDocument?.activeElement?.isConnected;
  })).toBe(true);
}

async function turn(page: Page, key: string, expected: { spine: number; page: number }) {
  await page.keyboard.press(key);
  await expect.poll(() => position(page)).toEqual(expected);
  await settled(page);
}

async function openShortcuts(page: Page) {
  await page.keyboard.press(`${await mod(page)}+/`);
  await expect(shortcutDialog(page)).toBeVisible();
}

async function saved(page: Page) {
  await expect(shortcutDialog(page).getByRole("status")).toHaveText("Shortcut settings saved.");
}

function directionalFixture(info: TestInfo, direction: "ltr" | "rtl") {
  const book = navigationFixture(info, [4, 3, 2]);
  if (direction === "rtl") {
    const source = info.outputPath("navigation-source");
    const opf = path.join(source, "EPUB/package.opf");
    fs.writeFileSync(opf, fs.readFileSync(opf, "utf8")
      .replace("<spine>", '<spine page-progression-direction="rtl">'));
    execFileSync("zip", ["-q", "-X", "-r", book, "EPUB"], { cwd: source });
  }
  return book;
}

for (const direction of ["ltr", "rtl"] as const) {
  test(`${direction}: physical arrows, logical paging and section commands execute from content and shell`, async ({ browserName: _browserName }, info) => {
    const { context, readerPage: page } = await launchReader(directionalFixture(info, direction), {
      viewport: { width: 760, height: 900 },
    });
    try {
      await ready(page);
      await focusReading(page);
      await turn(page, direction === "rtl" ? "ArrowLeft" : "ArrowRight", { spine: 0, page: 1 });
      await turn(page, direction === "rtl" ? "ArrowRight" : "ArrowLeft", { spine: 0, page: 0 });
      await turn(page, "PageDown", { spine: 0, page: 1 });
      await turn(page, "PageUp", { spine: 0, page: 0 });
      await turn(page, "Space", { spine: 0, page: 1 });
      await turn(page, "Shift+Space", { spine: 0, page: 0 });
      await turn(page, "Alt+PageDown", { spine: 1, page: 0 });
      await focusReading(page, 1);
      await turn(page, "Alt+PageUp", { spine: 0, page: 0 });

      // Controls retain their native keys; the unfenced shell also dispatches.
      await focusShell(page);
      await turn(page, "Alt+PageDown", { spine: 1, page: 0 });
      await focusShell(page);
      await turn(page, "Alt+PageUp", { spine: 0, page: 0 });
      expect(await bookmarkCount(page)).toBe(0);
    } finally {
      await context.close();
    }
  });
}

test("merged short sections navigate relative to the focused document, not its primary companion", async ({ browserName: _browserName }, info) => {
  const { context, readerPage: page } = await launchReader(navigationFixture(info, [1, 1, 1, 1, 1]), {
    viewport: { width: 1400, height: 900 },
  });
  try {
    await ready(page);
    const focusedSpine = () => page.evaluate(() => {
      const views = Reflect.get(window, "__readerController").contentDocumentViews() as {
        document: Document; spineIndex: number;
      }[];
      return views.find(view => view.document.defaultView?.frameElement === document.activeElement)?.spineIndex;
    });
    await focusReading(page, 0);
    await page.keyboard.press("Alt+PageDown");
    await expect.poll(focusedSpine).toBe(1);
    await settled(page);
    // Both sections can remain on the same painted spread. Focus, rather than
    // a changed page label, proves the first command actually reached section 2.
    await page.keyboard.press("Alt+PageDown");
    await expect.poll(focusedSpine).toBe(2);
    await settled(page);
    await page.keyboard.press("Alt+PageUp");
    await expect.poll(focusedSpine).toBe(1);
    await settled(page);
    await focusReading(page, 0);
    const before = await position(page);
    await page.keyboard.press("PageDown");
    await expect.poll(() => position(page)).not.toEqual(before);
    await settled(page);
    await expect.poll(() => page.evaluate(() =>
      Reflect.get(window, "__readerController").contentDocumentViews()
        .some((view: { spineIndex: number }) => view.spineIndex === 2))).toBe(true);
  } finally {
    await context.close();
  }
});

test("mode commands preserve reading position and focus, are idempotent, and leave native scrolling and sections intact", async () => {
  const { context, readerPage: page } = await launchReader(proseBook, { viewport: { width: 760, height: 900 } });
  try {
    await ready(page);
    await focusReading(page, 0);
    await turn(page, "PageDown", { spine: 0, page: 1 });
    await rememberReadingPosition(page);
    for (const mode of ["scroll", "paginated", "scroll"]) {
      const key = mode === "scroll" ? "Alt+Shift+PageDown" : "Alt+Shift+PageUp";
      await page.keyboard.press(key);
      await expect.poll(() => viewMode(page)).toBe(mode);
      await settled(page);
      await expectReadingFocus(page);
      await expectReadingPositionVisible(page);
      expect((await position(page)).spine).toBe(0);
      await page.evaluate(() => Reflect.set(window, "__shortcutModeFrame", document.activeElement));
      await page.keyboard.press(key);
      await settled(page);
      expect(await viewMode(page)).toBe(mode);
      expect(await page.evaluate(() => document.activeElement === Reflect.get(window, "__shortcutModeFrame"))).toBe(true);
      await expectReadingPositionVisible(page);
    }
    const scrollTop = () => page.evaluate(() => {
      const doc = (document.activeElement as HTMLIFrameElement).contentDocument!;
      return Math.max(doc.scrollingElement?.scrollTop ?? 0,
        ...Array.from(document.querySelectorAll<HTMLElement>("*")).map(node => node.scrollTop));
    });
    const initial = await scrollTop();
    await page.keyboard.press("PageDown");
    await expect.poll(scrollTop).toBeGreaterThan(initial + 30);
    const down = await scrollTop();
    await page.keyboard.press("PageUp");
    await expect.poll(scrollTop).toBeLessThan(down - 30);
    const up = await scrollTop();
    await page.keyboard.press("Space");
    await expect.poll(scrollTop).toBeGreaterThan(up + 30);
    expect((await position(page)).spine).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await position(page)).spine).toBe(1);
    await settled(page);
    await focusReading(page, 1);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await position(page)).spine).toBe(0);
    await settled(page);
    await focusReading(page, 0);
    await page.keyboard.press("Alt+PageDown");
    await expect.poll(async () => (await position(page)).spine).toBe(1);
    await settled(page);
    expect(await viewMode(page)).toBe("scroll");
    await focusReading(page, 1);
    await page.keyboard.press("Alt+PageUp");
    await expect.poll(async () => (await position(page)).spine).toBe(0);
    expect(await viewMode(page)).toBe("scroll");
  } finally {
    await context.close();
  }
});

test("fixed-layout content and shell leave reflowable mode chords unhandled", async () => {
  const { context, readerPage: page } = await launchReader(
    fileURLToPath(new URL("../fixtures/fxl-spread-ltr.epub", import.meta.url)),
  );
  try {
    await ready(page);
    const before = await position(page);
    const mode = await viewMode(page);
    expect(await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().isFixedLayout)).toBe(true);
    for (const scope of ["shell", "iframe"] as const) {
      const prevented = await page.evaluate(scope => {
        const doc = scope === "shell" ? document : document.querySelector("iframe")!.contentDocument!;
        return ["PageDown", "PageUp"].map(key => {
          const event = new KeyboardEvent("keydown", {
            key, altKey: true, shiftKey: true, bubbles: true, cancelable: true,
          });
          doc.body.dispatchEvent(event);
          return event.defaultPrevented;
        });
      }, scope);
      expect(prevented).toEqual([false, false]);
    }
    await settled(page);
    expect(await position(page)).toEqual(before);
    expect(await viewMode(page)).toBe(mode);
    await expect(page.locator("iframe").first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("bookmark and search execute once from iframe and shell, with toolbar actions and focus return", async () => {
  const { context, readerPage: page } = await launchReader(proseBook);
  try {
    await ready(page);
    const modifier = await mod(page);
    await focusReading(page);
    await page.keyboard.down(modifier);
    await page.keyboard.down("b");
    await expect.poll(() => bookmarkCount(page)).toBe(1);
    await page.keyboard.down("b"); // A second keydown without keyup is a real repeat.
    await page.keyboard.up("b");
    await page.keyboard.up(modifier);
    await expect(bookmark(page)).toHaveAttribute("aria-pressed", "true");
    expect(await bookmarkCount(page)).toBe(1);
    await focusShell(page);
    await page.keyboard.press(`${modifier}+b`);
    await expect.poll(() => bookmarkCount(page)).toBe(0);
    await expect(bookmark(page)).toHaveAttribute("aria-pressed", "false");
    await bookmark(page).focus();
    await page.keyboard.press(`${modifier}+b`);
    await expect.poll(() => bookmarkCount(page)).toBe(1);
    await page.keyboard.press(`${modifier}+b`);
    await expect.poll(() => bookmarkCount(page)).toBe(0);
    await page.keyboard.press("Enter");
    await expect.poll(() => bookmarkCount(page)).toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => bookmarkCount(page)).toBe(0);

    for (const origin of ["iframe", "shell", "toolbar"]) {
      if (origin === "iframe") await focusReading(page);
      else if (origin === "shell") await focusShell(page);
      else await bookmark(page).focus();
      await page.keyboard.press(`${modifier}+f`);
      const search = page.getByRole("searchbox", { name: "Search this book…" });
      await expect(search).toBeFocused();
      await search.fill("quick");
      await expect(page.getByRole("navigation", { name: "Search", exact: true })
        .getByRole("button").filter({ has: page.locator("strong") }).first()).toBeVisible();
      if (origin === "toolbar") {
        await bookmark(page).focus();
        await page.keyboard.press(`${modifier}+f`);
        await expect(search).toBeFocused();
        await bookmark(page).focus();
        await openShortcuts(page);
        await page.keyboard.press("Escape");
        await expect(shortcutDialog(page)).toBeHidden();
        await expect(search).toBeVisible();
        await expect(bookmark(page)).toBeFocused();
      }
      await page.getByRole("button", { name: "Close search panel", exact: true }).focus();
      await page.keyboard.press(`${modifier}+f`);
      await expect(search).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(search).toBeHidden();
      if (origin === "toolbar") await expect(bookmark(page)).toBeFocused();
      else await expectReadingFocus(page);
    }
    await bookmark(page).focus();
    await expect(bookmark(page)).toHaveAttribute("aria-keyshortcuts", `${modifier}+B`);
    await expect(page.getByRole("tooltip")).toContainText(/Bookmark this page/);
    await expect(page.getByRole("tooltip")).toContainText(modifier === "Meta" ? "⌘B" : "Ctrl+B");
  } finally {
    await context.close();
  }
});

test("editing, selection, widgets, menus and dialogs keep ownership; removed history and zoom bindings stay native", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(proseBook);
  try {
    await ready(page);
    const modifier = await mod(page);
    const initial = await position(page);
    for (const scope of ["shell", "iframe"] as const) {
      await page.evaluate(scope => {
        const doc = scope === "shell" ? document : document.querySelector("iframe")!.contentDocument!;
        const editor = doc.createElement("textarea");
        editor.id = "shortcut-test-editor";
        editor.style.cssText = "position:fixed;top:100px;left:100px;z-index:9999";
        editor.value = "Editable text";
        doc.body.append(editor);
        editor.focus();
      }, scope);
      await page.keyboard.press("Alt+PageDown");
      await page.keyboard.press(`${modifier}+b`);
      await page.keyboard.press("PageDown");
      expect(await position(page)).toEqual(initial);
      expect(await bookmarkCount(page)).toBe(0);
      await page.evaluate(scope => {
        const doc = scope === "shell" ? document : document.querySelector("iframe")!.contentDocument!;
        doc.getElementById("shortcut-test-editor")!.remove();
      }, scope);
    }
    await focusReading(page);
    await page.evaluate(() => {
      const doc = (document.activeElement as HTMLIFrameElement).contentDocument!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("p")!);
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    expect(await page.evaluate(() => (document.activeElement as HTMLIFrameElement)
      .contentDocument!.getSelection()!.toString())).toContain("quick");
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press("PageDown");
    expect(await position(page)).toEqual(initial);
    expect(await bookmarkCount(page)).toBe(0);
    await focusReading(page);
    await page.evaluate(() => {
      const doc = (document.activeElement as HTMLIFrameElement).contentDocument!;
      const details = doc.createElement("details");
      details.id = "shortcut-test-widget";
      details.style.cssText = "position:fixed;top:100px;left:100px";
      details.innerHTML = "<summary>Native shortcut disclosure</summary><p>Expanded</p>";
      doc.body.append(details);
      details.querySelector("summary")!.focus();
    });
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => document.querySelector("iframe")!.contentDocument!
      .querySelector<HTMLDetailsElement>("#shortcut-test-widget")!.open)).toBe(true);
    expect(await position(page)).toEqual(initial);
    await page.evaluate(() => {
      const slider = document.createElement("input");
      slider.id = "shortcut-test-slider";
      slider.type = "range";
      slider.value = "50";
      slider.style.cssText = "position:fixed;top:100px;left:100px;z-index:9999";
      document.body.append(slider);
      slider.focus();
    });
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#shortcut-test-slider")).toHaveValue("51");
    await page.keyboard.press(`${modifier}+b`);
    expect(await position(page)).toEqual(initial);
    expect(await bookmarkCount(page)).toBe(0);
    await page.locator("#shortcut-test-slider").evaluate(node => node.remove());
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.keyboard.press("Alt+PageDown");
    await page.keyboard.press(`${modifier}+b`);
    expect(await position(page)).toEqual(initial);
    expect(await bookmarkCount(page)).toBe(0);
    await page.keyboard.press("Escape");
    await focusReading(page);
    await openShortcuts(page);
    await page.keyboard.press("PageDown");
    await page.keyboard.press(`${modifier}+b`);
    expect(await position(page)).toEqual(initial);
    expect(await bookmarkCount(page)).toBe(0);
    await page.keyboard.press("Escape");

    // Synthetic events deliberately avoid native history/zoom side effects.
    for (const scope of ["shell", "iframe"] as const) {
      const prevented = await page.evaluate(scope => {
        const doc = scope === "shell" ? document : document.querySelector("iframe")!.contentDocument!;
        doc.body.tabIndex = -1;
        doc.body.focus();
        return ["ArrowLeft", "ArrowRight", "+", "-", "0"].map(key => {
          const event = new KeyboardEvent("keydown", {
            key, bubbles: true, cancelable: true,
            ...(/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }),
          });
          doc.body.dispatchEvent(event);
          return event.defaultPrevented;
        });
      }, scope);
      expect(prevented).toEqual([false, false, false, false, false]);
    }
    const libraryFindPrevented = await libraryPage.evaluate(() => {
      const event = new KeyboardEvent("keydown", {
        key: "f", bubbles: true, cancelable: true,
        ...(/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }),
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(libraryFindPrevented).toBe(false);
  } finally {
    await context.close();
  }
});

test("a visible Settings tooltip cannot consume the first Escape in its menu or Help", async () => {
  const { context, readerPage: page } = await launchReader(proseBook);
  try {
    await ready(page);
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    const tooltip = page.getByRole("tooltip", { name: "Settings", exact: true });
    for (const target of ["menu", "help"] as const) {
      await settings.hover();
      await expect(tooltip).toBeVisible();
      await settings.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      // Sample once: waiting for the tooltip's hide timer would conceal the bug.
      expect(await tooltip.count()).toBe(0);
      if (target === "help") {
        await page.getByRole("menuitem", { name: "Help & About", exact: true }).focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog", { name: "Help & About", exact: true })).toBeVisible();
        expect(await tooltip.count()).toBe(0);
      }
      await page.keyboard.press("Escape");
      await expect(target === "menu" ? menu : page.getByRole("dialog", { name: "Help & About", exact: true })).toBeHidden();
      await expect(settings).toBeFocused();
      await page.mouse.move(450, 450);
    }
  } finally {
    await context.close();
  }
});

test("Help & About has shared keyboard entry, correct Escape focus and a readable 320px shortcut guide", async () => {
  const { context, readerPage: page, libraryPage } = await launchReader(proseBook);
  try {
    await ready(page);
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    await settings.focus();
    await page.keyboard.press("Enter");
    const helpItem = page.getByRole("menuitem", { name: "Help & About", exact: true });
    await helpItem.focus();
    await page.keyboard.press("Enter");
    const help = page.getByRole("dialog", { name: "Help & About", exact: true });
    await expect(help).toBeVisible();
    await expect(page.getByRole("button", { name: "Help & About", exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("help-desktop.png") });
    await help.getByRole("button", { name: "Show keyboard shortcuts", exact: true }).click();
    await expect(shortcutDialog(page)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("shortcuts-desktop.png") });
    await page.keyboard.press("Escape");
    await expect(shortcutDialog(page)).toBeHidden();
    await expect(help).toBeVisible();
    await expect(help.getByRole("button", { name: "Show keyboard shortcuts", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();

    for (const [opener, closeButton, modal] of [
      ["Show contents", "Close contents panel", "help"],
      ["Bookmarks and highlights", "Close bookmarks and highlights panel", "shortcuts"],
    ] as const) {
      await page.getByRole("button", { name: opener, exact: true }).click();
      const underlying = page.getByRole("button", { name: closeButton, exact: true });
      await expect(underlying).toBeVisible();
      if (modal === "help") {
        await settings.focus();
        await page.keyboard.press("Enter");
        await helpItem.focus();
        await page.keyboard.press("Enter");
        await expect(help).toBeVisible();
      } else {
        await bookmark(page).focus();
        await openShortcuts(page);
      }
      await page.keyboard.press("Escape");
      await expect(modal === "help" ? help : shortcutDialog(page)).toBeHidden();
      await expect(underlying).toBeVisible();
      await underlying.click();
      await expect(underlying).toBeHidden();
    }

    const libraryHelp = libraryPage.getByRole("button", { name: "Help & About", exact: true });
    await libraryHelp.focus();
    await libraryPage.keyboard.press("Enter");
    await expect(libraryPage.getByRole("dialog", { name: "Help & About", exact: true })).toBeVisible();
    await libraryPage.keyboard.press("Escape");
    await expect(libraryHelp).toBeFocused();
    await focusShell(libraryPage);
    await openShortcuts(libraryPage);
    await libraryPage.keyboard.press("Escape");
    await expect(shortcutDialog(libraryPage)).toBeHidden();

    await page.setViewportSize({ width: 320, height: 480 });
    await settled(page);
    await settings.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    for (const [name, chord] of [
      [/^Paginated/, "Alt+Shift+PageUp"],
      [/^Scroll/, "Alt+Shift+PageDown"],
    ] as const) {
      const mode = menu.getByRole("menuitemradio", { name });
      await expect(mode).toHaveAttribute("aria-keyshortcuts", chord);
      await mode.focus();
      await expect(mode).toBeInViewport({ ratio: 1 });
      // Fluent's focus ring is a ::after extending 2px beyond the item. Check
      // actual label/hint boxes and the scrollport, not that intentional ring.
      expect(await mode.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return Array.from(node.children).every(child => {
          const rect = child.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right &&
            child.scrollWidth <= child.clientWidth + 1;
        });
      })).toBe(true);
    }
    expect(await menu.locator("..").evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expect(menu.locator("..")).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await focusReading(page);
    await openShortcuts(page);
    const dialog = shortcutDialog(page);
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath("shortcuts-320px.png") });
    for (const label of ["Navigation", "Reading", "Help"]) {
      await expect(dialog.getByRole("heading", { name: label, exact: true })).toHaveCount(1);
    }
    await expect(dialog.getByRole("button", { name: /Change|Disable|Reset|Restore|Press keys/i })).toHaveCount(0);
    const enabled = dialog.getByRole("checkbox", { name: "Enable keyboard shortcuts", exact: true });
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await enabled.focus();
    await expect(enabled).toBeInViewport({ ratio: 1 });
    await expect(enabled).toBeFocused();
    expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expectReadingFocus(page);
    await settings.focus();
    await page.keyboard.press("Enter");
    await helpItem.focus();
    await page.keyboard.press("Enter");
    await expect(help).toBeVisible();
    await expect(help).toBeInViewport({ ratio: 1 });
    await expect(help.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.screenshot({ path: test.info().outputPath("help-320px.png") });
    await expect(help.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
  } finally {
    await context.close();
  }
});

for (const viewport of [{ width: 900, height: 900 }, { width: 320, height: 256 }]) {
  test(`${viewport.width}px: Book Details opens Help without leaving the book and restores its footer focus`, async () => {
    const { context, readerPage: page } = await launchReader(proseBook, { viewport });
    try {
      await ready(page);
      const initialPosition = await position(page);
      const url = page.url();
      await expect(page.getByRole("button", { name: "Help & About", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Book details", exact: true }).focus();
      await page.keyboard.press("Enter");
      const details = page.getByRole("complementary", { name: "Book details", exact: true });
      await expect(details).toBeFocused();
      const entry = details.getByRole("button", { name: "Help & About", exact: true });
      await expect(entry).toBeInViewport({ ratio: 1 });
      for (let index = 0; index < 20 && !await entry.evaluate(node => node === document.activeElement); index++) {
        await page.keyboard.press("Tab");
      }
      await expect(entry).toBeFocused();
      await page.keyboard.press("Enter");
      const help = page.getByRole("dialog", { name: "Help & About", exact: true });
      await expect(help).toBeVisible();
      await expect(help.getByRole("button", { name: "Copy diagnostics", exact: true })).toBeAttached();
      await expect(page).toHaveURL(url);
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();
      await expect(details).toBeVisible();
      await expect(entry).toBeFocused();
      await expect(entry).toBeInViewport({ ratio: 1 });
      await page.keyboard.press("Escape");
      await expect(details).toBeHidden();
      await expectReadingFocus(page);
      await expect.poll(() => position(page)).toEqual(initialPosition);
      await expect(page.getByRole("button", { name: "Help & About", exact: true })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

test("global disable persists and updates live across tabs; visible Help re-enables default routes and hints", async () => {
  test.setTimeout(90_000);
  const { context, readerPage: page, libraryPage } = await launchReader(proseBook);
  try {
    await ready(page);
    const modifier = await mod(page);
    await focusShell(libraryPage);
    await openShortcuts(libraryPage);
    const dialog = shortcutDialog(libraryPage);
    const enabled = dialog.getByRole("checkbox", { name: "Enable keyboard shortcuts", exact: true });
    await expect(dialog.getByRole("button", { name: /Change|Disable|Reset|Restore|Press keys/i })).toHaveCount(0);
    await enabled.focus();
    await enabled.press("Space");
    await saved(libraryPage);
    await expect(enabled).not.toBeChecked();
    await expect(bookmark(page)).not.toHaveAttribute("aria-keyshortcuts");
    await bookmark(page).focus();
    await expect(page.getByRole("tooltip")).toContainText("Bookmark this page");
    await expect(page.getByRole("tooltip")).not.toContainText(modifier === "Meta" ? "⌘B" : "Ctrl+B");
    await focusReading(page);
    const before = await position(page);
    const mode = await viewMode(page);
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+PageDown");
    await page.keyboard.press("Alt+Shift+PageDown");
    await page.keyboard.press(`${modifier}+/`);
    expect(await bookmarkCount(page)).toBe(0);
    expect(await position(page)).toEqual(before);
    expect(await viewMode(page)).toBe(mode);
    await expect(shortcutDialog(page)).toBeHidden();
    expect(await page.evaluate(() => {
      const doc = (document.activeElement as HTMLIFrameElement).contentDocument!;
      const event = new KeyboardEvent("keydown", {
        key: "f", bubbles: true, cancelable: true,
        ...(/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }),
      });
      doc.body.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(false);
    await expect(page.getByRole("searchbox", { name: "Search this book…" })).toBeHidden();
    await page.reload();
    await ready(page);
    await expect(bookmark(page)).not.toHaveAttribute("aria-keyshortcuts");
    await focusReading(page);
    await page.keyboard.press(`${modifier}+b`);
    expect(await bookmarkCount(page)).toBe(0);
    await libraryPage.keyboard.press("Escape");
    const helpButton = libraryPage.getByRole("button", { name: "Help & About", exact: true });
    await helpButton.click();
    const help = libraryPage.getByRole("dialog", { name: "Help & About", exact: true });
    const showShortcuts = help.getByRole("button", { name: "Show keyboard shortcuts", exact: true });
    await expect(showShortcuts).not.toHaveAttribute("aria-keyshortcuts");
    await showShortcuts.click();
    await expect(enabled).not.toBeChecked();
    await enabled.focus();
    await enabled.press("Space");
    await saved(libraryPage);
    await expect(enabled).toBeChecked();
    await expect(bookmark(page)).toHaveAttribute("aria-keyshortcuts", `${modifier}+B`);
    await focusReading(page);
    await page.keyboard.press(`${modifier}+b`);
    await expect.poll(() => bookmarkCount(page)).toBe(1);
    await bookmark(page).focus();
    await expect(page.getByRole("tooltip")).toContainText(modifier === "Meta" ? "⌘B" : "Ctrl+B");
    await focusReading(page);
    await openShortcuts(page);
    await expect(shortcutDialog(page).getByRole("checkbox", { name: "Enable keyboard shortcuts", exact: true })).toBeChecked();
  } finally {
    await context.close();
  }
});
