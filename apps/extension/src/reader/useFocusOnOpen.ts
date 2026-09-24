import { useEffect } from "react";
import type { RefObject } from "react";

/** Safety-net delay for the fallback focus attempt — comfortably longer
 * than any of this reader's own panel-open transitions (the longest is
 * 280ms, see `TocPanel`/`BookDetailsPanel`'s own transition durations),
 * so it only ever fires as a backstop if `transitionend` doesn't (e.g. a
 * future transition duration change, or an environment where transitions
 * don't fire the event the way real Chromium does). */
const FALLBACK_FOCUS_DELAY_MS = 350;

/**
 * Moves focus onto `ref`'s element whenever `open` becomes `true` — the
 * shared mechanic behind `TocPanel`'s and `BookDetailsPanel`'s "focus the
 * panel the instant it opens" behavior (see either one's doc comment for
 * *why* this matters for keyboard users). Both panels are flyouts that
 * animate in via a CSS `transition` on `opacity`/`visibility`/`transform`
 * rather than actually mounting/unmounting — real-Chromium testing found
 * a genuine, easy-to-miss browser quirk here: calling `.focus()`
 * *immediately* on the frame `open` flips to `true` (even from a `useEffect`,
 * which already runs after the DOM commit) silently does nothing, even
 * though `getComputedStyle` already reports `visibility: visible` at that
 * exact moment — Chrome defers actually accepting focus until the
 * element's `visibility`/`opacity` transition has *finished*, not just
 * started. An immediate attempt, a `transitionend` listener, and a fixed
 * fallback timeout cover either case. Pending retries must stop once
 * focus succeeds or moves elsewhere: a late retry can otherwise steal
 * focus from a newly-opened modal and deactivate its accessibility scope.
 */
export function useFocusOnOpen(ref: RefObject<HTMLElement | null>, open: boolean, requestId = 0): void {
  useEffect(() => {
    if (!open) {
      return;
    }
    const element = ref.current;
    if (!element) {
      return;
    }
    const ownerDocument = element.ownerDocument;
    element.focus({ preventScroll: true });
    if (element.contains(ownerDocument.activeElement)) {
      return;
    }
    const cancelRetries = (): void => {
      element.removeEventListener("transitionend", tryFocus);
      ownerDocument.removeEventListener("focusin", cancelRetries);
      window.clearTimeout(fallback);
    };
    const tryFocus = (): void => {
      element.focus({ preventScroll: true });
      if (element.contains(ownerDocument.activeElement)) {
        cancelRetries();
      }
    };
    element.addEventListener("transitionend", tryFocus);
    ownerDocument.addEventListener("focusin", cancelRetries);
    const fallback = window.setTimeout(() => {
      tryFocus();
      cancelRetries();
    }, FALLBACK_FOCUS_DELAY_MS);
    return cancelRetries;
  }, [open, ref, requestId]);
}
