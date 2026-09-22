import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { launchReader } from "../harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LONG_CONTENT_EPUB = path.resolve(here, "..", "fixtures", "long-content.epub");

/** Same selection-plus-toolbar pattern as `note-marker-bounds.spec.ts`'s
 * own `createNoteOnLeadingText` helper, but stops after picking a
 * highlight color (no note) — this suite only needs a plain highlight
 * to exist to export. */
async function createLeadingHighlight(readerPage: Page, spanChars: number): Promise<string> {
  const highlightedText = await readerPage.evaluate((span) => {
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
    return range.toString();
  }, spanChars);

  await readerPage.getByRole("button", { name: "Yellow", exact: true }).click();
  await readerPage.waitForTimeout(300);
  return highlightedText;
}

/**
 * End-to-end coverage for the EPUB Annotations 1.0 export/import round
 * trip (issues #107/#108): a highlight and a bookmark created in one
 * "session", exported to a file, then imported back — confirming the
 * whole pipeline (CFI range join/split, spine-index resolution, live
 * text re-extraction, and duplicate detection) works against the real
 * built extension, not just the unit-tested pieces in isolation.
 */
test("exporting and re-importing annotations round-trips a highlight and a bookmark, re-extracting text and deduping repeat imports", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await readerPage.waitForTimeout(500);
    // The toolbar auto-hides after inactivity — a plain mouse move
    // first "wakes" it before the very first toolbar click below.
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);
    const highlightedText = await createLeadingHighlight(readerPage, 40);
    await readerPage.getByRole("button", { name: "Bookmark this page" }).click();
    await readerPage.waitForTimeout(300);

    await readerPage.getByRole("button", { name: "Bookmarks and highlights" }).click();
    await readerPage.waitForTimeout(300);

    const downloadPromise = readerPage.waitForEvent("download");
    await readerPage.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    const savePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ambra-annotations-")), "export.json");
    await download.saveAs(savePath);
    const exportedText = await fs.readFile(savePath, "utf-8");
    const exported = JSON.parse(exportedText) as unknown[];

    expect(Array.isArray(exported)).toBe(true);
    expect(exported.length).toBe(2);
    const motivations = exported.map((entry) => (entry as { motivation?: string }).motivation).sort();
    expect(motivations).toEqual(["bookmarking", "highlighting"]);
    for (const entry of exported) {
      const annotation = entry as { target?: { source?: string; selector?: unknown[] } };
      expect(annotation.target?.source).toBe("OEBPS/ch1.xhtml");
      expect(annotation.target?.selector?.[0]).toMatchObject({ type: "FragmentSelector" });
    }

    // Delete the originals so the upcoming import is the *only* source of
    // truth for what gets recreated — isolates the text re-extraction
    // check below from the highlight/bookmark that already had its text
    // snapshotted at creation time.
    await readerPage.getByRole("tab", { name: /Highlights/ }).click();
    await readerPage.getByRole("button", { name: /^Remove highlight:/ }).click();
    await expect(readerPage.getByText(/No highlights yet/)).toBeVisible();
    await readerPage.getByRole("tab", { name: /Bookmarks/ }).click();
    await readerPage.getByRole("button", { name: /^Remove bookmark:/ }).click();
    await expect(readerPage.getByText(/No bookmarks yet/)).toBeVisible();

    const fileInput = readerPage.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(savePath);
    await readerPage.waitForTimeout(700);

    await readerPage.getByRole("tab", { name: /Highlights/ }).click();
    await expect(readerPage.getByText(/Highlights \(1\)/)).toBeVisible();
    // The imported highlight's preview text isn't carried in the export
    // file itself (EPUB Annotations 1.0 only serializes the CFI range,
    // not a content snapshot) — it must be re-extracted from the live
    // document on import. This is the real regression check: before the
    // fix, this re-extraction silently produced an empty string.
    await expect(readerPage.getByText(highlightedText, { exact: false })).toBeVisible();
    await readerPage.getByRole("tab", { name: /Bookmarks/ }).click();
    await expect(readerPage.getByText(/Bookmarks \(1\)/)).toBeVisible();

    // Import the very same file again, on top of what it just created —
    // every entry is now an exact-CFI duplicate, so the counts must stay
    // put rather than double, and a quiet, non-error toast should say so
    // (issue #115) rather than silently doing nothing.
    await fileInput.setInputFiles(savePath);
    await readerPage.waitForTimeout(700);

    await expect(
      readerPage.getByRole("status").filter({ hasText: "already have all of these annotations" }),
    ).toBeVisible();
    await expect(readerPage.getByText(/Bookmarks \(1\)/)).toBeVisible();
    await readerPage.getByRole("tab", { name: /Highlights/ }).click();
    await expect(readerPage.getByText(/Highlights \(1\)/)).toBeVisible();
  } finally {
    await context.close();
  }
});

/**
 * Issue #114: a file that isn't even a valid EPUB Annotations 1.0
 * collection (garbage JSON, not a real annotations export at all) gets
 * a weightier, illustrated, non-auto-dismissing toast rather than a
 * quiet one that might time out unnoticed — the reader deliberately
 * picked a file and deserves an explanation that stays up until
 * they've seen it.
 */
