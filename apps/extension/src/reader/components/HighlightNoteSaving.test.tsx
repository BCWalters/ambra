import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight } from "../../library/LibraryDatabase.js";
import { AnnotationsPanel } from "./AnnotationsPanel.js";
import { HighlightActionPopup } from "./HighlightActionPopup.js";

const original: Highlight = {
  id: "first",
  bookId: "book",
  spineIndex: 0,
  startCfi: "start",
  endCfi: "end",
  style: "yellow",
  text: "Highlighted words",
  note: "Original note",
  createdAt: 1,
};

function deferredSave() {
  let resolve!: (saved: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe.each(["popup", "panel"] as const)("%s note persistence", (surface) => {
  let root: Root;
  let container: HTMLDivElement;
  const onSetNote = vi.fn<(id: string, note: string | undefined) => Promise<boolean>>();
  const onDismiss = vi.fn();
  const noop = () => {};

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onSetNote.mockReset();
    onDismiss.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(highlight = original) {
    act(() =>
      root.render(
        surface === "popup" ? (
          <HighlightActionPopup
            state={{ highlight, left: 400, top: 400 }}
            onSetNote={onSetNote}
            onSetStyle={noop}
            onRemove={noop}
            onDismiss={onDismiss}
          />
        ) : (
          <AnnotationsPanel
            bookmarks={[]}
            onSelectBookmark={noop}
            onRemoveBookmark={noop}
            highlights={[highlight]}
            onSelectHighlight={noop}
            onRemoveHighlight={noop}
            onSetHighlightNote={onSetNote}
            readOnlyAnnotations={[]}
            onSelectReadOnlyAnnotation={noop}
            onExport={noop}
            onImportFile={noop}
            open
            pinned
            onTogglePin={noop}
            onRequestClose={noop}
            scrubberVisible={false}
          />
        ),
      ),
    );
    if (surface === "panel") {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (button) => button.textContent?.includes("Highlights"),
      )!;
      act(() => tab.click());
      const edit = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        /^(Edit|Add) note:/.test(button.getAttribute("aria-label") ?? ""),
      )!;
      act(() => edit.click());
    }
  }

  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    )!;
  }

  function edit(value: string) {
    const textarea = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return textarea;
  }

  function expectClosed() {
    if (surface === "popup") expect(onDismiss).toHaveBeenCalledOnce();
    else expect(container.querySelector("textarea")).toBeNull();
  }

  it("keeps the draft pending, prevents duplicate submissions, and closes only after commit", async () => {
    const save = deferredSave();
    onSetNote.mockReturnValue(save.promise);
    render();
    const textarea = edit("  New draft  ");
    act(() => button("Save").click());
    expect(onSetNote).toHaveBeenCalledWith(original.id, "New draft");
    expect(textarea.value).toBe("  New draft  ");
    expect(textarea.readOnly).toBe(true);
    expect(button("Save").disabled).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => button("Save").click());
    expect(onSetNote).toHaveBeenCalledOnce();
    await act(async () => save.resolve(true));
    expectClosed();
  });

  it("retains and focuses the draft on failure and permits a successful retry", async () => {
    const save = deferredSave();
    onSetNote.mockReturnValueOnce(save.promise).mockResolvedValueOnce(true);
    render();
    const textarea = edit("Unsaved draft");
    act(() => button("Save").click());
    await act(async () => save.resolve(false));
    expect(textarea.value).toBe("Unsaved draft");
    expect(textarea.readOnly).toBe(false);
    expect(document.activeElement).toBe(textarea);
    expect(button("Save").disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => button("Save").click());
    expect(onSetNote).toHaveBeenNthCalledWith(2, original.id, "Unsaved draft");
    expectClosed();
  });

  it.each([
    [new Error("Unexpected save failure"), "Unexpected save failure"],
    [new DOMException("Quota exceeded", "QuotaExceededError"), "out of storage space"],
  ])("surfaces unexpected rejection %s while retaining the draft", async (error, message) => {
    const retry = deferredSave();
    onSetNote.mockRejectedValueOnce(error).mockReturnValueOnce(retry.promise);
    render();
    const textarea = edit("Keep this");
    await act(async () => button("Save").click());
    expect(textarea.value).toBe("Keep this");
    expect(document.activeElement).toBe(textarea);
    expect(button("Save").disabled).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Error details:");
    expect(alert.textContent).toContain(message);
    expect(textarea.getAttribute("aria-describedby")).toBe(alert.id);
    act(() => button("Save").click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(textarea.hasAttribute("aria-describedby")).toBe(false);
    await act(async () => retry.resolve(true));
    expectClosed();
  });

  it.each([true, false, "reject"] as const)(
    "does not let an old save (%s) close or refocus a different highlight",
    async (saved) => {
      const save = deferredSave();
      onSetNote.mockReturnValueOnce(save.promise);
      render();
      edit("Old draft");
      act(() => button("Save").click());
      render({ ...original, id: "second", text: "Other words", note: "Other note" });
      const textarea = edit("Second draft");
      act(() => button("Cancel").focus());
      const focused = document.activeElement;
      await act(async () => {
        if (saved === "reject") save.reject(new Error("Stale save failure"));
        else save.resolve(saved);
      });
      expect(container.querySelector("textarea")).toBe(textarea);
      expect(textarea.value).toBe("Second draft");
      expect(document.activeElement).toBe(focused);
      expect(onDismiss).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("invalidates a pending save when cancelled and reopened on the same highlight", async () => {
    const save = deferredSave();
    onSetNote.mockReturnValueOnce(save.promise);
    render();
    edit("Old draft");
    act(() => button("Save").click());
    act(() => button("Cancel").click());
    if (surface === "popup") {
      expect(onDismiss).toHaveBeenCalledOnce();
      act(() => root.render(null));
      onDismiss.mockClear();
    } else {
      expect(container.querySelector("textarea")).toBeNull();
    }
    render();
    const textarea = edit("Reopened draft");
    await act(async () => save.resolve(true));
    expect(container.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Reopened draft");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("allows clearing an existing note but refuses an empty new note", async () => {
    onSetNote.mockResolvedValue(true);
    render();
    edit("   ");
    expect(button("Save").disabled).toBe(false);
    await act(async () => button("Save").click());
    expect(onSetNote).toHaveBeenCalledWith(original.id, undefined);
    expectClosed();
    act(() => root.render(null));
    render({ ...original, note: undefined });
    edit("   ");
    expect(button("Save").disabled).toBe(true);
    act(() => button("Save").click());
    expect(onSetNote).toHaveBeenCalledOnce();
  });
});
