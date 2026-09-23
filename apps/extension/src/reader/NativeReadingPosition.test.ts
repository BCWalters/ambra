// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markReaderOwnedContent, Page } from "@ambra/engine";
import type { ContentDocumentView, DomBreakPoint } from "@ambra/engine";
import { NativeReadingPosition } from "./NativeReadingPosition.js";
import { ReaderController } from "./ReaderController.js";

afterEach(() => document.body.replaceChildren());

function setup() {
  const frames = [0, 1].map(() => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame.contentDocument!.defaultView!, "frameElement", { value: frame });
    frame.contentDocument!.body.innerHTML = "<p tabindex='-1'>First paragraph</p><p tabindex='-1'>Later paragraph</p>";
    return frame;
  });
  const views: ContentDocumentView[] = frames.map((frame, index) => ({
    document: frame.contentDocument!, spineIndex: index + 2, physicalSide: index ? "right" : "left",
  }));
  let visual: DomBreakPoint = { node: views[0]!.document.querySelector("p")!.firstChild!, offset: 0 };
  const tracker = new NativeReadingPosition(() => views, () => visual);
  views.forEach(view => tracker.attach(view.document));
  const read = (index = 1, offset = 4) => {
    const doc = views[index]!.document;
    frames[index]!.focus();
    const node = doc.querySelectorAll("p")[1]!.firstChild!;
    doc.getSelection()!.collapse(node, offset);
    return { spineIndex: index + 2, node, offset };
  };
  const initialVisual = visual;
  return { tracker, frames, views, read, visual: () => visual, returnToStart: () => {
    visual = initialVisual;
  }, navigate: () => {
    visual = { node: views[0]!.document.querySelectorAll("p")[1]!.firstChild!, offset: 0 };
  } };
}

