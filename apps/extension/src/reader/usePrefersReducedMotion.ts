import { useEffect, useState } from "react";

/** Whether the user has `prefers-reduced-motion: reduce` set at the OS/
 * browser level — already respected for the page-turn animation (see
 * `ReaderController`'s own `window.matchMedia` checks); this hook exists
 * so the reader's other transform/opacity-driven chrome transitions (the
 * TOC and Book Details flyout panels sliding in, the toolbar/progress
 * scrubber fading in and out) can honor the same preference consistently
 * rather than only the most prominent animation. Reactive to the
 * preference changing while the page is open (e.g. a user toggling the
 * OS setting mid-session), not just read once on mount.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return;
    }
    const handleChange = (): void => setReduced(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}
