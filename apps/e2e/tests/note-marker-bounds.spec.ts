import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { launchReader } from "../harness.js";

/** Selects from the very start of the chapter's body through `spanChars`
 * characters of text, then dispatches the same `pointerup` the app's
 * own selection listener expects, and creates a note on it via the
 * selection toolbar's "Add note" shortcut. */
async function createNoteOnLeadingText(readerPage: Page, spanChars: number): Promise<void> {
  await readerPage.evaluate((span) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const doc = iframe.contentDocument!;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode() as Text;
    let endNode = firstText;
    let remaining = span;
    let node: Node | null = firstText;
    while (node && remaining > 0) {
      endNode = node as Text;
      remaining -= (node.textContent ?? "").length;
      node = walker.nextNode();
    }
    const range = doc.createRange();
    range.setStart(firstText, 0);
    range.setEnd(endNode, Math.max(0, (endNode.textContent ?? "").length - Math.max(0, -remaining)));
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, spanChars);

  await readerPage.getByRole("button", { name: "Add note" }).click();
  await readerPage.getByPlaceholder("Add a note…").fill("Test note spanning a page boundary");
  await readerPage.getByRole("button", { name: "Save" }).click();
  await readerPage.waitForTimeout(500);
}

/** Finds the note-marker badge (the one 18x18 round button on the page —
 * distinct from every other, differently-sized toolbar/panel button) if
 * one is currently rendered. */
async function findNoteMarkerBox(
  readerPage: Page,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const allButtons = await readerPage.locator("button").all();
  for (const button of allButtons) {
    const box = await button.boundingBox();
    if (box && Math.abs(box.width - 18) < 2 && Math.abs(box.height - 18) < 2) {
      return box;
    }
  }
  return null;
}

/** Regression tests for issue #99: a highlight's note-marker badge must
 * never be positioned outside the current page's visible band (e.g. in
 * the footer inset or off the iframe entirely) when the highlighted
 * range extends past the bottom of the page it starts on — and, per a
 * follow-up report, the marker must actually disappear once the reader
 * navigates to a page where that highlight isn't visible at all, rather
 * than lingering at a stale/mispositioned spot. */
test.describe("note marker bounds (issue #99)", () => {
  test("stays within the current page's visible bounds when its highlight spans a page boundary", async () => {
    test.setTimeout(60_000);
    const { context, readerPage } = await launchReader(path.resolve(__dirname, "../fixtures/long-content.epub"), {
      viewport: { width: 900, height: 900 },
    });
    await readerPage.waitForTimeout(1000);

    await createNoteOnLeadingText(readerPage, 2600);

    const markerBounds = await readerPage.evaluate(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const iframeRect = iframe.getBoundingClientRect();
      const clipPath = iframe.style.clipPath;
      const numbers = Array.from(clipPath.matchAll(/(-?[\d.]+)px/g)).map((m) => Number(m[1]));
      const top = numbers.length ? numbers[0] : 0;
      const bottom = numbers.length
        ? iframeRect.height - (numbers.length >= 3 ? numbers[2] : numbers[0])
        : iframeRect.height;
      return { visibleTop: iframeRect.top + top, visibleBottom: iframeRect.top + bottom };
    });

    const markerBox = await findNoteMarkerBox(readerPage);
    expect(markerBox, "expected to find the 18x18 note-marker badge").not.toBeNull();
    const markerCenterY = markerBox!.y + markerBox!.height / 2;
    expect(markerCenterY).toBeGreaterThanOrEqual(markerBounds.visibleTop - 1);
    expect(markerCenterY).toBeLessThanOrEqual(markerBounds.visibleBottom + 1);

    await context.close();
  });

  test("disappears once the reader turns to a page where the highlight isn't visible", async () => {
    test.setTimeout(60_000);
    const { context, readerPage } = await launchReader(path.resolve(__dirname, "../fixtures/long-content.epub"), {
      viewport: { width: 900, height: 900 },
    });
    await readerPage.waitForTimeout(1000);

    // A short highlight, confined to the first page, so a couple of
    // page turns forward unambiguously leaves it behind — unlike the
    // page-spanning highlight above, whose own later pages are
    // *supposed* to keep showing its marker.
    await createNoteOnLeadingText(readerPage, 700);
    expect(await findNoteMarkerBox(readerPage), "marker should be visible on the page it was created on").not.toBeNull();

    // Turn forward past the highlight's own last visible page — the
    // marker (anchored on the page it was created on) must not still be
    // rendered anywhere once that page is no longer on screen.
    for (let i = 0; i < 2; i++) {
      await readerPage.keyboard.press("ArrowRight");
      await readerPage.waitForTimeout(400);
    }

    expect(await findNoteMarkerBox(readerPage), "stale marker should have disappeared after navigating away").toBeNull();

    await context.close();
  });
});