describe("native reading resume", () => {
  it("persists the companion document's actual caret rather than the primary visual page", async () => {
    const { tracker, views, read, visual } = setup();
    const point = read();
    const controller = Object.create(ReaderController.prototype);
    const generate = vi.fn((spineIndex, _node, offset) => ({ cfi: `${spineIndex}:${offset}` }));
    const saveProgress = vi.fn(async () => {});
    Object.assign(controller, {
      nativeReading: tracker, host: { currentPosition: visual }, spineIndex: 2,
      contentDocumentViews: () => views, locatorResolver: { generate },
      library: { saveProgress }, bookId: "book", currentBookFraction: () => 0.2,
    });
    await controller.flushProgress();
    expect(generate).toHaveBeenCalledWith(3, point.node, 4);
    expect(saveProgress).toHaveBeenCalledWith("book", "3:4", undefined);
  });

  it("tracks an off-page collapsed caret and retains it across blur/selection removal", () => {
    const { tracker, read, views } = setup();
    const point = read(0, 7);
    expect(tracker.current()).toEqual(point);
    views[0]!.document.getSelection()!.removeAllRanges();
    document.body.tabIndex = -1;
    document.body.focus();
    expect(tracker.current()).toEqual(point);
  });

  it("falls back to the visual page without new native evidence", () => {
    expect(setup().tracker.current()).toBeUndefined();
  });

  it("rejects an unmoved caret after visual navigation, then accepts fresh movement", () => {
    const { tracker, read, navigate } = setup();
    read();
    expect(tracker.current()).toBeDefined();
    navigate();
    expect(tracker.current()).toBeUndefined();
    expect(tracker.current()).toBeUndefined();
    const point = read(1, 8);
    expect(tracker.current()).toEqual(point);
  });

  it("does not change a noncollapsed annotation selection or use it as resume evidence", () => {
    const { tracker, read, views } = setup();
    const point = read();
    const selection = views[1]!.document.getSelection()!;
    selection.setBaseAndExtent(point.node, 8, point.node, 2);
    const text = selection.toString();
    expect(tracker.current()).toEqual(point);
    expect(selection.toString()).toBe(text);
    expect(selection.anchorOffset).toBe(8);
  });

  it.each(["hidden", "detached", "stale", "owned", "shadow", "input", "invisible"])("rejects %s evidence", kind => {
    const { tracker, read, frames, views } = setup();
    const point = read();
    const doc = views[1]!.document;
    tracker.reset();
    if (kind === "hidden") frames[1]!.setAttribute("aria-hidden", "true");
    if (kind === "invisible") frames[1]!.style.opacity = "0";
    if (kind === "detached") frames[1]!.remove();
    if (kind === "stale") views.splice(1);
    if (kind === "owned") markReaderOwnedContent(point.node.parentElement!);
    if (kind === "shadow") {
      const host = doc.createElement("div");
      doc.body.append(host);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(doc.createTextNode("reader controls"));
      doc.getSelection()!.collapse(shadow.firstChild!, 2);
    }
    if (kind === "input") point.node.parentElement!.setAttribute("contenteditable", "true");
    if (kind !== "shadow") doc.getSelection()!.collapse(point.node, 8);
    expect(tracker.current()).toBeUndefined();
  });

  it("accepts meaningful content focus but not reader-owned shadow controls", () => {
    const { tracker, frames, views } = setup();
    frames[1]!.focus();
    const doc = views[1]!.document;
    const paragraph = doc.querySelectorAll("p")[1]!;
    paragraph.focus();
    expect(tracker.current()).toEqual({ spineIndex: 3, node: paragraph, offset: 0 });
    const host = doc.createElement("div");
    host.tabIndex = -1;
    markReaderOwnedContent(host);
    doc.body.append(host);
    host.focus();
    expect(tracker.current()).toEqual({ spineIndex: 3, node: paragraph, offset: 0 });
  });

  it("rejects a body boundary pointing into injected reader content", () => {
    const { tracker, frames, views } = setup();
    const doc = views[1]!.document;
    const owned = doc.createElement("div");
    markReaderOwnedContent(owned);
    doc.body.append(owned);
    frames[1]!.focus();
    doc.getSelection()!.collapse(doc.body, doc.body.childNodes.length - 1);
    expect(tracker.current()).toBeUndefined();
  });

  it("uses a companion's measured page for the fraction rather than the primary page", async () => {
    const { tracker, views, read, visual } = setup();
    const point = read();
    views[1] = { ...views[1]!, page: new Page(6,
      { node: point.node, offset: 0 }, { node: point.node, offset: 15 }, 0, 100) };
    const controller = Object.create(ReaderController.prototype);
    const positionFor = vi.fn(() => ({ currentPage: 27, totalPages: 100 }));
    const saveProgress = vi.fn(async () => {});
    Object.assign(controller, {
      nativeReading: tracker, host: { currentPosition: visual }, spineIndex: 2,
      contentDocumentViews: () => views, locatorResolver: { generate: () => ({ cfi: "caret" }) },
      library: { saveProgress }, bookId: "book", bookPagination: { positionFor },
    });
    await controller.flushProgress();
    expect(positionFor).toHaveBeenCalledWith(3, 6);
    expect(saveProgress).toHaveBeenCalledWith("book", "caret", 0.27);
  });

  it("keeps an exact point through a layout-only visual rebase", () => {
    const { tracker, read, navigate } = setup();
    const point = read();
    expect(tracker.current()).toEqual(point);
    navigate();
    tracker.retain(point);
    expect(tracker.current()).toEqual(point);
  });

  it("invalidates a stale caret after root scrolling away and back before the next flush", () => {
    const { tracker, read, views, navigate, returnToStart } = setup();
    const point = read(0);
    expect(tracker.current()).toEqual(point);
    const doc = views[0]!.document;
    const root = doc.scrollingElement ?? doc.documentElement;
    navigate();
    root.scrollTop = 500;
    doc.dispatchEvent(new Event("scroll"));
    returnToStart();
    root.scrollTop = 0;
    doc.dispatchEvent(new Event("scroll"));
    expect(tracker.current()).toBeUndefined();
    expect(tracker.current()).toBeUndefined();
  });

  it("does not treat a nested code block's scrolling as root navigation", () => {
    const { tracker, read, views } = setup();
    const point = read();
    expect(tracker.current()).toEqual(point);
    const pre = views[1]!.document.createElement("pre");
    views[1]!.document.body.append(pre);
    pre.scrollLeft = 80;
    pre.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(tracker.current()).toEqual(point);
  });

  it("consumes delayed programmatic scroll events after retaining a restored/reflowed point", () => {
    const { tracker, read, views, navigate } = setup();
    const point = read(0);
    expect(tracker.current()).toEqual(point);
    const doc = views[0]!.document;
    const root = doc.scrollingElement ?? doc.documentElement;
    navigate();
    root.scrollTop = 500;
    tracker.retain(point);
    doc.dispatchEvent(new Event("scroll"));
    expect(tracker.current()).toEqual(point);
    root.scrollTop = 600;
    doc.dispatchEvent(new Event("scroll"));
    expect(tracker.current()).toBeUndefined();
  });

  it.each(["detached", "stale", "hidden"])("discards previously captured %s documents", kind => {
    const { tracker, read, frames, views } = setup();
    expect(tracker.current()).toBeUndefined();
    const point = read();
    expect(tracker.current()).toEqual(point);
    if (kind === "detached") frames[1]!.remove();
    if (kind === "stale") views.splice(1);
    if (kind === "hidden") frames[1]!.setAttribute("aria-hidden", "true");
    expect(tracker.current()).toBeUndefined();
  });
});
