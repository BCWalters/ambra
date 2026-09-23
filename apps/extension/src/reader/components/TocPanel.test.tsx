import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { NavPoint } from "@ambra/engine";
import { TocPanel } from "./TocPanel.js";

describe("Contents presentation", () => {
  it("keeps the current chapter emphasized and allows long labels to wrap", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const label = "A long chapter title that should remain readable beyond a single line";
    try {
      act(() => root.render(
        <TocPanel
          items={[new NavPoint(label, "chapter.xhtml", undefined, [])]}
          currentPath="chapter.xhtml"
          firstSpinePath="cover.xhtml"
          pageNumbers={new Map([["chapter.xhtml", 2]])}
          onSelect={vi.fn()}
          open
          pinned
          onTogglePin={vi.fn()}
          onRequestClose={vi.fn()}
          scrubberVisible={false}
        />,
      ));
      const chapter = container.querySelector<HTMLButtonElement>('[aria-current="location"]')!;
      expect(chapter.style.fontWeight).toBe("600");
      expect(chapter.textContent).toContain(label);
      expect(chapter.querySelector("span")?.style.overflowWrap).toBe("anywhere");
      expect(chapter.querySelector("span")?.style.whiteSpace).not.toBe("nowrap");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
