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
    await page.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
    const panel = page.getByRole("navigation", { name: "Bookmarks and highlights", exact: true });
    await panel.getByRole("tab", { name: /Highlights/ }).click();
    const addNote = panel.getByRole("button", { name: /^Add note:/ });
    await expect(addNote).toHaveText("Add note");
    await addNote.click();
    const textarea = panel.getByRole("textbox", { name: "Add a note…" });
    await expect(textarea).toBeFocused();
    await textarea.fill("Still thinking");
    await addNote.click();
    await expect(textarea).toHaveValue("Still thinking");
    await expect(textarea).toBeFocused();
    await textarea.press("Escape");
    await expect(textarea).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(addNote).toBeFocused();
    await addNote.click();
    await textarea.fill("My note is separate from the highlighted quotation.");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    const editNote = panel.getByRole("button", { name: /^Edit note:/ });
    await expect(editNote).toHaveText("Edit note");
    await expect(editNote).toBeFocused();
    await expect(panel.getByText("My note is separate from the highlighted quotation.", { exact: true })).toBeVisible();
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
        await page.getByRole("button", { name: "Bookmarks and highlights", exact: true }).click();
        await page.getByRole("tab", { name: /Highlights/ }).click();
        await page.getByRole("button", { name: /^Add note:/ }).click();
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
          : page.getByRole("navigation", { name: "Bookmarks and highlights", exact: true });
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
          const highlight = controller.snapshot().highlights[0];
          const persisted = (await controller.library.listHighlightsForBook(highlight.bookId)).find(
            (entry: { id: string }) => entry.id === highlight.id,
          );
          return { cached: highlight.note ?? null, persisted: persisted.note ?? null };
        });
      await expect.poll(readNotes).toEqual({ cached: draft.trim(), persisted: draft.trim() });

      if (surface === "popup") {
        await page.getByRole("button", { name: "This highlight has a note", exact: true }).click();
      } else {
        await page.getByRole("button", { name: /^Edit note:/ }).click();
      }
      await expect(textarea).toHaveValue(draft.trim());
      await textarea.fill("   ");
      await expect(save).toBeEnabled();
      await save.click();
      await releaseSave(page, true);
      await expect(textarea).toBeHidden();
      await expect.poll(readNotes).toEqual({ cached: null, persisted: null });
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
