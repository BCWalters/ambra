import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";
import { CHROME_THEMES } from "../../extension/src/reader/chromeTheme.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/**
 * The About Ambra flyout (issue #123) — a static panel packaged with
 * the extension itself, not a separate page/tab, so it opens and closes
 * in place over the Library exactly like `BookDetailsFlyout` does.
 */
test.describe("About Ambra flyout", () => {
  test("feedback leaves the actual extension popup in a separate browsing context", async () => {
    const { context, libraryPage, extensionId } = await launchReader(LONG_CONTENT_EPUB);
    try {
      await libraryPage.bringToFront();
      await libraryPage.evaluate(() => chrome.action.openPopup());
      // Chromium exposes action popups as "other" targets, not Playwright Pages.
      await expect.poll(() => libraryPage.evaluate(() =>
        !!chrome.extension.getViews({ type: "popup" })[0]?.document.querySelector('[aria-label="About Ambra"]'),
      )).toBe(true);
      await libraryPage.evaluate(() => {
        chrome.extension.getViews({ type: "popup" })[0]!.document
          .querySelector<HTMLButtonElement>('[aria-label="About Ambra"]')!.click();
      });
      await expect.poll(() => libraryPage.evaluate(() => {
        const link = chrome.extension.getViews({ type: "popup" })[0]?.document
          .querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
        return link && { href: link.href, target: link.target, rel: link.rel };
      })).toEqual({ href: "mailto:AmbraEPUB@outlook.com", target: "_blank", rel: "noreferrer" });

      // Exercise the popup's real navigation without launching the host's mail application.
      const destination = `chrome-extension://${extensionId}/src/library/index.html?fullTab=1`;
      const openedTab = context.waitForEvent("page");
      await libraryPage.evaluate(destination => {
        const link = chrome.extension.getViews({ type: "popup" })[0]!.document
          .querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
        link.href = destination;
        link.click();
      }, destination);
      const tab = await openedTab;
      await expect(tab).toHaveURL(destination);
      await expect(tab.getByRole("button", { name: "Import EPUB" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("opens from the toolbar button, shows credits/links, and closes via Escape", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      const aboutButton = libraryPage.getByRole("button", { name: "About Ambra" });
      await expect(aboutButton).toBeVisible();
      await aboutButton.click();

      const aside = libraryPage.getByRole("dialog", { name: "About Ambra" });
      await expect(aside).toBeVisible();
      await expect(aside).toHaveAttribute("aria-modal", "true");
      const closeButton = aside.getByRole("button", { name: "Close", exact: true });
      await expect(closeButton).toBeFocused();
      await libraryPage.keyboard.press("Shift+Tab");
      await expect(aside.getByRole("button", { name: "Standards and open source" })).toBeFocused();
      await libraryPage.keyboard.press("Tab");
      await expect(closeButton).toBeFocused();
      await expect(aside.getByText("Ben Walters")).toBeVisible();
      await expect(aside.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/BCWalters/ambra",
      );
      await expect(aside.getByRole("link", { name: "Report an issue or request a feature" })).toHaveAttribute(
        "href",
        "mailto:AmbraEPUB@outlook.com",
      );
      await expect(aside.getByText("An EPUB reader designed for comfortable, beautiful reading.")).toBeVisible();
      await expect(aside.getByRole("link", { name: "EPUB 3.4 specification" })).toBeHidden();
      await aside.getByRole("button", { name: "Standards and open source" }).focus();
      await libraryPage.keyboard.press("Space");
      await expect(aside.getByRole("link", { name: "EPUB 3.4 specification" })).toBeVisible();
      await expect(aside.getByRole("link", { name: "React", exact: true })).toBeVisible();

      await libraryPage.keyboard.press("Escape");
      await expect(aside).not.toBeVisible();
      await expect(aboutButton).toBeFocused();

      // Reopening must establish a fresh focus scope, not retain a hidden trap.
      await libraryPage.keyboard.press("Enter");
      await expect(closeButton).toBeFocused();
      await closeButton.press("Enter");
      await expect(aside).not.toBeVisible();
      await expect(aboutButton).toBeFocused();
    } finally {
      await context.close();
    }
  });

  test("the copy diagnostics button copies environment info to the clipboard", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await libraryPage.getByRole("button", { name: "About Ambra" }).click();
      await libraryPage.getByRole("button", { name: "Copy diagnostics" }).click();
      await expect(libraryPage.getByRole("button", { name: "Copied!" })).toBeVisible();

      const clipboardText = await libraryPage.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toContain("Ambra environment info");
      expect(clipboardText).toContain("Extension version:");
      expect(clipboardText).not.toContain("long-content.epub");
    } finally {
      await context.close();
    }
  });

  test("clipboard failure is visible and permits retry", async () => {
    const { context, libraryPage } = await launchReader(LONG_CONTENT_EPUB);
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await libraryPage.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        let fail = true;
        navigator.clipboard.writeText = async (text) => {
          if (fail) {
            fail = false;
            throw new DOMException("Clipboard permission denied.", "NotAllowedError");
          }
          await write(text);
        };
      });
      await libraryPage.getByRole("button", { name: "About Ambra" }).click();
      const pane = libraryPage.getByRole("dialog", { name: "About Ambra" });
      await pane.getByRole("button", { name: "Copy diagnostics" }).click();
      await expect(pane.getByRole("alert")).toHaveText("Could not copy diagnostics. Clipboard permission denied.");
      await pane.getByRole("button", { name: "Copy diagnostics" }).click();
      await expect(pane.getByRole("button", { name: "Copied!" })).toBeVisible();
      await expect(pane.getByRole("alert")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("the feedback action fits a narrow pane and diagnostics follow every chrome theme", async () => {
    const { context, libraryPage, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
      viewport: { width: 360, height: 700 },
    });
    try {
      await exposeReaderController(readerPage);
      for (const theme of ["ambra", "purple", "green", "blue", "silver"] as const) {
        await readerPage.evaluate(async choice => {
          await Reflect.get(window, "__readerController").setChromeTheme(choice);
        }, theme);
        await libraryPage.reload();
        await libraryPage.getByRole("button", { name: "About Ambra" }).click();
        const pane = libraryPage.getByRole("dialog", { name: "About Ambra" });
        const copy = pane.getByRole("button", { name: "Copy diagnostics" });
        await expect(copy).toHaveCSS("background-image", CHROME_THEMES[theme].backgroundSolid);
        const bounds = await pane.evaluate(element => {
          const action = element.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
          const panel = element.getBoundingClientRect();
          const button = action.getBoundingClientRect();
          return {
            fits: button.left >= panel.left && button.right <= panel.right,
            aboveFold: button.bottom <= window.innerHeight,
            overflow: element.scrollWidth - element.clientWidth,
          };
        });
        expect(bounds).toEqual({ fits: true, aboveFold: true, overflow: 0 });
      }
    } finally {
      await context.close();
    }
  });
});
