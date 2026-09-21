import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/**
 * A real, confirmed layout bug found while manually validating the
 * "Accessible EPUB 3" O'Reilly sample (real-books/accessible-epub-3.epub)
 * ahead of a production push: its own stylesheet declares
 * `pre { white-space: pre-wrap; }` for its many nested XML/markup code
 * samples — entirely reasonable authoring, but combined with a deeply
 * indented example wider than a narrow spread column, wrapping a too-long
 * line threw away that line's own indentation for just the wrapped
 * remainder (landing flush at the block's left edge), which read as
 * scrambled rather than merely re-flowed. Fixed in `EpubCssReset`
 * (`pre { white-space: pre !important; overflow-x: auto !important; }` —
 * `!important` specifically because the book's own conflicting rule would
 * otherwise win under the reset's usual cascade) plus
 * `PreOverflowFocusability.makeOverflowingPreElementsFocusable`, which
 * gives any `pre` that ends up actually overflowing a `tabindex="0"` so a
 * sighted keyboard user can still reach/scroll it.
 */
test("a pre block wider than the column preserves its own indentation instead of scrambling on wrap", async () => {
  const { context, readerPage } = await launchReader(
    path.resolve(__dirname, "../real-books/accessible-epub-3.epub"),
    { viewport: { width: 1200, height: 900 } },
  );

  await readerPage.getByRole("button", { name: "Search" }).click();
  await readerPage.getByPlaceholder("Search this book…").fill('epub:type="landmarks"');
  await readerPage.waitForTimeout(600);
  await readerPage.locator("button", { hasText: "landmarks" }).first().click();
  await readerPage.waitForTimeout(600);

  const info = await readerPage.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const iframe of iframes) {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      const pre = Array.from(doc.querySelectorAll("pre")).find((el) =>
        el.textContent?.includes('epub:type="landmarks"'),
      );
      if (!pre) continue;
      const style = getComputedStyle(pre);
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        tabIndex: pre.tabIndex,
        overflowing: pre.scrollWidth > pre.clientWidth,
      };
    }
    return undefined;
  });

  expect(info).toBeTruthy();
  expect(info?.whiteSpace).toBe("pre");
  expect(info?.overflowX).toBe("auto");
  expect(info?.overflowing).toBe(true);
  expect(info?.tabIndex).toBe(0);

  await context.close();
});
