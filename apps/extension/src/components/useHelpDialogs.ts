import { useCallback, useEffect, useRef, useState } from "react";

type HelpView = "about" | "shortcuts";

export function captureFocusReturn(restoreReadingFocus?: () => void, target?: HTMLElement | null): () => void {
  const element = target ?? document.activeElement;
  return () => {
    if (element instanceof HTMLElement && element.tagName !== "IFRAME" &&
      element !== document.body && element.isConnected &&
      getComputedStyle(element).visibility !== "hidden") {
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || ancestor.inert ||
          ancestor.style.visibility === "hidden" || ancestor.style.display === "none") {
          restoreReadingFocus?.();
          return;
        }
      }
      // Fluent clears its temporary aria-hidden scope when focus returns outside the modal.
      element.focus({ preventScroll: true });
      if (element.ownerDocument.activeElement === element) return;
    }
    restoreReadingFocus?.();
  };
}

export function useHelpDialogs(restoreReadingFocus?: () => void) {
  const [view, setView] = useState<HelpView>();
  const [focusShortcutsOnOpen, setFocusShortcutsOnOpen] = useState(false);
  const returnToAbout = useRef(false);
  const restorePending = useRef(false);
  const focusReturn = useRef<(() => void) | undefined>(undefined);
  const restoreFrame = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (restoreFrame.current !== undefined) cancelAnimationFrame(restoreFrame.current);
  }, []);

  const captureFocus = useCallback((target?: HTMLElement | null) => {
    if (restoreFrame.current !== undefined) {
      cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = undefined;
    }
    focusReturn.current = captureFocusReturn(restoreReadingFocus, target);
    restorePending.current = false;
  }, [restoreReadingFocus]);

  const openHelp = useCallback((target?: HTMLElement | null) => {
    captureFocus(target);
    setFocusShortcutsOnOpen(false);
    returnToAbout.current = false;
    setView("about");
  }, [captureFocus]);

  const openShortcuts = useCallback(() => {
    captureFocus();
    setFocusShortcutsOnOpen(false);
    returnToAbout.current = false;
    setView("shortcuts");
  }, [captureFocus]);

  const openShortcutsFromHelp = useCallback(() => {
    setFocusShortcutsOnOpen(false);
    returnToAbout.current = true;
    setView("shortcuts");
  }, []);

  const close = useCallback(() => {
    if (view === "shortcuts" && returnToAbout.current) {
      returnToAbout.current = false;
      setFocusShortcutsOnOpen(true);
      setView("about");
    } else {
      restorePending.current = true;
      setFocusShortcutsOnOpen(false);
      setView(undefined);
    }
  }, [view]);

  const closeToContent = useCallback(() => {
    returnToAbout.current = false;
    focusReturn.current = restoreReadingFocus;
    restorePending.current = true;
    setFocusShortcutsOnOpen(false);
    setView(undefined);
  }, [restoreReadingFocus]);

  const afterClose = useCallback(() => {
    if (!restorePending.current) return;
    restorePending.current = false;
    // Fluent removes its modal/inert scope after the exit-motion callback returns.
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = undefined;
      focusReturn.current?.();
      focusReturn.current = undefined;
    });
  }, []);

  return { view, focusShortcutsOnOpen, openHelp, openShortcuts, openShortcutsFromHelp, close, closeToContent, afterClose };
}
