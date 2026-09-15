import { useEffect, useState } from "react";
import type { FC } from "react";

export interface LiveRegionProps {
  text: string | undefined;
  /** Bumped by the caller on every announcement, including repeats of the
   * same text — an `aria-live` region only reacts to a DOM text *change*,
   * so without this, two consecutive identical announcements (e.g. a page
   * turn landing back on "Page 3 of 12" some other way) would silently
   * not re-announce. */
  announcementId: number;
}

/** A visually-hidden `aria-live="polite"` region announcing reader state
 * changes (page turns, chapter changes, view-mode switches — see
 * `ReaderController.announce`) to screen readers, independent of focus:
 * the reader deliberately doesn't force focus to move on every minor
 * in-chapter page turn (that would be disorienting), so this is how such
 * changes still reach a screen reader user. */
export const LiveRegion: FC<LiveRegionProps> = ({ text, announcementId }) => {
  // Briefly clearing and restoring the text (rather than rendering it
  // directly) guarantees a real DOM mutation even if `text` itself is
  // identical to what's already there, which `aria-live` needs to fire an
  // announcement at all.
  const [displayedText, setDisplayedText] = useState<string | undefined>(text);

  useEffect(() => {
    setDisplayedText(undefined);
    const timeout = setTimeout(() => setDisplayedText(text), 50);
    return () => clearTimeout(timeout);
    // Intentionally keyed on announcementId, not `text` itself — see the
    // component's whole purpose above.
  }, [announcementId]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0, 0, 0, 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {displayedText}
    </div>
  );
};
