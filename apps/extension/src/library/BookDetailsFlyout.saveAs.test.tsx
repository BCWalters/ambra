import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookDetailsFlyout } from "./BookDetailsFlyout.js";
import type { LibraryBookViewModel } from "./LibrarySession.js";

vi.mock("./LibraryFlyout.js", () => ({
  LibraryFlyout: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section role="dialog">{children}</section> : null,
}));
describe("Book details Save as action", () => {
  let root: Root;
  let container: HTMLDivElement;
  let save: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  const book = {
    id: "book", title: "A book", fileName: "original.epub", addedAt: 0, identifiers: [],
  } as unknown as LibraryBookViewModel;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const animate = Element.prototype.animate;
    vi.spyOn(Element.prototype, "animate").mockImplementation(function (this: Element, keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      queueMicrotask(() => animation.finish());
      return animation;
    });
    save = vi.fn().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(selected: LibraryBookViewModel | undefined = book, expandDetails = true) {
    await act(async () => root.render(
      <BookDetailsFlyout book={selected} onRequestClose={vi.fn()} accent="#000" accentForeground="#7a3e00"
        backgroundSolid="#fff" onOpenInspector={undefined} onSaveAs={save} />,
    ));
    const disclosure = [...container.querySelectorAll("button")].find((button) => button.textContent === "Publication details")!;
    if (expandDetails && disclosure?.getAttribute("aria-expanded") === "false") {
      await act(async () => disclosure.click());
    }
  }
  function saveButton() {
    return [...container.querySelectorAll("button")].find((button) => button.textContent === "Save as…")!;
  }

  it("offers a compact themed named button beside the filename inside Publication details", async () => {
    await render();
    const button = saveButton();
    expect(button).toBeDefined();
    const filename = [...container.querySelectorAll("p")].find((element) => element.textContent === "original.epub")!;
    expect(filename.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.style.fontSize).toBe("var(--fontSizeBase200)");
    expect(button.style.borderColor).toBe("#000");
    expect(button.style.color).toBe("#7a3e00");
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(save).toHaveBeenCalledExactlyOnceWith("book");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("prevents duplicate saves while the picker or download is pending", async () => {
    let finish!: () => void;
    save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    saveButton().focus();
    await act(async () => { saveButton().click(); saveButton().click(); });
    expect(save).toHaveBeenCalledOnce();
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(saveButton());
    await act(async () => finish());
    expect(saveButton().disabled).toBe(false);
  });

  it("renders failures using the standard dismissible alert and allows retry", async () => {
    save.mockRejectedValueOnce(new Error("FILE_ACCESS_DENIED"));
    await render();
    await act(async () => saveButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save a copy of this EPUB. FILE_ACCESS_DENIED",
    );
    const dismiss = [...container.querySelectorAll("button")].find((button) => button.textContent === "Dismiss")!;
    await act(async () => dismiss.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => saveButton().click());
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not show an old book's failure after another book is selected", async () => {
    let reject!: (error: Error) => void;
    save.mockImplementationOnce(() => new Promise<void>((_resolve, no) => { reject = no; }));
    await render();
    await act(async () => saveButton().click());
    await render({ ...book, id: "next-book" });
    await act(async () => reject(new Error("Late failure")));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(save).toHaveBeenLastCalledWith("next-book");
  });
});
