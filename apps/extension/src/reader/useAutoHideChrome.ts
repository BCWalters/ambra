import { useEffect, useRef, useState } from "react";

/** How long the toolbar stays visible after the most recent activity
 * before fading away. */
const HIDE_DELAY_MS = 2500;

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
 * behavior, restoring it instantly on any pointer movement or key press
 * anywhere in the reader, and keeping it shown continuously whenever
 * `pinned` is true (e.g. the Table of Contents panel is open — the
 * toolbar holds its own close control) or the pointer/focus is on the
 * toolbar itself.
 *
 * The fade is purely a cosmetic, mouse-oriented convenience: the toolbar
 * remains in the accessibility tree and keyboard-focusable at all times
 * regardless of `visible` — only its opacity/pointer-events change (see
 * the `Toolbar` component's styling) — so a keyboard or assistive
 * technology user is never blocked from reaching it.
 */
export function useAutoHideChrome(pinned: boolean): AutoHideChrome {
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

    const handleActivity = (): void => {
      setVisible(true);
      scheduleHide();
    };
    window.addEventListener("pointermove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    scheduleHide();

    return () => {
      window.removeEventListener("pointermove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.clearTimeout(timerRef.current);
    };
  }, [pinned]);

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
