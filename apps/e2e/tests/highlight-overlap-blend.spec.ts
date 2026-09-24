import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { launchReader, clickForwardAndWait } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/** Selects `[startOffset, endOffset)` of the first text node containing
 * `marker`, then dispatches the same `pointerup` the app's own selection
 * listener expects — the same "select programmatically, not by mouse
 * drag" approach `note-marker-bounds.spec.ts` already uses, since a real
 * mouse drag can't reliably hit exact character boundaries. */
async function selectWithinParagraph(
  readerPage: Page,
  marker: string,
  startOffset: number,
  endOffset: number,
): Promise<void> {
  await readerPage.evaluate(
    ({ marker, startOffset, endOffset }) => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const doc = iframe.contentDocument!;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      let target: Text | undefined;
      let idx = -1;
      while ((node = walker.nextNode())) {
        const text = node as Text;
        idx = (text.textContent ?? "").indexOf(marker);
        if (idx !== -1) {
          target = text;
          break;
        }
      }
      const range = doc.createRange();
      range.setStart(target!, idx + startOffset);
      range.setEnd(target!, idx + endOffset);
      const selection = doc.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    },
    { marker, startOffset, endOffset },
  );
  await readerPage.waitForTimeout(200);
}

/** The names currently registered in the content iframe's own CSS
 * Custom Highlight registry, plus how many `Range`s the "active
 * selection" one (if present) covers — the ground truth for what's
 * actually painted, since a screenshot can't distinguish "no highlight
 * registered here" from "a highlight registered but visually identical
 * to the page background" as precisely as inspecting the registry
 * itself can. Active highlights are named per-style
 * (`ambra-highlight-active-<style>`, issue #113's follow-up: the
 * emphasis stays visibly related to the highlight's own color), so
 * `activeRangeCount` sums across every "active" name rather than
 * looking up one fixed one. */
async function highlightRegistryState(readerPage: Page): Promise<{ names: string[]; activeRangeCount: number }> {
  return readerPage.evaluate(() => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as unknown as { CSS: { highlights: Map<string, Set<unknown>> } };
    const names = [...win.CSS.highlights.keys()];
    const activeRangeCount = names
      .filter((name) => name.startsWith("ambra-highlight-active-"))
      .reduce((sum, name) => sum + (win.CSS.highlights.get(name)?.size ?? 0), 0);
    return { names: names.sort(), activeRangeCount };
  });
}

test.describe("overlapping highlight blending and active-selection emphasis (issue #113)", () => {
  test("two overlapping highlights of different colors register a precomputed blend for the overlap, not just one flatly winning", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      await readerPage.waitForTimeout(500);

      await selectWithinParagraph(readerPage, "Paragraph 1.", 0, 30);
      await readerPage.getByRole("button", { name: "Yellow" }).click();
      await readerPage.waitForTimeout(300);

      await selectWithinParagraph(readerPage, "Paragraph 1.", 15, 45);
      await readerPage.getByRole("button", { name: "Blue" }).click();
      await readerPage.waitForTimeout(300);

      const { names } = await highlightRegistryState(readerPage);
      expect(names, "expected the solo yellow, solo blue, and a blended combination, not just two flat colors").toEqual(
        ["ambra-highlight-blend-blue-yellow", "ambra-highlight-blue", "ambra-highlight-yellow"].sort(),
      );
    } finally {
      await context.close();
    }
  });

  test("clicking a highlight shows its own color's active-selection emphasis, which disappears when its popup closes", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      await readerPage.waitForTimeout(500);

      // Paragraph 4 (well down the page) so the popup that opens above
      // the click doesn't cover the highlighted text itself.
      await selectWithinParagraph(readerPage, "Paragraph 4.", 0, 30);
      await readerPage.getByRole("button", { name: "Yellow" }).click();
      await readerPage.waitForTimeout(300);
      await selectWithinParagraph(readerPage, "Paragraph 4.", 40, 55);
      await readerPage.getByRole("button", { name: "Blue" }).click();
      await readerPage.waitForTimeout(300);

      let state = await highlightRegistryState(readerPage);
      expect(state.activeRangeCount, "no highlight is selected yet — nothing should be 'active'").toBe(0);

      // Click squarely inside the yellow highlight's own span.
      const iframeBox = await (await readerPage.$("iframe"))!.boundingBox();
      await readerPage.mouse.click(iframeBox!.x + 190, iframeBox!.y + 500);
      await readerPage.waitForTimeout(400);

      state = await highlightRegistryState(readerPage);
      expect(
        state.names,
        "clicking the yellow highlight should mark it active with yellow's own color, not an unrelated one",
      ).toContain("ambra-highlight-active-yellow");
      expect(state.activeRangeCount, "clicking a highlight should mark exactly its own span as active").toBe(1);

      await readerPage.keyboard.press("Escape");
      await readerPage.waitForTimeout(400);

      state = await highlightRegistryState(readerPage);
      expect(
        state.names.some((name) => name.startsWith("ambra-highlight-active-")),
        "closing the popup should clear the active emphasis entirely",
      ).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("turning the page closes an open highlight popup and clears its active emphasis immediately", async () => {
    const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, { viewport: { width: 900, height: 700 } });
    try {
      await readerPage.waitForTimeout(500);
      await selectWithinParagraph(readerPage, "Paragraph 1.", 0, 30);
      await readerPage.getByRole("button", { name: "Yellow" }).click();
      await readerPage.waitForTimeout(300);

      const iframeBox = await (await readerPage.$("iframe"))!.boundingBox();
      await readerPage.mouse.click(iframeBox!.x + 190, iframeBox!.y + 175);
      await readerPage.waitForTimeout(400);
      expect((await highlightRegistryState(readerPage)).activeRangeCount).toBe(1);

      // A real click-to-turn in the content (not a keystroke, which the
      // popup's own note textarea would otherwise just swallow as typed
      // input) — the same interaction `clickForwardAndWait` elsewhere
      // in this suite already uses for page turns.
      await clickForwardAndWait(readerPage);

      expect(
        (await highlightRegistryState(readerPage)).names.some((name) => name.startsWith("ambra-highlight-active-")),
        "a page turn should immediately clear any active-highlight emphasis, not leave a stale glow behind",
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
});
