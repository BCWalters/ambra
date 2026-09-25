import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { exposeReaderController } from "./reader-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The real, self-contained production bundle `build:extension` produces
 * (see `scripts/build-extension.mjs`) — deliberately *not*
 * `apps/extension/dist`, which is reserved for CRXJS's own dev-mode
 * loader stubs the maintainer's live-reloaded Chrome window depends on. */
export const EXTENSION_PATH = process.env.AMBRA_E2E_EXTENSION_PATH
  ? path.resolve(process.env.AMBRA_E2E_EXTENSION_PATH)
  : path.resolve(here, ".extension-build");

export interface LaunchedReader {
  context: BrowserContext;
  /** The library page this book was imported/opened from — still open,
   * in case a test needs to go back to it (e.g. to import a second
   * book). */
  libraryPage: Page;
  readerPage: Page;
  extensionId: string;
}

/** Use only after Library has initialized the real preference store. */
export async function seedReadingWelcomeAcknowledgement(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ambra-library");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("preferences", "readwrite");
        tx.objectStore("preferences").put({ key: "readingWelcomeVersion", value: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
}

/** Launches a persistent Chromium context with the *real, built*
 * extension loaded (see `EXTENSION_PATH`), imports `bookPath` via the
 * library page's file picker, opens it, and returns the resulting
 * reader page — the same "import → open" flow a real user drives by
 * hand, not a shortcut around it, so this suite exercises the actual
 * library/import code path too, not just the reader in isolation.
 *
 * Each call owns a unique profile under this package's ignored test-results
 * directory. Closing the context removes that profile; failed setup closes
 * the context and removes it before rethrowing the original failure. */
export async function launchReader(
  bookPath: string,
  options: {
    viewport?: { width: number; height: number } | null;
    showScrollbars?: boolean;
    forceAccessibility?: boolean;
    hasTouch?: boolean;
    /** Exercise the production first-reading welcome instead of seeding its acknowledgement. */
    firstReadingWelcome?: boolean;
    /** Optional real-profile setup/assertions before importing the first book. */
    beforeBookImport?: (libraryPage: Page) => Promise<void>;
  } = {},
): Promise<LaunchedReader> {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(
      `Built extension not found at ${EXTENSION_PATH} — run "pnpm --filter @ambra/e2e run build:extension" first (the "test" script does this automatically).`,
    );
  }
  const profileRoot = path.join(here, "test-results", "reader-profiles");
  fs.mkdirSync(profileRoot, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(profileRoot, "ambra-e2e-"));
  let profileRemoved = false;
  const removeOwnedProfile = () => {
    if (profileRemoved) return;
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      profileRemoved = true;
    } catch (error) {
      console.warn("Could not remove the owned reader test profile.", error);
    }
  };
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: process.env.AMBRA_E2E_HEADLESS === "1",
      ignoreDefaultArgs: options.showScrollbars ? ["--hide-scrollbars"] : [],
      ...(process.env.AMBRA_E2E_HEADLESS === "1" ? { channel: "chromium" } : {}),
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        ...(options.forceAccessibility ? ["--force-renderer-accessibility"] : []),
      ],
      viewport:
        options.viewport === null ? null : (options.viewport ?? { width: 900, height: 900 }),
      ...(options.hasTouch ? { hasTouch: true } : {}),
    });
    context.once("close", removeOwnedProfile);

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const extensionId = serviceWorker.url().split("/")[2]!;

    const libraryPage = await context.newPage();
    await libraryPage.goto(`chrome-extension://${extensionId}/src/library/index.html`);
    const fileInput = libraryPage.locator('input[type="file"]');
    // setInputFiles can dispatch a change on a disabled input; wait for the
    // same readiness gate a person using the Import button must pass.
    await expect(fileInput).toBeEnabled({ timeout: 15_000 });
    if (!options.firstReadingWelcome) {
      // Most reader regressions start with an experienced profile. Seed only this
      // preference through the real database, never a production/headless bypass.
      await seedReadingWelcomeAcknowledgement(libraryPage);
    }
    await options.beforeBookImport?.(libraryPage);
    await fileInput.setInputFiles(bookPath);

    const openButton = libraryPage.getByRole("button", { name: /^Open /i }).first();
    await openButton.waitFor({ timeout: 20_000 });
    await openButton.click({ force: true });

    await libraryPage.waitForTimeout(500);
    let readerPage: Page | undefined;
    for (let attempt = 0; attempt < 40 && !readerPage; attempt++) {
      readerPage = context.pages().find((page) => page.url().includes("/reader/"));
      if (!readerPage) {
        await libraryPage.waitForTimeout(250);
      }
    }
    if (!readerPage) {
      throw new Error("Reader page never opened after clicking Open.");
    }
    await readerPage.waitForLoadState("domcontentloaded");
    // A fixed settle window rather than waiting on a specific readiness
    // signal — deliberately simple, since every test that uses this then
    // does its own explicit waiting (for text, for a page-number label,
    // etc.) before asserting anything.
    await readerPage.waitForTimeout(1500);

    return { context, libraryPage, readerPage, extensionId };
  } catch (error) {
    try {
      await context?.close();
    } catch (closeError) {
      console.warn("Could not close the failed reader test context.", closeError);
    }
    removeOwnedProfile();
    throw error;
  }
}