test.describe("note marker after scrubber seek (issue #99 follow-up)", () => {
  test("disappears after seeking to a different page via the progress scrubber", async () => {
    test.setTimeout(60_000);
    const { context, readerPage } = await launchReader(path.resolve(__dirname, "../fixtures/long-content.epub"), {
      viewport: { width: 900, height: 900 },
    });
    await readerPage.waitForTimeout(1000);

    await createNoteOnLeadingText(readerPage, 700);
    expect(await findNoteMarkerBox(readerPage), "marker should be visible on the page it was created on").not.toBeNull();

    // Seek via the progress scrubber (not a page-turn) straight to the
    // very end of the book/chapter — a real user drag-and-drop or a
    // keyboard "End" press on the slider, both funnel through the same
    // `seekToFraction` -> `openSpineItem` path this test exercises.
    const slider = readerPage.getByRole("slider", { name: "Position in book" });
    await slider.focus();
    await slider.press("End");
    await readerPage.waitForTimeout(800);

    expect(
      await findNoteMarkerBox(readerPage),
      "stale marker should have disappeared after seeking away via the scrubber",
    ).toBeNull();

    await context.close();
  });
});

test.describe("note marker after a text-display-setting change (issue #99 follow-up)", () => {
  test("repositions (rather than staying pinned to its pre-change spot) after a font-size change", async () => {
    test.setTimeout(60_000);
    const { context, readerPage } = await launchReader(path.resolve(__dirname, "../fixtures/long-content.epub"), {
      viewport: { width: 900, height: 900 },
    });
    await readerPage.waitForTimeout(1000);

    await createNoteOnLeadingText(readerPage, 700);
    const boxBefore = await findNoteMarkerBox(readerPage);
    expect(boxBefore, "marker should be visible before the font-size change").not.toBeNull();

    // A window resize already correctly repositions note markers
    // (`resize` calls `updateNoteMarkers`) — a font-size change reflows
    // the very same way (it also calls `relayout`/`resize` on the
    // host), and must do the same.
    await readerPage.getByRole("button", { name: "Text and page options" }).click();
    await readerPage.getByRole("menuitem", { name: "Text" }).click();
    const fontSizeSlider = readerPage.getByRole("slider", { name: "Font size" });
    await fontSizeSlider.focus();
    for (let i = 0; i < 6; i++) {
      await fontSizeSlider.press("ArrowRight");
    }
    await readerPage.keyboard.press("Escape");
    await readerPage.keyboard.press("Escape");
    await readerPage.waitForTimeout(800);

    const boxAfter = await findNoteMarkerBox(readerPage);
    expect(boxAfter, "marker should still be present (still on the same page) after the font-size change").not.toBeNull();
    expect(
      boxAfter!.y,
      "marker's vertical position should have moved once the larger font reflowed the page (it was stale/pinned before this fix)",
    ).not.toBeCloseTo(boxBefore!.y, 0);

    await context.close();
  });
});

