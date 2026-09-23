import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

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
        `--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`,
        ...(options.forceAccessibility ? ["--force-renderer-accessibility"] : []),
      ],
      viewport: options.viewport === null ? null : options.viewport ?? { width: 900, height: 900 },
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

/** Clicks in the right third of the reader pane (the established
 * "turn forward" tap zone — see `ReaderController.handleContentClick`)
 * and waits (polling `currentPageLabel`) for the page label to actually
 * change, up to `timeoutMs`. Returns `false` (without throwing) if it
 * never changes — the caller decides whether that's a real failure
 * (most navigation tests treat it as exactly that: see the "no dead
 * clicks" suite) or an expected end-of-book stop. */
export async function clickForwardAndWait(
  readerPage: Page,
  point: { x: number; y: number },
  timeoutMs = 3000,
): Promise<{ changed: boolean; before: string | null; after: string | null }> {
  const before = await currentPageLabel(readerPage);
  await readerPage.mouse.click(point.x, point.y);
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
