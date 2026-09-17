import { useEffect, useRef, useState } from "react";

/** How long the toolbar stays visible after the most recent activity
 * before fading away. */
const HIDE_DELAY_MS = 2500;

/** How close to the top or bottom edge of the window the pointer has to
 * get for a bare pointer move to reveal the chrome — deliberately not
 * "anywhere in the window," since that made moving the mouse across the
 * gutter between two pages in spread mode (a perfectly ordinary reading
 * gesture, nothing to do with wanting the toolbar) reveal it too. Sized
 * generously enough to cover the toolbar/scrubber's own footprint plus a
 * little approach room, without covering so much of the page that normal
 * reading-area movement still triggers it. */
const EDGE_REVEAL_ZONE_PX = 96;

export interface AutoHideChrome {
  /** Whether the toolbar should currently be shown. */
  visible: boolean;
  /** Spread onto the toolbar's root element — keeps it visible while the
   * pointer is over it or it (or something inside it) has focus, and
   * schedules a fade once neither is true anymore. */
  handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

/**
 * Auto-hides the reader's toolbar chrome after a period of inactivity, so
 * it doesn't visually compete with the page underneath it once a reader
 * settles into actually reading — a deliberately "less intrusive" chrome
 * behavior, restoring it on a key press anywhere in the reader, or a
 * pointer move that reaches near the top or bottom edge of the window
 * (see `EDGE_REVEAL_ZONE_PX`) — deliberately *not* anywhere the pointer
 * moves at all, which used to reveal the chrome on the perfectly
 * ordinary reading gesture of moving the mouse across the gutter between
 * two pages in spread mode, nothing to do with wanting the toolbar.
 * Stays shown continuously whenever `pinned` is true (e.g. the Table of
 * Contents panel is open — the toolbar holds its own close control) or
 * the pointer/focus is on the toolbar itself.
 *
 * `contentActivityId`, if given, is watched for changes (typically
 * `ReaderSnapshot.contentPointerActivityId`) and hides the toolbar
 * *immediately* — no fade delay — the instant it changes: a click into
 * the book content is a strong, deliberate signal the reader wants the
 * chrome out of the way right now, not in `HIDE_DELAY_MS`. Ignores the
 * id's very first defined value (whether that's on mount, or — since this
 * hook is called before the book has finished loading — on the later
 * render where a still-loading `undefined` id first becomes a real
 * number) so a freshly-mounted toolbar is never hidden before the reader
 * has actually done anything.
 *
 * The fade is purely a cosmetic, mouse-oriented convenience: the toolbar
 * remains in the accessibility tree and keyboard-focusable at all times
 * regardless of `visible` — only its opacity/pointer-events change (see
 * the `Toolbar` component's styling) — so a keyboard or assistive
 * technology user is never blocked from reaching it.
 */
export function useAutoHideChrome(pinned: boolean, contentActivityId?: number): AutoHideChrome {
  const [visible, setVisible] = useState(true);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const scheduleHide = (): void => {
    window.clearTimeout(timerRef.current);
    if (pinned || hoveredRef.current || focusedRef.current) {
      return;
    }
    timerRef.current = window.setTimeout(() => {
      if (!hoveredRef.current && !focusedRef.current) {
        setVisible(false);
      }
    }, HIDE_DELAY_MS);
  };

  useEffect(() => {
    if (pinned) {
      setVisible(true);
      window.clearTimeout(timerRef.current);
      return;
    }

    const reveal = (): void => {
      setVisible(true);
      scheduleHide();
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const nearTop = event.clientY <= EDGE_REVEAL_ZONE_PX;
      const nearBottom = event.clientY >= window.innerHeight - EDGE_REVEAL_ZONE_PX;
      if (nearTop || nearBottom) {
        reveal();
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("keydown", reveal);
    // A window resize (e.g. crossing the two-page-spread width threshold,
    // which swaps the whole content host) is itself a deliberate user
    // action that changes the layout — worth surfacing the chrome for,
    // even if the pointer never touches the reveal strip/toolbar during
    // an OS-level window-edge drag.
    window.addEventListener("resize", reveal);
    scheduleHide();

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("keydown", reveal);
      window.removeEventListener("resize", reveal);
      window.clearTimeout(timerRef.current);
    };
  }, [pinned]);

  // Only hides on a genuine *increment* of contentActivityId — never on
  // mount, and never on the id's very first defined value. The reader
  // calls this hook unconditionally before its book has finished loading
  // (so it can share one visibility state between the toolbar and the
  // progress scrubber, both of which only render once `snapshot` exists —
  // see `ReaderApp`), so `contentActivityId` itself starts as `undefined`
  // and jumps straight to its first real number once the snapshot arrives.
  // That jump is just the book finishing loading, not a deliberate click
  // into the content — without this guard it was indistinguishable from a
  // real activity bump and hid a freshly-mounted toolbar before the reader
  // had done anything.
  const previousActivityIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const previous = previousActivityIdRef.current;
    previousActivityIdRef.current = contentActivityId;
    if (previous === undefined || contentActivityId === undefined || pinned || hoveredRef.current || focusedRef.current) {
      return;
    }
    window.clearTimeout(timerRef.current);
    setVisible(false);
  }, [contentActivityId]);

  return {
    visible,
    handlers: {
      onPointerEnter: () => {
        hoveredRef.current = true;
        setVisible(true);
        window.clearTimeout(timerRef.current);
      },
      onPointerLeave: () => {
        hoveredRef.current = false;
        scheduleHide();
      },
      onFocus: () => {
        focusedRef.current = true;
        setVisible(true);
        window.clearTimeout(timerRef.current);
      },
      onBlur: () => {
        focusedRef.current = false;
        scheduleHide();
      },
    },
  };
}
