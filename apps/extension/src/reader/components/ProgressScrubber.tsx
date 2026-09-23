import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FC, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Caption1 } from "@fluentui/react-components";
import type { PreviewPosition, ReaderSnapshot } from "../ReaderTypes.js";
import { CHROME_BACKDROP_FILTER, CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

/** Smallest gap the drag preview popup is ever allowed from the browser
 * window's left/right edges — purely cosmetic breathing room, not a
 * layout necessity. */
const POPUP_EDGE_MARGIN = 8;

export interface ProgressScrubberProps {
  snapshot: ReaderSnapshot;
  /** Whether the scrubber should currently be shown — tied to the same
   * `useAutoHideChrome` state the toolbar uses (see `ReaderApp`), so the
   * two fade in and out together as one unit of chrome. */
  visible: boolean;
  handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** A live, side-effect-free preview of where a drag at `fraction`
   * would land — see `ReaderController.previewSeek`. */
  onPreview: (fraction: number) => { position: PreviewPosition; chapterLabel: string };
  /** Resolves after navigation publishes its final snapshot, not when
  * loading starts. Both pointer and keyboard seeks retain their
  * optimistic destination until this promise settles. */
  onSeek: (fraction: number) => Promise<void>;
  onSeekError: (error: unknown) => void;
}

/** The current reading position as a fraction (0 to 1) of the whole
 * book — prefers exact, book-wide page numbers once `BookPaginationEstimator`
 * has measured the whole book (see `bookPageIndex`/`bookPageCount`),
 * falling back to a coarser measure (current spine item, plus its own
 * in-chapter page fraction if known) while that's still in progress —
 * consistent with `ReaderController.previewSeek`/`seekToFraction`'s own
 * preference order, so the scrubber's resting position and a drag's
 * preview always agree on what a given fraction means. */
function currentFraction(snapshot: ReaderSnapshot): number {
  if (
    snapshot.bookPageIndex !== undefined &&
    snapshot.bookPageCount !== undefined &&
    snapshot.bookPageCount > 0
  ) {
    return snapshot.bookPageIndex / snapshot.bookPageCount;
  }
  if (snapshot.spineLength > 0) {
    const chapterFraction = snapshot.pageCount > 0 ? snapshot.pageIndex / snapshot.pageCount : 0;
    return (snapshot.spineIndex + chapterFraction) / snapshot.spineLength;
  }
  return 0;
}

/**
 * A horizontal, scrubbable progress bar across the very bottom of the
 * reader pane — lets a reader "zoom through the book" by dragging,
 * rather than only turning one page/chapter at a time. Shares the
 * toolbar's own show/hide chrome state (see `ReaderApp`) so both fade
 * together, and shows a small popup above the thumb while dragging with
 * a live preview of where that position is (page number and chapter
 * name) — see `ReaderController.previewSeek`.
 *
 * Also shows the reader's actual *current* position ("Page X of Y - Z
 * pages left in this chapter") in its own row above the track — this is
 * deliberately not the same thing as the drag preview above: it reflects
 * whatever page is genuinely on screen right now, not wherever a drag
 * happens to be pointing, so it stays put/unaffected while dragging
 * (the preview popup floats above it instead of replacing it).
 *
 * Deliberately never claims more precision than the reader currently
 * has: `currentFraction`/`previewSeek` both prefer an exact book-wide
 * page number once it's known, but happily fall back to a coarser
 * chapter-level position while a large book's background pagination is
 * still catching up (see `BookPaginationEstimator`) — the scrubber
 * itself doesn't need to know or care which one it's showing, since
 * both are expressed as the same 0-to-1 fraction either way.
 *
 * Scoped to paginated/spread reflowable content only, matching
 * `PageFurniture`'s own scope — scroll mode's native scrollbar already
 * serves this purpose, and fixed-layout content has no meaningful
 * "page" position to scrub through page-by-page.
 */
export const ProgressScrubber: FC<ProgressScrubberProps> = ({
  snapshot,
  visible,
  handlers,
  onPreview,
  onSeek,
  onSeekError,
}) => {
  const chromeTheme = useChromeTheme();
  const reduceMotion = usePrefersReducedMotion();
  const t = useTranslation();
  const rtl = snapshot.pageProgressionDirection === "rtl";
  const barRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [dragFraction, setDragFraction] = useState<number | undefined>(undefined);
  const [pendingSeek, setPendingSeek] = useState<{
    id: number;
    fraction: number;
    preview: ReturnType<ProgressScrubberProps["onPreview"]>;
  }>();
  const seekIdRef = useRef(0);
  // The popup's horizontal center, in pixels relative to the bar (`barRef`)
  // it's positioned within — clamped so it never runs past the browser
  // window's left/right edges, unlike naively centering it on the thumb
  // via a `left` percentage (which is exactly where thumb and popup are
  // the same thing, but breaks down near either end of the track, since
  // the popup itself has real width that a bare percentage doesn't
  // account for). Recomputed via `useLayoutEffect` below, since it
  // depends on the popup's own *rendered* width (its text content, and
  // thus width, changes as the drag moves across page/chapter numbers).
  const [popupCenterPx, setPopupCenterPx] = useState<number | undefined>(undefined);
  // Declared alongside the other refs (not down where it's used) so
  // every hook in this component runs unconditionally on every render —
  // see the early-return guard just before the final JSX for why that
  // matters here specifically.
  const activePointerIdRef = useRef<number | undefined>(undefined);

  const optimisticFraction = dragFraction ?? pendingSeek?.fraction;
  const preview = dragFraction !== undefined ? onPreview(dragFraction) : pendingSeek?.preview;
  const previewLabel = preview
    ? preview.position.kind === "page"
      ? t("scrubber.pageOfTotal", { current: preview.position.current, total: preview.position.total })
      : t("scrubber.chapterOfTotal", { current: preview.position.current, total: preview.position.total })
    : undefined;

  useLayoutEffect(() => {
    const bar = barRef.current;
    const track = trackRef.current;
    const popup = popupRef.current;
    if (!bar || !track || !popup || optimisticFraction === undefined) {
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const popupWidth = popup.getBoundingClientRect().width;
    const desiredCenterInViewport = trackRect.left + (rtl ? 1 - optimisticFraction : optimisticFraction) * trackRect.width;
    const halfWidth = popupWidth / 2;
    const minCenter = POPUP_EDGE_MARGIN + halfWidth;
    const maxCenter = window.innerWidth - POPUP_EDGE_MARGIN - halfWidth;
    const clampedCenterInViewport = Math.min(
      maxCenter,
      Math.max(minCenter, desiredCenterInViewport),
    );
    setPopupCenterPx(clampedCenterInViewport - barRect.left);
    // `previewLabel`/`preview.chapterLabel` deliberately included: the
    // popup's rendered width changes as its text does (e.g. "Page 9 of
    // 12" vs "Page 100 of 120"), which can itself push it back into (or
    // out of) needing to be clamped, even without `dragFraction` moving.
  }, [optimisticFraction, previewLabel, preview?.chapterLabel, rtl]);

  const fractionAt = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) {
      return 0;
    }
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return 0;
    }
    const physicalFraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return rtl ? 1 - physicalFraction : physicalFraction;
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activePointerIdRef.current !== undefined || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    // Pointer capture is still required here, not just a nicety: without
    // it, a real (Chromium-in-this-environment, at least) hang was
    // reproduced by dragging the pointer — button still held — from the
    // track up into the sandboxed content iframe. Capture keeps the
    // browser's own hit-testing pinned to the track for the whole
    // gesture, which avoids that; the *separate*, real "stuck after
    // release" bug this is otherwise fixing is about the eventual
    // release (pointerup/pointercancel) not reliably arriving back here
    // — see the effect below.
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    setDragFraction(fractionAt(event.clientX));
  };

  // A pending navigation is not an active gesture. Keeping drag listeners
  // alive after release used to submit another seek on every mouse move;
  // an older completion could then erase the newest optimistic position.
  const commitSeek = async (fraction: number): Promise<void> => {
    const id = ++seekIdRef.current;
    setPendingSeek({ id, fraction, preview: onPreview(fraction) });
    try {
      await onSeek(fraction);
    } catch (error) {
      if (id === seekIdRef.current) onSeekError(error);
    } finally {
      // The controller publishes its final external-store snapshot before
      // settling. React reads that store in the same render that clears this
      // overlay; no frame-count or timeout can stand in for seek completion.
      setPendingSeek(current => current?.id === id ? undefined : current);
    }
  };

  const releaseDrag = (): void => {
    const track = trackRef.current;
    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = undefined;
    if (track && pointerId !== undefined && track.hasPointerCapture(pointerId)) {
      track.releasePointerCapture(pointerId);
    }
    setDragFraction(undefined);
  };

  const finishDrag = (fraction: number): void => {
    releaseDrag();
    void commitSeek(fraction);
  };

  // The drag's move/release handling deliberately lives in a
  // window-level effect below, not as onPointerMove/onPointerUp props on
  // the track element — see this effect's doc comment for why: relying
  // solely on the captured element's own pointerup/pointercancel
  // eventually arriving is exactly what caused a real, reported bug
  // where the scrubber stayed stuck tracking the mouse after release.
  useEffect(() => {
    if (dragFraction === undefined) {
      return;
    }

    const finalizeFromEvent = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerIdRef.current) return;
      finishDrag(fractionAt(event.clientX));
    };

    const cancelFromEvent = (event: PointerEvent): void => {
      if (event.pointerId === activePointerIdRef.current) releaseDrag();
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== activePointerIdRef.current) return;
      // `event.buttons` reflects the pointing device's *actual current*
      // button state on every move, independent of how this specific
      // event was routed to us — unlike relying solely on a captured
      // element's own pointerup/pointercancel arriving, which can
      // silently never happen at all: this reader's book content is
      // rendered in sandboxed iframes (separate top-level documents),
      // and a real, hard-to-repro Chromium quirk can apparently drop or
      // misdeliver the eventual release back to the parent document —
      // exactly what the report's "moving vertically in and out of the
      // region" points at: the scrubber sits at the very bottom edge of
      // the pane, right next to the content iframe. Treating "no buttons
      // currently held" as an implicit release, the instant we next see
      // *any* pointer activity back in this (parent) document, self-heals
      // the stuck state — this is also why these are `window` listeners
      // rather than handlers on the track element itself: a native event
      // bubbles to `window` from wherever it actually landed in this
      // document, not just from the narrow 16px track strip, so the
      // self-heal doesn't need the pointer to specifically re-hover the
      // track to recover.
      if (event.buttons === 0) {
        finalizeFromEvent(event);
        return;
      }
      setDragFraction(fractionAt(event.clientX));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finalizeFromEvent);
    window.addEventListener("pointercancel", cancelFromEvent);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finalizeFromEvent);
      window.removeEventListener("pointercancel", cancelFromEvent);
    };
    // `fractionAt`/`finishDrag` close over refs and stable props only —
    // deliberately excluded so this effect doesn't tear down and
    // re-attach its listeners on every fraction update mid-drag.
  }, [dragFraction !== undefined]);

  const displayFraction = optimisticFraction ?? currentFraction(snapshot);

  // "Page X of Y" and "Z pages left in this chapter" — the reader's
  // actual current position, not tied to a drag at all (unlike
  // everything else in this bar) — deliberately styled/positioned as
  // its own row above the track, not overlapping the drag-preview
  // popup's own space (which floats above the *entire* bar via `bottom:
  // 100%`, so adding a row inside the bar doesn't move it), so the two
  // don't read as the same thing even though they're visually close
  // together.
  //
  // Kept as two separate pieces (a centered "Page X of Y" and a
  // far-right "Z pages left in this chapter"), not one hyphen-joined
  // string — per explicit design direction, "pages left in this
  // chapter" reads as a secondary, more detailed stat that shouldn't
  // compete for the same centered emphasis as the book-wide page count.
  // "Pages left" only needs this chapter's own page count, known
  // immediately on open; the book-wide "Page X of Y" needs
  // `BookPaginationEstimator` to have reached this point in a possibly-
  // still-measuring book, so it's dropped (not shown as a placeholder)
  // until that's known, consistent with how the rest of the reader's
  // chrome degrades gracefully — the far-right label still shows on its
  // own in that case, since it doesn't depend on the same thing.
  const pagesLeftInChapter =
    snapshot.pageCount > 0 ? snapshot.pageCount - snapshot.pageIndex : undefined;
  const pagesLeftLabel =
    pagesLeftInChapter === undefined
      ? undefined
      : t(pagesLeftInChapter === 1 ? "scrubber.pagesLeftInChapterOne" : "scrubber.pagesLeftInChapterOther", {
          count: pagesLeftInChapter,
        });
  const bookPageLabel =
    snapshot.bookPageIndex !== undefined && snapshot.bookPageCount !== undefined
      ? t("scrubber.pageOfTotal", { current: snapshot.bookPageIndex, total: snapshot.bookPageCount })
      : undefined;
  // Still exposed as one combined string for the slider's own
  // `aria-valuetext` (see below) — a screen reader doesn't care how the
  // two pieces are laid out visually, just that both are announced.
  const currentPositionLabel =
    bookPageLabel && pagesLeftLabel
      ? `${bookPageLabel} - ${pagesLeftLabel}`
      : (bookPageLabel ?? pagesLeftLabel);

  // Keyboard operability for the `role="slider"` track — required by the
  // ARIA slider pattern, not optional polish: without this, the track was
  // reachable by Tab (a real `tabIndex` was missing too, so it wasn't
  // even that) but entirely inert for anyone not using a mouse/touch,
  // including screen reader users navigating by keyboard. Left/Right/Up/
  // Down step by one book-wide page at a time (matching the conventional
  // slider direction, both orientations supported since this track is
  // visually horizontal but ARIA sliders don't mandate one) once
  // `bookPageCount` is known — falling back to a flat 1% while a large
  // book's background pagination is still catching up, consistent with
  // how the rest of this component degrades (see `currentFraction`).
  // Page Up/Down move by roughly a chapter's worth (10 pages, or 5%
  // without a known page count), Home/End jump to the very start/end of
  // the book. Each key press commits immediately via `onSeek` rather
  // than staging a drag — there's no "release" gesture for a keyboard
  // interaction to wait for.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const smallStep =
      snapshot.bookPageCount !== undefined && snapshot.bookPageCount > 0
        ? 1 / snapshot.bookPageCount
        : 0.01;
    const bigStep =
      snapshot.bookPageCount !== undefined && snapshot.bookPageCount > 0
        ? Math.min(0.2, 10 / snapshot.bookPageCount)
        : 0.05;
    let next: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = Math.max(0, Math.min(1, displayFraction + (rtl ? -smallStep : smallStep)));
        break;
      case "ArrowLeft":
        next = Math.max(0, Math.min(1, displayFraction + (rtl ? smallStep : -smallStep)));
        break;
      case "ArrowUp":
        next = Math.min(1, displayFraction + smallStep);
        break;
      case "ArrowDown":
        next = Math.max(0, displayFraction - smallStep);
        break;
      case "PageUp":
        next = Math.min(1, displayFraction + bigStep);
        break;
      case "PageDown":
        next = Math.max(0, displayFraction - bigStep);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    releaseDrag();
    void commitSeek(next);
  };

  // Scoped to paginated/spread reflowable content only (see this
  // component's doc comment) — deliberately checked only *after* every
  // hook above has run unconditionally on every render. An early return
  // before a hook call is a real bug (not just a lint nit): switching
  // from paginated to scroll mode changes which branch this component
  // takes, and if a hook further down were skipped on that render,
  // React's hook-call-order bookkeeping desyncs and throws ("Rendered
  // fewer hooks than expected"), crashing the whole reader — caught via
  // real-Chromium testing switching view modes with this panel mounted.
  if (snapshot.isFixedLayout || snapshot.viewMode !== "paginated") {
    return null;
  }

  return (
    <div
      ref={barRef}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        padding: "6px 14px",
        background: chromeTheme.background,
        backdropFilter: CHROME_BACKDROP_FILTER,
        WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
        borderTop: `1px solid ${CHROME_BORDER}`,
        boxShadow: visible ? CHROME_SHADOW : "none",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        pointerEvents: visible ? "auto" : "none",
        transition: reduceMotion
          ? "none"
          : "opacity 240ms ease, transform 240ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 240ms ease",
      }}
    >
      {(bookPageLabel || pagesLeftLabel) && (
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "baseline",
            margin: "0 0 6px",
            pointerEvents: "none",
          }}
        >
          <span />
          <Caption1 as="p" block style={{ margin: 0, textAlign: "center", opacity: 0.55 }}>
            {bookPageLabel}
          </Caption1>
          <Caption1 as="p" block style={{ margin: 0, textAlign: "right", opacity: 0.55 }}>
            {pagesLeftLabel}
          </Caption1>
        </div>
      )}

      {preview && (
        <div
          ref={popupRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "100%",
            // Falls back to the un-clamped percentage-based center for
            // the very first paint before `useLayoutEffect` has had a
            // chance to measure the popup's real width — briefly
            // inaccurate only at the extreme edges, on the first frame
            // of a drag, never visibly clipped since the layout effect
            // runs before the browser actually paints.
            left: popupCenterPx ?? `${(rtl ? 1 - optimisticFraction! : optimisticFraction!) * 100}%`,
            // Without an explicit width, an absolutely positioned box
            // with only `left` set (no `right`) shrink-to-fits within
            // the space *remaining* to the containing block's edge —
            // which the `translateX(-50%)` centering below doesn't
            // factor into (transforms are purely a paint-time effect,
            // invisible to layout) — so near either edge the popup got
            // squeezed narrower than its own text and wrapped, even
            // though its clamped position had plenty of room to its
            // *other* side. `max-content` sizes it to its content's own
            // preferred width unconditionally, matching what
            // `white-space: nowrap` below already assumes.
            width: "max-content",
            transform: "translate(-50%, -8px)",
            background: chromeTheme.background,
            backdropFilter: CHROME_BACKDROP_FILTER,
            WebkitBackdropFilter: CHROME_BACKDROP_FILTER,
            border: `1px solid ${CHROME_BORDER}`,
            borderRadius: 8,
            boxShadow: CHROME_SHADOW,
            padding: "6px 12px",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          {/* Fluent's Caption1 sets its own `text-align: start`, which
              wins over the popup div's inherited `center` above — so
              each line needs `textAlign: "center"` set directly on it. */}
          <Caption1 as="span" block style={{ fontWeight: 600, textAlign: "center" }}>
            {previewLabel}
          </Caption1>
          <Caption1
            as="span"
            block
            style={{ color: "var(--colorNeutralForeground2, #444)", textAlign: "center" }}
          >
            {preview.chapterLabel}
          </Caption1>
        </div>
      )}

      <div
        ref={trackRef}
        onPointerDown={beginDrag}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={t("scrubber.positionInBook")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayFraction * 100)}
        aria-valuetext={previewLabel
          ? `${previewLabel} - ${preview!.chapterLabel}`
          : currentPositionLabel ?? `${Math.round(displayFraction * 100)}%`}
        style={{
          position: "relative",
          height: 16,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 4,
            borderRadius: 2,
            background: "var(--colorNeutralStroke2, rgba(0, 0, 0, 0.12))",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: rtl ? "auto" : 0,
            right: rtl ? 0 : "auto",
            width: `${displayFraction * 100}%`,
            height: 4,
            borderRadius: 2,
            background: chromeTheme.accent,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${(rtl ? 1 - displayFraction : displayFraction) * 100}%`,
            width: 12,
            height: 12,
            borderRadius: "50%",
            transform: "translateX(-50%)",
            background: chromeTheme.accent,
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
          }}
        />
      </div>
    </div>
  );
};
