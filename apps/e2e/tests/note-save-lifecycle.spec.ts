import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

const book = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/long-content.epub",
);

async function selectText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && (text.textContent?.trim().length ?? 0) < 30) text = walker.nextNode();
    if (!text) throw new Error("No highlightable text");
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 30);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
}

async function releaseSave(page: Page, commit: boolean): Promise<void> {
  await page.waitForFunction(() => !!Reflect.get(window, "__noteSave"));
  await page.evaluate((commit) => {
    const save = Reflect.get(window, "__noteSave");
    Reflect.deleteProperty(window, "__noteSave");
    if (commit) save.commit();
    else save.fail();
  }, commit);
}

test("contextual note actions restore the reading origin and surviving note marker", async () => {
  const { context, readerPage: page } = await launchReader(book);
  try {
    await exposeReaderController(page);
    const popup = page.getByRole("dialog", { name: "Highlight options", exact: true });
    const readingFocused = () => page.evaluate(() => {
      const frame = document.querySelector("iframe")!;
      return document.activeElement === frame && frame.contentDocument?.activeElement !== frame.contentDocument?.body;
    });
    for (const exit of ["escape", "cancel", "save"] as const) {
      await selectText(page);
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await expect(popup.getByRole("textbox")).toBeFocused();
      if (exit === "escape") await page.keyboard.press("Escape");
      else if (exit === "cancel") await popup.getByRole("button", { name: "Cancel", exact: true }).click();
      else {
        await popup.getByRole("textbox").fill("A persistent note");
        await popup.getByRole("button", { name: "Save", exact: true }).click();
      }
      await expect(popup).toHaveCount(0);
      await expect.poll(readingFocused).toBe(true);
    }
    const marker = page.getByRole("button", { name: "This highlight has a note", exact: true }).first();
    await marker.focus();
    await marker.press("Enter");
    await expect(popup.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(marker).toBeFocused();
    await marker.press("Enter");
    await popup.getByRole("button", { name: "Delete highlight", exact: true }).click();
    await expect(popup).toHaveCount(0);
    await expect(marker).toHaveCount(0);
    await expect.poll(readingFocused).toBe(true);
  } finally { await context.close(); }
});

test("annotation actions are explicit and inline note editing keeps focus and drafts predictable", async ({ browserName: _browserName }, testInfo) => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 360, height: 800 },
  });
  try {
    await selectText(page);
    const selection = page.getByRole("toolbar", { name: "Highlight this selection" });
    await expect(selection.getByRole("button", { name: "Add note", exact: true })).toHaveText("Add note");
    await expect(selection.getByRole("button", { name: "Yellow", exact: true })).toHaveCSS("width", "28px");
    await expect.poll(() => selection.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    })).toBe(true);
    await selection.getByRole("button", { name: "Yellow", exact: true }).click();
    await page.getByRole("button", { name: "Annotations", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
    const show = panel.getByRole("combobox", { name: "Show", exact: true });
    await show.selectOption("highlights");
    const addNote = panel.getByRole("button", { name: /^Add note:/ });
    await expect(addNote).toHaveText("Add note");
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await expect(panel.getByText("Your note", { exact: true })).toHaveCount(0);
    await addNote.click();
    const textarea = panel.getByRole("textbox", { name: "Add a note…" });
    const save = panel.getByRole("button", { name: "Save", exact: true });
    await expect(textarea).toBeFocused();
    await expect(save).toBeDisabled();
    await textarea.fill("   ");
    await expect(save).toBeDisabled();
    await textarea.fill("Still thinking");
    await addNote.click();
    await expect(textarea).toHaveValue("Still thinking");
    await expect(textarea).toBeFocused();
    const editorBounds = await textarea.evaluate(element => {
      const editor = element.closest(".fui-Textarea")!.getBoundingClientRect();
      const card = element.closest("li")!;
      return {
        width: editor.width,
        cardWidth: card.getBoundingClientRect().width,
        aboveQuotation: editor.bottom <= card.querySelector("blockquote")!.getBoundingClientRect().top,
      };
    });
    expect(editorBounds.width).toBeGreaterThanOrEqual(editorBounds.cardWidth - 24);
    expect(editorBounds.aboveQuotation).toBe(true);
    await show.selectOption("bookmarks");
    await expect(textarea).toBeHidden();
    await show.selectOption("highlights");
    await expect(textarea).toHaveValue("Still thinking");
    await expect(textarea).toBeFocused();
    await page.getByRole("button", { name: "Show contents", exact: true }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Annotations", exact: true }).click();
    await expect(show).toHaveValue("highlights");
    await expect(textarea).toHaveValue("Still thinking");
    await textarea.focus();
    await textarea.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue("Still thinking");
    await textarea.press("Escape");
    await expect(textarea).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(addNote).toBeFocused();
    await addNote.click();
    await textarea.fill("Discard this draft");
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(textarea).toBeHidden();
    await expect(addNote).toBeFocused();
    await addNote.click();
    await expect(textarea).toHaveValue("");
    const note = "My note is separate from the highlighted quotation.\n<script>Literal note text.</script>";
    await textarea.fill(note);
    await save.click();
    const editNote = panel.getByRole("button", { name: /^Edit note:/ });
    await expect(editNote).toHaveText("Edit note");
    await expect(editNote).toBeFocused();
    const ownWords = panel.getByText(note, { exact: true });
    await expect(ownWords).toBeVisible();
    expect(await ownWords.textContent()).toBe(note);
    await expect(ownWords).toHaveCSS("white-space", "pre-wrap");
    await expect(panel.locator("script")).toHaveCount(0);
    await expect(panel.getByText("Your note", { exact: true })).toBeVisible();
    await expect(show.locator("option")).toHaveText([
      "All annotations (1)", "Highlights (1)", "Notes (1)", "Bookmarks (0)",
    ]);
    await expect.poll(() => panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("annotations-polish.png") });
  } finally {
    await context.close();
  }
});

