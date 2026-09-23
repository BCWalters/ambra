import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderSnapshot } from "../ReaderTypes.js";
import { useAutoHideChrome } from "../useAutoHideChrome.js";
import { ProgressScrubber } from "./ProgressScrubber.js";

const snapshot = {
  isFixedLayout: false,
  viewMode: "paginated",
  pageIndex: 4,
  pageCount: 10,
  bookPageIndex: 5,
  bookPageCount: 100,
  spineIndex: 0,
  spineLength: 10,
} as ReaderSnapshot;

function Harness() {
  const chrome = useAutoHideChrome(false);
  return (
    <>
      <ProgressScrubber
        snapshot={snapshot}
        visible={chrome.visible}
        handlers={chrome.handlers}
        onPreview={() => ({ position: { kind: "page", current: 5, total: 100 }, chapterLabel: "Chapter" })}
        onSeek={async () => {}}
        onSeekError={() => {}}
      />
      <button>Outside chrome</button>
    </>
  );
}

describe("ProgressScrubber focus visibility", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reveals on focus, stays visible during keyboard inactivity, and hides after blur", () => {
    act(() => root.render(<Harness />));
    const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
    const bar = slider.parentElement!;
    act(() => vi.advanceTimersByTime(3000));
    expect(bar.style.opacity).toBe("0");

    act(() => slider.focus());
    expect(bar.style.opacity).toBe("1");
    act(() => vi.advanceTimersByTime(5000));
    expect(document.activeElement).toBe(slider);
    expect(bar.style.opacity).toBe("1");

    act(() => container.querySelector("button")!.focus());
    act(() => vi.advanceTimersByTime(2500));
    expect(bar.style.opacity).toBe("0");
  });
});
