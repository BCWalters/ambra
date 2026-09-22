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
async function createLeadingHighlight(readerPage: Page, spanChars: number): Promise<void> {
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

  await readerPage.getByRole("button", { name: "Yellow", exact: true }).click();
  await readerPage.waitForTimeout(300);
}

/**
 * End-to-end coverage for the EPUB Annotations 1.0 export/import round
 * trip (issues #107/#108): a highlight and a bookmark created in one
 * "session", exported to a file, then imported back — confirming the
 * whole pipeline (CFI range join/split, spine-index resolution, live
 * text re-extraction) works against the real built extension, not just
 * the unit-tested pieces in isolation.
 */
test("exporting and re-importing annotations round-trips a highlight and a bookmark", async () => {
  const { context, readerPage } = await launchReader(LONG_CONTENT_EPUB, {
    viewport: { width: 900, height: 900 },
  });
  try {
    await readerPage.waitForTimeout(500);
    // The toolbar auto-hides after inactivity — a plain mouse move
    // first "wakes" it before the very first toolbar click below.
    await readerPage.mouse.move(450, 20);
    await readerPage.waitForTimeout(150);
    await createLeadingHighlight(readerPage, 40);
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

    // Import the very same file back in — every entry should round-trip
    // as a *new* highlight/bookmark (this reader doesn't dedupe on
    // import), so the panel's counts should exactly double.
    const fileInput = readerPage.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles(savePath);
    await readerPage.waitForTimeout(700);

    await readerPage.getByRole("tab", { name: /Highlights/ }).click();
    await expect(readerPage.getByText(/Highlights \(2\)/)).toBeVisible();
    await readerPage.getByRole("tab", { name: /Bookmarks/ }).click();
    await expect(readerPage.getByText(/Bookmarks \(2\)/)).toBeVisible();
  } finally {
    await context.close();
  }
});