test("importing a file that isn't a valid annotations export surfaces a weightier, non-auto-dismissing error", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await readerPage.waitForTimeout(500);
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);
    await readerPage.getByRole("button", { name: "Bookmarks and highlights" }).click();
    await readerPage.waitForTimeout(300);

    const fileInput = readerPage.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles({
      name: "not-annotations.json",
      mimeType: "application/json",
      buffer: Buffer.from("this is not valid JSON at all {{{"),
    });
    await readerPage.waitForTimeout(500);

    const errorToast = readerPage.getByRole("alert").filter({ hasText: "valid annotations export" });
    await expect(errorToast).toBeVisible();
    // Still visible well past a "transient" toast's own auto-dismiss
    // window (see `TRANSIENT_AUTO_DISMISS_MS`) — this one requires an
    // explicit dismissal.
    await readerPage.waitForTimeout(8500);
    await expect(errorToast).toBeVisible();

    await readerPage.getByRole("button", { name: "Dismiss" }).click();
    await expect(errorToast).not.toBeVisible();
  } finally {
    await context.close();
  }
});

/**
 * Issue #119: a well-formed EPUB Annotations 1.0 file whose CFI(s)
 * don't actually resolve against this book's content (most likely:
 * exported from a different book, or a different edition) used to
 * throw a `LocatorResolutionError` straight out of `importAnnotations`,
 * which aborted the *entire* import and surfaced the raw technical
 * message ("No element found at CFI step...") as the toast's primary
 * text. Two fixes are exercised here: a batch with only unresolvable
 * annotations is treated the same as "nothing usable in this file" —
 * the existing friendly `importWrongBook` message, never the raw
 * exception text; and a batch with a mix of resolvable/unresolvable
 * annotations silently imports what it can rather than losing
 * everything to one bad entry.
 */
test("importing annotations that don't resolve against this book's content shows a friendly message, and a partially-bad file still imports what it can", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await readerPage.waitForTimeout(500);
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);
    const highlightedText = await createLeadingHighlight(readerPage, 40);

    await readerPage.getByRole("button", { name: "Bookmarks and highlights" }).click();
    await readerPage.waitForTimeout(300);

    const downloadPromise = readerPage.waitForEvent("download");
    await readerPage.getByRole("button", { name: "Export" }).click();
    const download = await downloadPromise;
    const savePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ambra-annotations-")), "export.json");
    await download.saveAs(savePath);
    const exportedText = await fs.readFile(savePath, "utf-8");
    const exported = JSON.parse(exportedText) as Array<{
      target: { source: string; selector: Array<{ type: string; value: string }> };
    }>;
    const goodHighlight = exported.find((entry) => entry.target.selector[0].value.includes(","))!;

    // A structurally-valid CFI (same source, resolvable spine item)
    // whose content-steps point at a node that doesn't exist — the
    // shape a genuinely different book's export would have.
    const brokenSelector = goodHighlight.target.selector[0].value.replace(/!\/(\d+)/, "!/9999");
    expect(brokenSelector).not.toBe(goodHighlight.target.selector[0].value);

    // Clear the existing highlight so re-importing the good CFI is
    // unambiguous.
    await readerPage.getByRole("tab", { name: /Highlights/ }).click();
    await readerPage.getByRole("button", { name: /^Remove highlight:/ }).click();
    await expect(readerPage.getByText(/No highlights yet/)).toBeVisible();

    const fileInput = readerPage.locator('input[type="file"][accept*="json"]');

    // First: a file with only unresolvable annotations.
    await fileInput.setInputFiles({
      name: "wrong-book.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify([
          {
            ...goodHighlight,
            id: "urn:uuid:broken-only",
            target: { ...goodHighlight.target, selector: [{ type: "FragmentSelector", value: brokenSelector }] },
          },
        ]),
      ),
    });
    await readerPage.waitForTimeout(700);

    const wrongBookToast = readerPage.getByRole("alert").filter({ hasText: "different book" });
    await expect(wrongBookToast).toBeVisible();
    await expect(readerPage.getByText(/No element found/)).toHaveCount(0);
    await expect(readerPage.getByText(/Highlights \(0\)/).or(readerPage.getByText(/No highlights yet/))).toBeVisible();
    await readerPage.getByRole("button", { name: "Dismiss" }).click();

    // Second: a mix of one good, one broken — the good one should
    // still import silently, with no error toast at all.
    await fileInput.setInputFiles({
      name: "mixed.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify([
          goodHighlight,
          {
            ...goodHighlight,
            id: "urn:uuid:broken-mixed",
            target: { ...goodHighlight.target, selector: [{ type: "FragmentSelector", value: brokenSelector }] },
          },
        ]),
      ),
    });
    await readerPage.waitForTimeout(700);

    await expect(readerPage.getByText(highlightedText, { exact: false })).toBeVisible();
    await expect(readerPage.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
