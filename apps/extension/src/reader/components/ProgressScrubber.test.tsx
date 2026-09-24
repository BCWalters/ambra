import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderSnapshot } from "../ReaderTypes.js";
import { useAutoHideChrome } from "../useAutoHideChrome.js";
import { ProgressScrubber, type ProgressScrubberProps } from "./ProgressScrubber.js";

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
        onPreview={() => ({
          position: { kind: "page", current: 5, total: 100 },
          chapterLabel: "Chapter",
        })}
        onSeek={async () => {}}
        onSeekError={() => {}}
      />
      <button>Outside chrome</button>
    </>
  );
}

describe("ProgressScrubber", () => {
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function renderScrubber(overrides: Partial<ProgressScrubberProps> = {}) {
    const onSeek = vi.fn(() => new Promise<void>(() => {}));
    const onSeekError = vi.fn();
    act(() =>
      root.render(
        <ProgressScrubber
          snapshot={snapshot}
          visible
          handlers={{ onPointerEnter() {}, onPointerLeave() {}, onFocus() {}, onBlur() {} }}
          onPreview={(fraction) => ({
            position: { kind: "page", current: Math.round(fraction * 100), total: 100 },
            chapterLabel: "A long chapter title",
          })}
          onSeek={onSeek}
          onSeekError={onSeekError}
          {...overrides}
        />,
      ),
    );
    const slider = container.querySelector<HTMLElement>('[role="slider"]')!;
    let captured = false;
    slider.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    slider.hasPointerCapture = vi.fn(() => captured);
    slider.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    slider.getBoundingClientRect = () => ({ left: 20, width: 100 }) as DOMRect;
    return { slider, onSeek, onSeekError };
  }

  function pointer(slider: HTMLElement, type: string, init: PointerEventInit = {}) {
    act(() => {
      slider.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          clientX: 100,
          ...init,
        }),
      );
    });
  }

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

  it("shows only the destination while dragging, keeps the actual position, and focuses the larger target", () => {
    const { slider, onSeek } = renderScrubber({ visible: false });
    pointer(slider, "pointerdown");
    expect(document.activeElement).toBe(slider);
    expect(slider.style.height).toBe("44px");
    expect(slider.getAttribute("aria-valuetext")).toBe(
      "Page 80 of 100 - A long chapter title",
    );
    expect(container.textContent).toContain("Page 5 of 100");
    expect(container.textContent).not.toContain("Preview");
    expect(container.textContent).not.toContain("Release to go here");
    const popup = container.querySelector('[title="A long chapter title"]')!.parentElement!;
    expect(popup.textContent).toBe("Page 80 of 100A long chapter title");
    expect(slider.parentElement!.style.opacity).toBe("1");
    expect(onSeek).not.toHaveBeenCalled();
  });

  it.each(["Escape", "lostpointercapture", "visibilitychange", "pointercancel"])(
    "%s cancels only the active preview without navigating on release",
    (cancel) => {
      const { slider, onSeek } = renderScrubber();
      pointer(slider, "pointerdown");
      if (cancel === "Escape") {
        act(() =>
          slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
        );
      } else if (cancel === "visibilitychange") {
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        act(() => document.dispatchEvent(new Event("visibilitychange")));
      } else {
        pointer(slider, cancel);
      }
      pointer(slider, "pointerup", { buttons: 0 });
      expect(onSeek).not.toHaveBeenCalled();
      expect(slider.getAttribute("aria-valuenow")).toBe("5");
      expect(container.querySelector('[title="A long chapter title"]')).toBeNull();
    },
  );

  it("commits touch release once, distinguishes pending navigation, and restores actual position", async () => {
    let resolve!: () => void;
    const seek = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { slider } = renderScrubber({ onSeek: seek });
    pointer(slider, "pointerdown", { pointerType: "touch" });
    pointer(slider, "pointerup", { pointerType: "touch", buttons: 0 });
    expect(seek).toHaveBeenCalledExactlyOnceWith(0.8);
    expect(slider.getAttribute("aria-valuetext")).toContain("Going to position…:");
    expect(container.textContent).not.toContain("Going to position…");
    expect(container.querySelector('[title="A long chapter title"]')!.parentElement!.textContent)
      .toBe("Page 80 of 100A long chapter title");
    expect(container.textContent).not.toContain("Release to go here");
    pointer(slider, "pointerup", { buttons: 0 });
    expect(seek).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(slider.getAttribute("aria-valuenow")).toBe("5");
    expect(container.textContent).not.toContain("Going to position…");
  });

  it("ignores secondary clicks and unrelated pointer cancellation", () => {
    const { slider, onSeek } = renderScrubber();
    pointer(slider, "pointerdown", { button: 2 });
    expect(slider.getAttribute("aria-valuenow")).toBe("5");
    pointer(slider, "pointerdown");
    pointer(slider, "pointercancel", { pointerId: 2 });
    expect(slider.getAttribute("aria-valuenow")).toBe("80");
    pointer(slider, "pointerup", { buttons: 0 });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(0.8);
  });

  it("commits a fast drag release before React has rendered the drag preview (#146)", () => {
    const { slider, onSeek } = renderScrubber();
    act(() => {
      slider.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: 30,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 90,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 1, pointerType: "mouse", buttons: 0, clientX: 110,
      }));
    });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(0.9);
    expect(slider.getAttribute("aria-valuenow")).toBe("90");
    pointer(slider, "lostpointercapture");
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it.each(["ltr", "rtl"] as const)("commits %s native capture loss after release before pointerup (#146)", direction => {
    const { slider, onSeek } = renderScrubber({
      snapshot: { ...snapshot, pageProgressionDirection: direction },
    });
    pointer(slider, "pointerdown", { clientX: 30 });
    pointer(slider, "pointermove", { clientX: 90 });
    pointer(slider, "lostpointercapture", { buttons: 0, clientX: 110 });
    const fraction = direction === "rtl" ? 1 - 0.9 : 0.9;
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(fraction);
    expect(slider.getAttribute("aria-valuenow")).toBe(direction === "rtl" ? "10" : "90");
    pointer(slider, "pointermove", { buttons: 0, clientX: 120 });
    pointer(slider, "pointerup", { buttons: 0, clientX: 120 });
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it.each(["Escape", "pointercancel"])("does not turn %s into a seek when capture loss follows", cancel => {
    const { slider, onSeek } = renderScrubber();
    pointer(slider, "pointerdown");
    if (cancel === "Escape") {
      act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    } else {
      pointer(slider, cancel, { buttons: 0 });
    }
    pointer(slider, "lostpointercapture", { buttons: 0 });
    pointer(slider, "pointerup", { buttons: 0 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("cancels capture loss in a hidden document instead of committing", () => {
    const { slider, onSeek } = renderScrubber();
    pointer(slider, "pointerdown");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    pointer(slider, "lostpointercapture", { buttons: 0 });
    pointer(slider, "pointerup", { buttons: 0 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("Escape restores an earlier pending destination rather than cancelling its seek", () => {
    const { slider, onSeek } = renderScrubber();
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    expect(slider.getAttribute("aria-valuetext")).toContain("Going to position…:");
    expect(container.textContent).not.toContain("Going to position…");
    pointer(slider, "pointerdown");
    expect(slider.getAttribute("aria-valuenow")).toBe("80");
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    pointer(slider, "pointerup", { buttons: 0 });
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    expect(container.textContent).not.toContain("Going to position…");
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("re-clamps an open popup when the viewport changes without another pointer event", () => {
    const { slider } = renderScrubber();
    pointer(slider, "pointerdown");
    const popup = container.querySelector<HTMLElement>(
      '[title="A long chapter title"]',
    )!.parentElement!;
    popup.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    slider.getBoundingClientRect = () => ({ left: 20, width: window.innerWidth - 40 }) as DOMRect;
    vi.stubGlobal("innerWidth", 320);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(popup.style.left).toBe("162px");
    vi.stubGlobal("innerWidth", 760);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(popup.style.left).toBe("596px");
  });
});
