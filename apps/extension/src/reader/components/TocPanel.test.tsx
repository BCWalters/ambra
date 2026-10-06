import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavPoint } from "@ambra/engine";
import { TocPanel } from "./TocPanel.js";

describe("Contents presentation", () => {
  it("exposes labeled legacy lists as separate native disclosures, retaining primary contents", () => {
    const markup = renderToStaticMarkup(
      <TocPanel
        items={[new NavPoint("Chapter", "chapter.xhtml", undefined, [])]}
        additionalLists={[
          {
            label: "Illustrations",
            items: [new NavPoint("Figure one", "chapter.xhtml", "figure", [])],
          },
        ]}
        currentPath={undefined}
        firstSpinePath="chapter.xhtml"
        pageNumbers={new Map()}
        onSelect={vi.fn()}
        open
        pinned={false}
        onTogglePin={vi.fn()}
        onRequestClose={vi.fn()}
        scrubberVisible={false}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    expect(container.querySelector("summary")?.textContent).toBe("Illustrations");
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("details button")?.textContent).toContain("Figure one");
    expect(container.querySelector("nav")?.textContent).toContain("Chapter");
  });
  it("restores a retained dock without stealing focus from the other panel or reading surface", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (open: boolean, focusOnOpen: boolean) => act(() => root.render(
      <>
        <button id="other-panel-focus">Other panel</button>
        <TocPanel items={[]} currentPath={undefined} firstSpinePath={undefined} pageNumbers={new Map()}
          onSelect={vi.fn()} open={open} focusOnOpen={focusOnOpen} pinned={open}
          onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />
      </>,
    ));
    try {
      render(true, true);
      expect(document.activeElement).toBe(container.querySelector("nav"));
      const other = container.querySelector<HTMLButtonElement>("#other-panel-focus")!;
      act(() => other.focus());
      render(false, false);
      render(true, false);
      expect(document.activeElement).toBe(other);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps docking changes focus-neutral and makes an unavailable pin focusable but inactive", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onTogglePin = vi.fn();
    const render = (pinned: boolean, canPin: boolean) => act(() => root.render(
      <TocPanel items={[new NavPoint("Chapter", "chapter.xhtml", undefined, [])]} currentPath="chapter.xhtml"
        firstSpinePath="chapter.xhtml" pageNumbers={new Map()} onSelect={vi.fn()}
        open pinned={pinned} canPin={canPin} onTogglePin={onTogglePin} onRequestClose={vi.fn()} scrubberVisible={false} />,
    ));
    try {
      render(true, true);
      const chapter = container.querySelector<HTMLButtonElement>('[aria-current="location"]')!;
      act(() => chapter.focus());
      render(false, false);
      expect(document.activeElement).toBe(chapter);
      const pin = container.querySelector<HTMLButtonElement>('button[aria-label="Pin contents panel"]')!;
      expect(pin.disabled).toBe(false);
      expect(pin.tabIndex).toBe(0);
      expect(pin.getAttribute("aria-disabled")).toBe("true");
      expect(pin.getAttribute("aria-description")).toContain("at least 320 px for the book");
      act(() => { pin.focus(); pin.click(); });
      expect(document.activeElement).toBe(pin);
      expect(onTogglePin).not.toHaveBeenCalled();
      render(true, true);
      expect(document.activeElement).toBe(pin);
      act(() => pin.click());
      expect(onTogglePin).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("distinguishes current section and page numbers for same-spine fragments", () => {
    const markup = renderToStaticMarkup(
      <TocPanel
        items={[
          new NavPoint("First", "chapter.xhtml", "first", []),
          new NavPoint("Second", "chapter.xhtml", "second", []),
          new NavPoint("Missing", "chapter.xhtml", "missing", []),
        ]}
        currentPath="chapter.xhtml#second"
        firstSpinePath="cover.xhtml"
        pageNumbers={new Map([["chapter.xhtml", 2], ["chapter.xhtml#first", 3], ["chapter.xhtml#second", 8]])}
        onSelect={vi.fn()} open pinned onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    expect(container.querySelectorAll('[aria-current="location"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="location"]')?.textContent).toBe("Second8");
    expect(container.querySelector('[aria-current="location"]')?.getAttribute("aria-label")).toBe("Second, Page 8");
    expect(container.querySelector('[aria-current="location"] [aria-hidden="true"]')?.textContent).toBe("8");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.find(button => button.textContent?.startsWith("First"))?.textContent).toBe("First3");
    expect(buttons.find(button => button.textContent?.startsWith("Missing"))?.textContent).toBe("Missing");
    expect(buttons.find(button => button.textContent === "Missing")?.hasAttribute("aria-label")).toBe(false);
  });

  it("keeps the current chapter emphasized and allows long labels to wrap", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const label = "A long chapter title that should remain readable beyond a single line";
    const heading = "Unlinked".repeat(100);
    try {
      const content = (
        <TocPanel
          items={[new NavPoint(heading, undefined, undefined, [
            new NavPoint(label, "chapter.xhtml", undefined, []),
          ])]}
          currentPath="chapter.xhtml"
          firstSpinePath="cover.xhtml"
          pageNumbers={new Map([["chapter.xhtml", 2]])}
          onSelect={vi.fn()}
          open
          pinned
          onTogglePin={vi.fn()}
          onRequestClose={vi.fn()}
          scrubberVisible={false}
        />
      );
      expect(renderToStaticMarkup(content).match(/-webkit-line-clamp:2/g)).toHaveLength(2);
      act(() => root.render(content));
      const chapter = container.querySelector<HTMLButtonElement>('[aria-current="location"]')!;
      expect(chapter.style.fontWeight).toBe("600");
      expect(chapter.textContent).toContain(label);
      expect(chapter.querySelector("span")?.style.overflowWrap).toBe("anywhere");
      expect(chapter.querySelector("span")?.style.whiteSpace).not.toBe("nowrap");
      const groupLabel = [...container.querySelectorAll("span")].find((entry) =>
        entry.textContent === heading && entry.style.overflow === "hidden")!;
      expect(groupLabel.style.overflow).toBe("hidden");
      expect(groupLabel.style.overflowWrap).toBe("anywhere");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps authored numbering and labels intact and navigates the original target", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const chapter = new NavPoint("Part IV — 第十二章: 007", "chapter.xhtml", "authored-target", []);
    const select = vi.fn();
    try {
      act(() => root.render(<TocPanel items={[chapter]} currentPath={undefined}
        firstSpinePath="cover.xhtml" pageNumbers={new Map([["cover.xhtml", 1], [chapter.target!, 127]])}
        onSelect={select} open pinned onTogglePin={vi.fn()} onRequestClose={vi.fn()} scrubberVisible={false} />));
      const target = container.querySelector<HTMLButtonElement>('button[aria-label="Part IV — 第十二章: 007, Page 127"]')!;
      expect(target.querySelector("span")?.textContent).toBe(chapter.label);
      expect(container.querySelector('button[aria-label="Start of book, Page 1"]')).not.toBeNull();
      act(() => target.click());
      expect(select).toHaveBeenCalledExactlyOnceWith(chapter);
      expect(chapter.label).toBe("Part IV — 第十二章: 007");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
