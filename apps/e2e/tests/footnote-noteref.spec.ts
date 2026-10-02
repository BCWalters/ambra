import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

/**
 * Spec-gap fix: `epub:type="noteref"` links previously behaved as plain
 * links (navigating to the footnote's own position in the flow, leaving
 * the reader to find their way back) and were never given the matching
 * `role="doc-noteref"`/`role="doc-footnote"` DPUB-ARIA roles assistive
 * technology needs to announce them as notes rather than generic links.
 * `fixtures/footnote.epub` declares a single `epub:type="noteref"` link
 * with a same-document `epub:type="footnote"` target.
 */
test("clicking an epub:type=noteref link shows its footnote content inline instead of navigating", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(__dirname, "../fixtures/footnote.epub"),
  );

  const roles = await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    return {
      noterefRole: doc.getElementById("fnref1")?.getAttribute("role"),
      footnoteRole: doc.getElementById("fn1")?.getAttribute("role"),
    };
  });
  expect(roles.noterefRole).toBe("doc-noteref");
  expect(roles.footnoteRole).toBe("doc-footnote");

  await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    const link = doc.getElementById("fnref1")!;
    const rect = link.getBoundingClientRect();
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.top,
      }),
    );
  });
  const popup = readerPage.getByRole("dialog", { name: "Footnote" });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("full text of the footnote");
  const stillOnChapter1 = await readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    return iframe.contentDocument?.querySelector("h1")?.textContent;
  });
  expect(stillOnChapter1).toBe("Chapter 1");
  await readerPage.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await context.close();
});

for (const exit of ["Escape", "Close"] as const) {
  test(`keyboard footnote ${exit} restores the reference without moving the reading position`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.resolve(__dirname, "../fixtures/footnote.epub"),
    );
    try {
      await exposeReaderController(page);
      const position = () =>
        page.evaluate(() => {
          const snapshot = Reflect.get(window, "__readerController").snapshot();
          return { spine: snapshot.spineIndex, page: snapshot.pageIndex };
        });
      const before = await position();
      const reference = page.frameLocator("iframe").first().locator("#fnref1");
      await reference.focus();
      await reference.press("Enter");
      const popup = page.getByRole("dialog", { name: "Footnote", exact: true });
      await expect(popup).toBeFocused();
      if (exit === "Escape") await page.keyboard.press("Escape");
      else await popup.getByRole("button", { name: "Close", exact: true }).click();
      await expect(popup).toHaveCount(0);
      await expect(reference).toBeFocused();
      expect(await position()).toEqual(before);
    } finally {
      await context.close();
    }
  });
}

for (const content of ["paragraphs", "identifier"] as const) {
  test(`long footnote ${content} reflows and scrolls at narrow widths`, async () => {
    const { context, readerPage: page } = await launchReader(
      path.resolve(__dirname, "../fixtures/footnote.epub"),
      { viewport: { width: 320, height: 360 } },
    );
    try {
      await exposeReaderController(page);
      await page.evaluate((content) => {
        const doc = document.querySelector("iframe")!.contentDocument!;
        doc.getElementById("fn1")!.textContent =
          content === "paragraphs"
            ? `${"This explanation is deliberately long and must remain reachable.\n".repeat(120)}Final footnote line.`
            : `${"LongIdentifier".repeat(400)} Final footnote line.`;
      }, content);
      const reference = page.frameLocator("iframe").first().locator("#fnref1");
      await reference.focus();
      await reference.press("Enter");
      const popup = page.getByRole("dialog", { name: "Footnote", exact: true });
      await expect(popup).toBeFocused();
      await expect
        .poll(() =>
          popup.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.left >= 0 &&
              bounds.right <= innerWidth &&
              bounds.top >= 0 &&
              bounds.bottom <= innerHeight
            );
          }),
        )
        .toBe(true);
      const close = popup.getByRole("button", { name: "Close", exact: true });
      await expect(close).toBeInViewport({ ratio: 1 });
      expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await popup.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      );
      const before = await page.evaluate(
        () => Reflect.get(window, "__readerController").snapshot().pageIndex,
      );
      await page.keyboard.press("PageDown");
      await expect.poll(() => popup.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press("End");
      await expect
        .poll(() =>
          popup.evaluate(
            (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => Reflect.get(window, "__readerController").snapshot().pageIndex),
      ).toBe(before);
      await page.keyboard.press("Escape");
      await expect(reference).toBeFocused();
    } finally {
      await context.close();
    }
  });
}
