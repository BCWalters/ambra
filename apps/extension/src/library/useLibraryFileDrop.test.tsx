import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryFileDrop, type LibraryFileDropOptions } from "./useLibraryFileDrop.js";

describe("useLibraryFileDrop", () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ReturnType<typeof useLibraryFileDrop>;
  const importFiles = vi.fn<(files: readonly File[]) => Promise<void>>();
  const books = [new File(["first"], "first.epub"), new File(["second"], "second.epub")];

  function Harness(props: LibraryFileDropOptions) {
    latest = useLibraryFileDrop(props);
    return <div ref={latest.dropTargetRef}><button>Import book</button><div data-card=""><img alt="Cover" /></div></div>;
  }
  async function render(options: Partial<LibraryFileDropOptions> = {}) {
    await act(async () => {
      root.render(<Harness enabled canImport busy={false} importFiles={importFiles} {...options} />);
    });
  }
  function drag(type: string, target: EventTarget = container.querySelector("img")!, files = books,
    options: { types?: string[]; clientX?: number; clientY?: number; relatedTarget?: EventTarget | null } = {}) {
    const transfer = { types: options.types ?? ["Files"], items: [], files, dropEffect: "none" };
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      dataTransfer: { value: transfer }, clientX: { value: options.clientX ?? 100 },
      clientY: { value: options.clientY ?? 100 }, relatedTarget: { value: options.relatedTarget ?? null },
    });
    act(() => { target.dispatchEvent(event); });
    return { event, transfer };
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    importFiles.mockReset().mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("recognizes protected file drags, highlights over nested covers, and imports one ordered batch", async () => {
    await render();
    const enter = drag("dragenter", latest.dropTargetRef.current!, []);
    expect(enter.event.defaultPrevented).toBe(true);
    expect(enter.transfer.dropEffect).toBe("copy");
    drag("dragenter");
    drag("dragleave", latest.dropTargetRef.current!, []);
    expect(latest.isDraggingFiles).toBe(true);
    expect(drag("dragover").event.defaultPrevented).toBe(true);
    expect(drag("drop").event.defaultPrevented).toBe(true);
    expect(latest.isDraggingFiles).toBe(false);
    expect(importFiles).toHaveBeenCalledExactlyOnceWith(books);
  });

  it("does not highlight, prevent, or import link and text drags", async () => {
    await render();
    for (const type of ["dragenter", "dragover", "drop"]) {
      expect(drag(type, undefined, [], { types: ["text/plain", "text/uri-list"] }).event.defaultPrevented).toBe(false);
      expect(latest.isDraggingFiles).toBe(false);
    }
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("recovers from a missing dragenter and clears the highlight on leaving", async () => {
    await render();
    drag("dragover");
    expect(latest.isDraggingFiles).toBe(true);
    drag("dragleave");
    expect(latest.isDraggingFiles).toBe(false);
  });

  it("passes unsupported files unchanged to the existing error pipeline", async () => {
    await render();
    const invalid = new File(["not an epub"], "notes.txt", { type: "text/plain" });
    drag("drop", undefined, [invalid, ...books]);
    expect(importFiles).toHaveBeenCalledExactlyOnceWith([invalid, ...books]);
  });

  it.each([{ canImport: false }, { busy: true }])("blocks browser file opening while unavailable: %j", async (options) => {
    await render(options);
    expect(drag("dragenter").event.defaultPrevented).toBe(true);
    expect(drag("dragover").transfer.dropEffect).toBe("none");
    expect(latest.isDraggingFiles).toBe(false);
    expect(drag("drop").event.defaultPrevented).toBe(true);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("leaves disabled popup, embedded, and production behavior untouched", async () => {
    await render({ enabled: false });
    for (const type of ["dragenter", "dragover", "drop"]) expect(drag(type).event.defaultPrevented).toBe(false);
    expect(latest.isDraggingFiles).toBe(false);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("resets on final leave, document exit, cancellation, blur, pagehide, and any drop", async () => {
    await render();
    for (const reset of [
      () => drag("dragleave"),
      () => { drag("dragenter"); drag("dragleave", document.documentElement); },
      () => { drag("dragenter"); drag("dragleave", undefined, [], { clientX: 0 }); },
      () => drag("dragend"),
      () => window.dispatchEvent(new Event("blur")),
      () => window.dispatchEvent(new Event("pagehide")),
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      () => drag("drop", document.body, [], { types: ["text/plain"] }),
    ]) {
      drag("dragenter");
      expect(latest.isDraggingFiles).toBe(true);
      act(reset);
      expect(latest.isDraggingFiles).toBe(false);
    }
  });

  it("handles covered children before propagation is stopped and suppresses drops outside the root", async () => {
    await render();
    container.querySelector("img")!.addEventListener("drop", (event) => event.stopPropagation());
    drag("drop");
    expect(importFiles).toHaveBeenCalledOnce();
    expect(drag("drop", document.body).event.defaultPrevented).toBe(true);
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("prevents duplicate drops before busy renders and releases after the import settles", async () => {
    let resolve!: () => void;
    importFiles.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    await render();
    drag("drop");
    drag("drop");
    expect(importFiles).toHaveBeenCalledOnce();
    await act(async () => { resolve(); });
    drag("drop");
    expect(importFiles).toHaveBeenCalledTimes(2);
  });

  it("clears stale highlights on gate changes, keeps keyboard focus, and removes listeners on unmount", async () => {
    await render();
    const button = container.querySelector("button")!;
    button.focus();
    drag("dragenter");
    expect(document.activeElement).toBe(button);
    await render({ busy: true });
    expect(latest.isDraggingFiles).toBe(false);
    await render();
    expect(latest.isDraggingFiles).toBe(false);
    drag("dragenter");
    await render({ enabled: false });
    await render();
    expect(latest.isDraggingFiles).toBe(false);
    act(() => root.render(null));
    expect(drag("drop", document.body).event.defaultPrevented).toBe(false);
    expect(importFiles).not.toHaveBeenCalled();
  });
});
