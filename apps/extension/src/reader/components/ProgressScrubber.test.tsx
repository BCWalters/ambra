import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoHideChrome } from "../useAutoHideChrome.js";
import { SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { BOOKMARK_ROW_HEIGHT } from "../BookmarkGroups.js";
import { ReadingTheme } from "@ambra/engine";
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
  pageProgressionDirection: "ltr",
  bookmarks: [],
} satisfies ProgressScrubberProps["snapshot"];

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
        onGoToBookmark={() => {}}
        onShowBookmarks={() => {}}
        bookmarkChooserDismissRequest={0}
        onBookmarkChooserOpenChange={() => {}}
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
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 72, width: 100, height: 72, toJSON() {},
    });
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

  function renderScrubber(overrides: Partial<ProgressScrubberProps> = {}, trackWidth = 100) {
    const onSeek = vi.fn(() => new Promise<void>(() => {}));
    const onSeekError = vi.fn();
    const onGoToBookmark = vi.fn();
    const onShowBookmarks = vi.fn();
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
          onGoToBookmark={onGoToBookmark}
          onShowBookmarks={onShowBookmarks}
          bookmarkChooserDismissRequest={0}
          onBookmarkChooserOpenChange={() => {}}
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
    slider.getBoundingClientRect = () => ({ left: 20, width: trackWidth }) as DOMRect;
    return { slider, onSeek, onSeekError, onGoToBookmark, onShowBookmarks };
  }

  function footerHeight(slider: HTMLElement) {
    const position = container.querySelector<HTMLElement>("[data-scrubber-current-position]")!;
    return parseFloat(slider.style.height) + BOOKMARK_ROW_HEIGHT +
      parseFloat(position.style.height) + parseFloat(slider.parentElement!.style.paddingBottom) + 1;
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

  it("shows landmarks by default and hides them without changing focus, height, or keyboard seeking", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64,
      toJSON() {},
    });
    const markerData = {
      ready: true,
      chapters: [{ target: "a", label: "A", fraction: 0.2 }, { target: "b", label: "B", fraction: 0.6 }],
      sections: [],
      landmarks: [{ kind: "start" as const, fraction: 0.1 }, { kind: "end" as const, fraction: 0.9 }],
    };
    const { slider, onSeek } = renderScrubber({ markerData }, 1000);
    expect(slider.getAttribute("data-progress-marker-style")).toBe("upcoming");
    expect(container.querySelectorAll("[data-upcoming-boundary]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-reading-landmark]")).toHaveLength(1);
    expect(container.querySelector("[data-progress-markers]")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onSeek).toHaveBeenCalledWith(expect.closeTo(0.06, 6));
    const hidden = renderScrubber({ markerStyle: "off", markerData }, 1000);
    expect(container.querySelector("[data-progress-markers]")).toBeNull();
    expect(hidden.slider.style.height).toBe("26px");
    expect(hidden.slider.hasAttribute("aria-describedby")).toBe(false);
  });

  it.each(["ltr", "rtl"] as const)("shows upcoming chapter bands only beyond the thumb (%s)", (direction) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64,
      toJSON() {},
    });
    const markerData = {
      ready: true,
      chapters: [
        { target: "a", label: "A", fraction: 0 },
        { target: "b", label: "B", fraction: 0.2 },
        { target: "c", label: "C", fraction: 0.6 },
      ],
      sections: [], landmarks: [],
    };
    const { slider, onSeek } = renderScrubber({
      markerStyle: "upcoming", markerData,
      snapshot: { ...snapshot, bookPageIndex: 35, pageProgressionDirection: direction },
    }, 1000);
    const bands = () => Array.from(container.querySelectorAll<HTMLElement>("[data-upcoming-band]"));
    expect(container.querySelector<HTMLElement>("[data-scrubber-track]")?.style.height).toBe("10px");
    expect(container.querySelector<HTMLElement>("[data-scrubber-fill]")?.style.width).toBe("35%");
    expect(bands().map(band => parseFloat(band.style.width))).toEqual([25, 40]);
    expect(bands().map(band => parseFloat(band.style.left))).toEqual(direction === "ltr" ? [35, 60] : [40, 0]);
    expect(container.querySelectorAll("[data-chapter-marker]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-upcoming-boundary]")).toHaveLength(1);
    expect(container.querySelector("[data-progress-markers]")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    pointer(slider, "pointerdown", { clientX: direction === "ltr" ? 770 : 270 });
    expect(bands()).toHaveLength(1);
    expect(parseFloat(bands()[0]!.style.width)).toBe(25);
    expect(onSeek).not.toHaveBeenCalled();
    pointer(slider, "pointercancel");
    expect(bands()).toHaveLength(2);
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(onSeek).toHaveBeenCalledWith(1);
    expect(bands()).toHaveLength(0);
  });

  it.each(["ltr", "rtl"] as const)("darkens unread back matter at the declared reading end (%s)", (direction) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64,
      toJSON() {},
    });
    const markerData = {
      ready: true, chapters: [], sections: [],
      landmarks: [{ kind: "start" as const, fraction: 0.1 }, { kind: "end" as const, fraction: 0.8 }],
    };
    for (const position of [70, 90]) {
      const { slider } = renderScrubber({
        markerStyle: "upcoming", markerData,
        snapshot: { ...snapshot, bookPageIndex: position, pageProgressionDirection: direction },
      }, 1000);
      const band = container.querySelector<HTMLElement>("[data-reading-end-band]")!;
      expect(band.style.opacity).toBe("0.64");
      expect(parseFloat(band.style.left)).toBe(direction === "ltr" ? Math.max(position, 80) : 0);
      expect(parseFloat(band.style.width)).toBeCloseTo(position === 70 ? 20 : 10);
      expect(container.querySelectorAll("[data-upcoming-band]")).toHaveLength(1);
      expect(container.querySelector('[data-reading-landmark="end"]')).toBeNull();
      const start = container.querySelector<HTMLElement>('[data-reading-landmark="start"]')!;
      expect(start.style.top).toBe("8px");
      expect(start.style.height).toBe("10px");
      expect(parseFloat(start.style.left)).toBe(direction === "ltr" ? 10 : 90);
      expect(footerHeight(slider)).toBe(SCRUBBER_HEIGHT);
    }
  });

  it.each(["ltr", "rtl"] as const)("colors front matter as one unread band matching back matter (%s)", direction => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 64, width: 1000, height: 64,
      toJSON() {},
    });
    for (const chapters of [[], [{ target: "a", label: "A", fraction: 0.2 }, { target: "b", label: "B", fraction: 0.5 }]]) {
      const markerData = {
        ready: true, chapters, sections: [],
        landmarks: [{ kind: "start" as const, fraction: 0.1 }, { kind: "end" as const, fraction: 0.8 }],
      };
      for (const position of [0, 5, 10, 50]) {
        renderScrubber({
          markerStyle: "upcoming", markerData,
          snapshot: { ...snapshot, bookPageIndex: position, pageProgressionDirection: direction },
        }, 1000);
        const front = container.querySelectorAll<HTMLElement>("[data-reading-start-band]");
        expect(front).toHaveLength(position < 10 ? 1 : 0);
        if (position < 10) {
          const back = container.querySelector<HTMLElement>("[data-reading-end-band]")!;
          expect(front[0]!.style.opacity).toBe(back.style.opacity);
          expect(front[0]!.style.background).toBe(back.style.background);
          expect(parseFloat(front[0]!.style.width)).toBeCloseTo(10 - position);
          expect(parseFloat(front[0]!.style.left)).toBeCloseTo(direction === "ltr" ? position : 90);
        }
      }
    }
  });

  it.each(["ltr", "rtl"] as const)("keeps clickable bookmarks in a separate fixed lane below the track (%s)", direction => {
    const bookmark = { id: "a", bookId: "book", cfi: "saved-cfi", label: "Chapter", createdAt: 0 };
    const { slider, onSeek, onGoToBookmark } = renderScrubber({
      markerStyle: "upcoming",
      snapshot: {
        ...snapshot, bookmarks: [bookmark], pageProgressionDirection: direction,
        bookmarkProgress: [{ id: "a", fraction: 0.25 }],
      },
    });
    const flag = container.querySelector<HTMLButtonElement>("[data-bookmark-marker]")!;
    const thumb = container.querySelector<HTMLElement>("[data-scrubber-thumb]")!;
    const track = container.querySelector<HTMLElement>("[data-scrubber-track]")!;
    expect(track.style.top).toBe("8px");
    expect(thumb.style.top).toBe("5px");
    expect(flag.style.left).toBe(direction === "ltr" ? "25%" : "75%");
    expect(slider.contains(flag)).toBe(false);
    expect(slider.nextElementSibling?.hasAttribute("data-bookmark-lane")).toBe(true);
    expect(footerHeight(slider)).toBe(SCRUBBER_HEIGHT);
    expect(SCRUBBER_HEIGHT).toBeLessThanOrEqual(ReadingTheme.PAGE_INSET_BOTTOM);
    act(() => flag.click());
    expect(onGoToBookmark).toHaveBeenCalledExactlyOnceWith(bookmark);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("keeps drag focus without its keyboard ring and restores keyboard modality on keydown or blur", () => {
    const { slider } = renderScrubber();
    pointer(slider, "pointerdown");
    expect(document.activeElement).toBe(slider);
    expect(slider.hasAttribute("data-pointer-focus")).toBe(true);
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(slider.hasAttribute("data-pointer-focus")).toBe(false);
    pointer(slider, "pointerdown");
    expect(slider.hasAttribute("data-pointer-focus")).toBe(true);
    act(() => slider.blur());
    expect(slider.hasAttribute("data-pointer-focus")).toBe(false);
    pointer(slider, "pointercancel");
  });

  it("shows counting status after reopening, but not during the initial appearance", () => {
    const countingSnapshot = { ...snapshot, bookPageIndex: 5, bookPageCount: undefined };
    renderScrubber({ snapshot: countingSnapshot });
    expect(container.textContent).not.toContain("Mapping your book");
    expect(container.querySelector('[role="slider"]')?.getAttribute("aria-valuetext"))
      .toBe("6 pages left in this chapter");
    renderScrubber({ snapshot: countingSnapshot });
    expect(container.textContent).not.toContain("Mapping your book");
    renderScrubber({ snapshot: countingSnapshot, visible: false });
    const { slider } = renderScrubber({
      snapshot: countingSnapshot,
      onPreview: () => ({
        position: { kind: "chapter", current: 8, total: 10 },
        chapterLabel: "A long chapter title",
      }),
    });
    expect(container.textContent).toContain("Mapping your book…");
    expect(container.textContent).not.toContain("Page 5 of");
    expect(slider.getAttribute("aria-valuetext")).toBe(
      "Mapping your book… - 6 pages left in this chapter",
    );
    pointer(slider, "pointerdown");
    expect(slider.getAttribute("aria-valuetext")).toBe(
      `${slider.getAttribute("aria-valuenow")}% · Mapping your book… - A long chapter title`,
    );
    expect(container.textContent).not.toContain("Chapter 8 of 10");
    expect(container.textContent).toContain("Mapping your book…");
    pointer(slider, "pointercancel");

    renderScrubber();
    expect(container.textContent).not.toContain("Mapping your book…");
    expect(slider.getAttribute("aria-valuetext")).toBe("Page 5 of 100 · 5% - 6 pages left in this chapter");
  });

  it("omits a missing authored section label from the seek announcement", () => {
    const { slider } = renderScrubber({
      onPreview: () => ({ position: { kind: "page", current: 8, total: 100 }, chapterLabel: "" }),
    });
    pointer(slider, "pointerdown");
    expect(slider.getAttribute("aria-valuetext")).toBe("Page 8 of 100");
    pointer(slider, "pointercancel");
  });

  it("uses an accessible percentage initially and counting status on reopen when no counts exist", () => {
    const emptyCounts = { ...snapshot, bookPageIndex: undefined, bookPageCount: undefined, pageCount: 0 };
    const { slider } = renderScrubber({
      snapshot: emptyCounts,
    });
    expect(slider.getAttribute("aria-valuetext")).toMatch(/^\d+%$/);
    expect(container.textContent).not.toContain("Mapping your book");
    renderScrubber({ snapshot: emptyCounts, visible: false });
    renderScrubber({ snapshot: emptyCounts });
    expect(slider.getAttribute("aria-valuetext")).toBe("Mapping your book…");
    expect(container.textContent).toContain("Mapping your book…");
    expect(container.textContent).not.toContain("pages left");
  });

  it.each(["paginated", "scroll"] as const)("shows fixed-layout pages even with saved %s mode", viewMode => {
    const { slider, onSeek } = renderScrubber({
      snapshot: { ...snapshot, isFixedLayout: true, viewMode, bookPageIndex: 1, bookPageCount: 5 },
    });
    expect(slider.getAttribute("aria-valuetext")).toBe("Page 1 of 5 · 20%");
    expect(container.textContent).not.toContain("pages left");
    expect(container.textContent).not.toContain("Mapping your book");
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onSeek).toHaveBeenCalledWith(0.4);
  });

  it.each(["ltr", "rtl"] as const)("groups distinct %s same-page bookmarks into one reachable flag", direction => {
    const bookmark = { id: "a", bookId: "book", cfi: "", label: "Chapter", createdAt: 0 };
    const { slider } = renderScrubber({
      snapshot: {
        ...snapshot,
        pageProgressionDirection: direction,
        bookmarks: [bookmark, { ...bookmark, id: "b" }],
        bookmarkProgress: [
          { id: "a", fraction: 0.25 },
          { id: "b", fraction: 0.25 },
        ],
      },
    });
    const markers = container.querySelectorAll<HTMLButtonElement>("[data-bookmark-marker]");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.style.left).toBe(direction === "rtl" ? "75%" : "25%");
    expect(markers[0]!.getAttribute("data-bookmark-count")).toBe("2");
    expect(markers[0]!.getAttribute("aria-label")).toBe("2 bookmarks — choose a destination");
    expect(markers[0]!.tabIndex).toBe(0);
    expect(markers[0]!.hasAttribute("aria-hidden")).toBe(false);
    expect(document.getElementById(slider.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Bookmarks: 2");
  });

  it("removes stale marks while layout is being measured and after deletion", () => {
    renderScrubber({ snapshot: {
      ...snapshot,
      bookmarks: [{ id: "a", bookId: "book", cfi: "saved", label: "Chapter", createdAt: 0 }],
      bookmarkProgress: [{ id: "a", fraction: 0.5 }],
    } });
    expect(container.querySelector("[data-bookmark-marker]")).not.toBeNull();
    renderScrubber({ snapshot: { ...snapshot, bookmarkProgress: undefined } });
    expect(container.querySelector("[data-bookmark-marker]")).toBeNull();
    const { slider } = renderScrubber({ snapshot: { ...snapshot, bookmarkProgress: [] } });
    expect(slider.hasAttribute("aria-describedby")).toBe(false);
  });

  it("announces the exact preview page, not a bookmark within the thumb's visual radius", () => {
    const { slider, onSeek } = renderScrubber({
      snapshot: {
        ...snapshot,
        bookPageIndex: 20_000,
        bookPageCount: 20_000,
        bookmarkProgress: [{ id: "last", fraction: 1 }],
      },
      onPreview: fraction => ({
        position: { kind: "page", current: Math.max(1, Math.round(fraction * 20_000)), total: 20_000 },
        chapterLabel: "Last chapter",
      }),
    });
    expect(slider.getAttribute("aria-valuetext")).toContain("Bookmarked");
    pointer(slider, "pointerdown", { clientX: 119.995 });
    expect(slider.getAttribute("aria-valuetext")).toBe("Page 19999 of 20000 - Last chapter");
    expect(container.querySelector("[data-bookmark-status]")).toBeNull();
    pointer(slider, "pointermove", { clientX: 120 });
    expect(container.querySelector("[data-bookmark-status]")?.textContent).toBe("Bookmarked");
    pointer(slider, "pointerup", { clientX: 120, buttons: 0 });
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(1);
    expect(slider.getAttribute("aria-valuetext"))
      .toBe("Going to position…: Page 20000 of 20000 - Last chapter - Bookmarked");
  });

  it.each([
    { position: { kind: "chapter", current: 5, total: 10 } as const, total: 100 },
    { position: { kind: "page", current: 5, total: 99 } as const, total: 100 },
    { position: { kind: "page", current: 5, total: 100 } as const, total: undefined },
  ])("does not label coarse or stale previews as bookmarked: %j", ({ position, total }) => {
    const { slider } = renderScrubber({
      snapshot: {
        ...snapshot,
        bookPageCount: total,
        bookmarkProgress: [{ id: "a", fraction: 0.05 }],
      },
      onPreview: () => ({ position, chapterLabel: "Chapter" }),
    });
    pointer(slider, "pointerdown");
    expect(slider.getAttribute("aria-valuetext")).not.toContain("Bookmarked");
    expect(container.querySelector("[data-bookmark-status]")).toBeNull();
  });

  it("clears exact-page status when markers are invalidated or deleted", () => {
    const marked = { ...snapshot, bookmarkProgress: [{ id: "a", fraction: 0.05 }] };
    const { slider } = renderScrubber({ snapshot: marked });
    expect(slider.getAttribute("aria-valuetext")).toContain("Bookmarked");
    renderScrubber({ snapshot: { ...marked, bookmarkProgress: undefined } });
    expect(slider.getAttribute("aria-valuetext")).not.toContain("Bookmarked");
    renderScrubber({ snapshot: { ...marked, bookmarkProgress: [] } });
    expect(slider.getAttribute("aria-valuetext")).not.toContain("Bookmarked");
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

  it("registers each painted bar and cleans up across reading-mode changes", () => {
    const cleanup = vi.fn();
    const register = vi.fn(() => cleanup);
    const handlers = {
      ref: register, onPointerEnter() {}, onPointerLeave() {}, onFocus() {}, onBlur() {},
    };
    const render = (viewMode: "scroll" | "paginated") => act(() => root.render(
      <ProgressScrubber
        snapshot={{ ...snapshot, viewMode }}
        visible
        handlers={handlers}
        onPreview={() => ({ position: { kind: "page", current: 1, total: 10 }, chapterLabel: "" })}
        onSeek={async () => {}}
        onSeekError={() => {}}
        onGoToBookmark={() => {}}
        onShowBookmarks={() => {}}
        bookmarkChooserDismissRequest={0}
        onBookmarkChooserOpenChange={() => {}}
      />,
    ));
    render("scroll");
    expect(register).not.toHaveBeenCalled();
    render("paginated");
    const firstBar = container.firstElementChild;
    expect(register).toHaveBeenLastCalledWith(firstBar);
    render("scroll");
    expect(cleanup).toHaveBeenCalledTimes(1);
    render("paginated");
    expect(register).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenLastCalledWith(container.firstElementChild);
    expect(container.firstElementChild).not.toBe(firstBar);
  });

  it("shows only the destination while dragging, keeps the actual position, and focuses the larger target", () => {
    const { slider, onSeek } = renderScrubber({ visible: false });
    pointer(slider, "pointerdown");
    expect(document.activeElement).toBe(slider);
    expect(slider.style.height).toBe("26px");
    expect(slider.parentElement!.style.zIndex).toBe("6");
    expect(footerHeight(slider)).toBe(SCRUBBER_HEIGHT);
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
