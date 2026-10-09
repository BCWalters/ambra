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
  // Happy DOM does not wire a child window's frameElement.
  Object.defineProperty(doc.defaultView!, "frameElement", { configurable: true, value: iframe });
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
  return {
    reader, doc, state, navigate, offscreen: () => { top = -100; },
    place: (y: number) => { top = y; },
    clip: (start: number, end: number) => {
      iframe.style.clipPath = `inset(${start}px 0 ${doc.defaultView!.innerHeight - end}px 0)`;
    },
  };
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

  it.each([100, 200])("follows a passage at %s below the current paint clip but inside the layout viewport", async top => {
    const { reader, navigate, clip, place } = setup();
    clip(10, 100);
    place(top);
    await reader.update(first, true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("does not snap independent browsing back to a clipped narrated passage", async () => {
    const { reader, navigate, clip, place } = setup();
    clip(10, 100);
    place(200);
    await reader.update(first, false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps a partially visible leading line in place but follows a line hidden in the top inset", async () => {
    const { reader, navigate, clip, place } = setup();
    clip(10, 100);
    place(90);
    await reader.update(first, true);
    expect(navigate).not.toHaveBeenCalled();
    place(5);
    await reader.update(first, true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("cleans paint when browsing to another document", async () => {
    const { reader, state, doc } = setup({ activeClass: "spoken" });
    await reader.update(first, false);
    state.views = [];
    reader.repaint();
    expect(doc.getElementById("one")!.classList.contains("spoken")).toBe(false);
  });

  it.each([undefined, "spoken"])("paints SVG text with active class %s and cleans it on passage changes and closure", async activeClass => {
    const { reader, doc } = setup({ activeClass, playbackActiveClass: "playing" });
    doc.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g id="one"><text>First</text></g><text id="two">Second</text></svg>';
    const firstText = doc.querySelector<SVGElement>("text")!;
    reader.setPlaying(true);
    await reader.update(first, false);
    expect(firstText.style.getPropertyValue("text-shadow")).toContain("#b9e5ff");
    reader.setPlaying(false);
    expect(firstText.style.getPropertyValue("text-shadow").match(/#b9e5ff/g)).toHaveLength(2);
    await reader.update({ ...first, fragment: "two" }, false);
    expect(firstText.hasAttribute("style")).toBe(false);
    expect(doc.querySelector<SVGElement>("#two")!.style.getPropertyValue("text-shadow")).toContain("#b9e5ff");
    reader.clear();
    expect(doc.querySelector("#two")!.hasAttribute("style")).toBe(false);
    expect(doc.querySelector(".spoken")).toBeNull();
    expect(doc.documentElement.classList.contains("playing")).toBe(false);
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
