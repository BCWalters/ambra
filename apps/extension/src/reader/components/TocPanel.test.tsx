import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavPoint } from "@ambra/engine";
import { TocPanel } from "./TocPanel.js";

describe("Contents presentation", () => {
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
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.find(button => button.textContent?.startsWith("First"))?.textContent).toBe("First3");
    expect(buttons.find(button => button.textContent?.startsWith("Missing"))?.textContent).toBe("Missing");
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
});
