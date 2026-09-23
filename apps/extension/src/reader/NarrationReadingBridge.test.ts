import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentDocumentView, ContentLoader, LocatorResolver } from "@ambra/engine";
import { NarrationReadingBridge } from "./NarrationReadingBridge.js";
import { applyNarrationRange } from "./HighlightRenderer.js";

vi.mock("./HighlightRenderer.js", () => ({ applyNarrationRange: vi.fn() }));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function setup(styles: { activeClass?: string; playbackActiveClass?: string } = {}) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p id="one">First passage.</p><p id="two">Second passage.</p>';
  const state = {
    views: [{ document: doc, spineIndex: 0, physicalSide: "single" }] as ContentDocumentView[],
    disposed: false,
  };
  const navigate = vi.fn<() => Promise<void>>().mockResolvedValue();
  const reader = new NarrationReadingBridge(
    { loadSpineDocument: vi.fn<ContentLoader["loadSpineDocument"]>() },
    { generate: vi.fn<LocatorResolver["generate"]>(), resolveInDocument: vi.fn<LocatorResolver["resolveInDocument"]>() },
    styles,
    { documents: () => state.views, position: () => undefined, navigate, disposed: () => state.disposed },
  );
  const createRange = doc.createRange.bind(doc);
  let top = 20;
  vi.spyOn(doc, "createRange").mockImplementation(() => {
    const range = createRange();
    vi.spyOn(range, "getClientRects").mockImplementation(() => {
      const rect = new DOMRect(10, top, 100, 20);
      return Object.assign([rect], { item: (index: number) => index === 0 ? rect : null });
    });
    return range;
  });
  return { reader, doc, state, navigate, offscreen: () => { top = -100; } };
}

const first = { spineIndex: 0, path: "chapter.xhtml", fragment: "one" };

describe("NarrationReadingBridge", () => {
  it("highlights visible narration without navigating or stealing focus", async () => {
    const { reader, navigate, doc } = setup();
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    await reader.update(first, true);
    expect(navigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    const range = vi.mocked(applyNarrationRange).mock.calls.at(-1)?.[1];
    expect(range?.toString()).toBe("First passage.");
    expect(range?.startContainer.ownerDocument).toBe(doc);
  });

  it("only follows offscreen targets when following is enabled", async () => {
    const { reader, offscreen, navigate } = setup();
    offscreen();
    await reader.update(first, false);
    expect(navigate).not.toHaveBeenCalled();
    await reader.update(first, true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("preserves author classes and removes only classes it added", async () => {
    const { reader, doc } = setup({ activeClass: "spoken", playbackActiveClass: "playing" });
    doc.getElementById("one")!.classList.add("spoken");
    reader.setPlaying(true);
    await reader.update(first, true);
    expect(doc.documentElement.classList.contains("playing")).toBe(true);
    reader.setPlaying(false);
    expect(doc.documentElement.classList.contains("playing")).toBe(false);
    await reader.update({ ...first, fragment: "two" }, false);
    expect(doc.getElementById("two")!.classList.contains("spoken")).toBe(true);
    reader.clear();
    expect(doc.getElementById("one")!.classList.contains("spoken")).toBe(true);
    expect(doc.getElementById("two")!.classList.contains("spoken")).toBe(false);
    expect(applyNarrationRange).not.toHaveBeenCalled();
  });

  it("cleans paint when browsing to another document", async () => {
    const { reader, state, doc } = setup({ activeClass: "spoken" });
    await reader.update(first, false);
    state.views = [];
    reader.repaint();
    expect(doc.getElementById("one")!.classList.contains("spoken")).toBe(false);
  });

  it("does not resurrect a target after a pending navigation is invalidated", async () => {
    const { reader, navigate, offscreen, doc } = setup({ activeClass: "spoken" });
    offscreen();
    let release!: () => void;
    navigate.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const pending = reader.update(first, true);
    reader.clear();
    release();
    await pending;
    expect(doc.querySelector(".spoken")).toBeNull();
  });

  it("surfaces navigation failures", async () => {
    const { reader, navigate, offscreen } = setup();
    offscreen();
    navigate.mockRejectedValue(new Error("Missing audio target."));
    await expect(reader.update(first, true)).rejects.toThrow("Missing audio target.");
  });
});