for (const surface of ["popup", "panel"] as const) {
  test(`${surface} retains note drafts after quota failure, retries, and clears committed notes`, async () => {
    const { context, readerPage: page } = await launchReader(book);
    try {
      await exposeReaderController(page);
      await selectText(page);
      if (surface === "popup") {
        await page.getByRole("button", { name: "Add note", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Yellow", exact: true }).click();
        await page.getByRole("button", { name: "Annotations", exact: true }).click();
        const panel = page.getByRole("navigation", { name: "Annotations", exact: true });
        await panel.getByRole("combobox", { name: "Show", exact: true }).selectOption("highlights");
        await panel.getByRole("button", { name: /^Add note:/ }).click();
      }

      await page.evaluate(() => {
        const controller = Reflect.get(window, "__readerController");
        const library = controller.library;
        const patch = library.patchHighlight.bind(library);
        library.patchHighlight = (id: string, changes: { note?: string; style?: string }) => {
          if (!("note" in changes)) return patch(id, changes);
          return new Promise((resolve, reject) => {
            Reflect.set(window, "__noteSave", {
              commit: () => patch(id, changes).then(resolve, reject),
              fail: () =>
                reject(
                  new DOMException("Storage quota exceeded during note save", "QuotaExceededError"),
                ),
            });
          });
        };
      });

      const editor =
        surface === "popup"
          ? page.getByRole("dialog", { name: "Highlight options", exact: true })
          : page.getByRole("navigation", { name: "Annotations", exact: true });
      const textarea = editor.getByRole("textbox", { name: "Add a note…" });
      const save = editor.getByRole("button", { name: "Save", exact: true });
      const draft = "  Draft must survive quota  ";
      await textarea.fill(draft);
      await save.click();
      await expect(save).toBeDisabled();
      await expect(textarea).toHaveAttribute("readonly", "");
      await expect(textarea).toHaveValue(draft);
      await releaseSave(page, false);
      await expect(
        page.getByRole("status").filter({ hasText: "out of storage space" }),
      ).toBeVisible();
      await expect(textarea).toHaveValue(draft);
      await expect(textarea).toBeFocused();
      await expect(save).toBeEnabled();

      await save.click();
      await expect(save).toBeDisabled();
      await releaseSave(page, true);
      await expect(textarea).toBeHidden();
      const readNotes = () =>
        page.evaluate(async () => {
          const controller = Reflect.get(window, "__readerController");
          const highlights = controller.snapshot().highlights;
          const highlight = highlights[0];
          const stored = await controller.library.listHighlightsForBook(highlight.bookId);
          const persisted = stored.find(
            (entry: { id: string }) => entry.id === highlight.id,
          );
          return { cached: highlight.note ?? null, persisted: persisted.note ?? null,
            cachedCount: highlights.length, storedCount: stored.length };
        });
      await expect.poll(readNotes).toEqual({
        cached: draft.trim(), persisted: draft.trim(), cachedCount: 1, storedCount: 1,
      });

      if (surface === "popup") {
        await page.getByRole("button", { name: "This highlight has a note", exact: true }).click();
      } else {
        await editor.getByRole("combobox", { name: "Show", exact: true }).selectOption("notes");
        await editor.getByRole("button", { name: /^Edit note:/ }).click();
      }
      await expect(textarea).toHaveValue(draft.trim());
      await textarea.fill("   ");
      await expect(save).toBeEnabled();
      await save.click();
      await releaseSave(page, true);
      await expect(textarea).toBeHidden();
      await expect.poll(readNotes).toEqual({ cached: null, persisted: null, cachedCount: 1, storedCount: 1 });
      if (surface === "panel") {
        const show = editor.getByRole("combobox", { name: "Show", exact: true });
        await expect(show).toBeFocused();
        await expect(show).toHaveValue("notes");
        await expect(show.locator("option")).toHaveText([
          "All annotations (1)", "Highlights (1)", "Notes (0)", "Bookmarks (0)",
        ]);
        await expect(editor.getByText("No notes yet.", { exact: true })).toBeVisible();
        await show.selectOption("highlights");
        await expect(editor.getByRole("button", { name: /^Add note:/ })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
}

test("resizing the note editor keeps its popup within the viewport and its actions reachable", async () => {
  const { context, readerPage: page } = await launchReader(book, {
    viewport: { width: 390, height: 700 },
  });
  try {
    await selectText(page);
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Highlight options", exact: true });
    const textarea = dialog.getByRole("textbox", { name: "Add a note…" });
    await textarea.fill("A resizable draft");
    await textarea.evaluate((element) => {
      element.closest<HTMLElement>(".fui-Textarea")!.style.height = "1000px";
    });
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.top >= 7 &&
            rect.left >= 7 &&
            rect.bottom <= innerHeight - 7 &&
            rect.right <= innerWidth - 7
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "This highlight has a note", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