/** The current per-chapter page label ("Page N of M"), or `null` if not
 * showing (e.g. scroll mode, fixed-layout, or mid-transition). Every
 * navigation-correctness test polls this rather than assuming a fixed
 * animation delay, so it's robust to whichever page-turn animation
 * style is currently the default. */
export async function currentPageLabel(readerPage: Page): Promise<string | null> {
  return readerPage.evaluate(() => {
    const match = document.body.innerText.match(/Page \d+ of \d+/);
    return match ? match[0] : null;
  });
}

/** Clicks the forward outer margin (left for RTL)
 * and waits (polling `currentPageLabel`) for the page label to actually
 * change, up to `timeoutMs`. Returns `false` (without throwing) if it
 * never changes — the caller decides whether that's a real failure
 * (most navigation tests treat it as exactly that: see the "no dead
 * clicks" suite) or an expected end-of-book stop. */
export async function clickForwardAndWait(
  readerPage: Page,
  timeoutMs = 3000,
): Promise<{ changed: boolean; before: string | null; after: string | null }> {
  const before = await currentPageLabel(readerPage);
  await exposeReaderController(readerPage);
  const rtl = await readerPage.evaluate(() =>
    Reflect.get(window, "__readerController").pkg.pageProgressionDirection === "rtl");
  await clickReadingPage(readerPage, rtl ? "left" : "right");
  const start = Date.now();
  let after = before;
  while (Date.now() - start < timeoutMs) {
    await readerPage.waitForTimeout(50);
    after = await currentPageLabel(readerPage);
    if (after !== before) {
      break;
    }
  }
  return { changed: after !== before, before, after };
}

/** A page-turning click, including the separate UI-dismissal tap when needed.
 * Navigation tests use this only with unpinned chrome and no open panels. */
export async function clickReadingPage(
  readerPage: Page,
  side: "left" | "right",
): Promise<void> {
  const point = await outerMarginPoint(readerPage, side);
  const toolbar = readerPage
    .getByRole("button", { name: /^(Bookmark this page|Remove bookmark)$/ })
    .locator("..");
  if (await toolbar.evaluate((element) => getComputedStyle(element).pointerEvents !== "none")) {
    await exposeReaderController(readerPage);
    // Rearm the idle timer so chrome cannot auto-hide between the probe and tap.
    await readerPage.mouse.move(10, 10);
    await expect(toolbar).toHaveCSS("pointer-events", "auto");
    await expect(toolbar).toHaveCSS("opacity", "1");
    const position = () =>
      readerPage.evaluate(() => {
        const s = Reflect.get(window, "__readerController").snapshot();
        return { spine: s.spineIndex, page: s.pageIndex };
      });
    const before = await position();
    await readerPage.mouse.click(point.x, point.y);
    await expect(toolbar).toHaveCSS("pointer-events", "none");
    await readerPage.waitForFunction(() => {
      const c = Reflect.get(window, "__readerController");
      return !c.isTurningPage && !c.isLoadInFlight && !c.isApplyingLayout && !c.pendingLayout;
    });
    expect(await position(), "dismissing chrome is not a page turn").toEqual(before);
  }
  await readerPage.mouse.click(point.x, point.y);
}

/** Uses rendered page bounds, never an arbitrary third of publication content.
 * Throws for width-fitted FXL: those surfaces have no lateral click margin. */
export async function outerMarginPoint(
  page: Page,
  side: "left" | "right" = "right",
): Promise<{ x: number; y: number }> {
  await exposeReaderController(page);
  return page.evaluate(side => {
    const c = Reflect.get(window, "__readerController");
    const pane = c.containerEl.getBoundingClientRect();
    const frames: HTMLIFrameElement[] = c.snapshot().isSpread && !c.snapshot().isFixedLayout
      ? [c.host.columnElement("left"), c.host.columnElement("right")]
      : c.contentDocumentViews().map((view: { document: Document }) => view.document.defaultView!.frameElement);
    const reference = c.contentDocumentViews()[0].document as Document;
    const edges = frames.map(frame => {
      const rect = frame.getBoundingClientRect();
      if (c.snapshot().isFixedLayout) return { left: rect.left, right: rect.right };
      const doc = getComputedStyle(frame).visibility === "hidden" ? reference : frame.contentDocument!;
      const body = doc.body.getBoundingClientRect();
      const style = doc.defaultView!.getComputedStyle(doc.body);
      const scale = rect.width / frame.clientWidth;
      return {
        left: rect.left + (body.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)) * scale,
        right: rect.left + (body.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)) * scale,
      };
    });
    const edge = side === "left"
      ? Math.min(...edges.map(edge => edge.left)) : Math.max(...edges.map(edge => edge.right));
    const outside = side === "left" ? pane.left : pane.right;
    if (Math.abs(outside - edge) < 2) throw new Error("No physical outer margin at this viewport size");
    return { x: (outside + edge) / 2, y: pane.top + pane.height * 0.45 };
  }, side);
}

/** All the reflowable text content currently painted on screen for the
 * *primary* content iframe (first one found) — used by the "no skipped
 * or duplicated content" tests to accumulate what was actually shown
 * across a run of page turns, exactly as a reader would have read it. */
export async function currentPageText(readerPage: Page): Promise<string> {
  return readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe");
    return iframe?.contentDocument?.body?.innerText ?? "";
  });
}
