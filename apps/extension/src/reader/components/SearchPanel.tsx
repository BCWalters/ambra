import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1, SearchBox, Spinner, Tooltip } from "@fluentui/react-components";
import { DismissRegular, PinOffRegular, PinRegular } from "@fluentui/react-icons";
import { CHROME_BORDER, CHROME_HOVER_BACKGROUND, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import type { SearchResultItem } from "../SearchCoordinator.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

/** Debounces the search box's `onChange` before actually calling
 * `ReaderController.search` (see `TocPanel`'s former identical
 * constant, before search was split into its own panel — issue #55),
 * since a book-wide full-text search re-reads every not-yet-searched
 * spine item's content document from scratch and shouldn't restart on
 * every single keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

export interface SearchPanelProps {
  /** The last query actually *submitted* to `ReaderController.search`
   * (see `ReaderSnapshot.searchQuery`) — used only to initialize the
   * input's local state on first mount, so reopening the panel after a
   * previous search still shows what was searched for. */
  query: string;
  results: readonly SearchResultItem[];
  isSearching: boolean;
  onSearch: (query: string) => void;
  onSelect: (cfi: string) => void;
  /** Whether the panel should currently be shown at all. Always
   * rendered (never conditionally unmounted) so it can animate closed
   * instead of simply vanishing — mirrors `TocPanel`/`AnnotationsPanel`. */
  open: boolean;
  /** `true` docks the panel in the normal layout flow, pushing the
   * content pane over; `false` (the default) makes it fly out as a
   * translucent overlay instead, auto-dismissing on selection, an
   * outside click, or Escape. */
  pinned: boolean;
  onTogglePin: () => void;
  onRequestClose: () => void;
  /** Whether the progress scrubber is currently shown (paginated
   * reflowable content only — see `ProgressScrubber`'s own identical
   * condition) — this panel needs to stop *above* it rather than
   * running the full pane height, or the scrubber bar ends up covering
   * its last few rows (issue #59). */
  scrubberVisible: boolean;
}

/**
 * Book-wide full-text search, promoted to its own toolbar button and
 * flyout panel (issue #55) — previously a second tab bolted onto the
 * Table of Contents panel, which buried a genuinely first-class reading
 * feature behind an extra click and made "browsing the book's
 * structure" and "searching its text" compete for the same limited
 * panel space. Structurally a near-twin of `TocPanel`/`AnnotationsPanel`
 * (flyout-by-default, pin-to-dock, Escape/outside-click dismiss), just
 * with search's own single-purpose content instead of a tab strip —
 * though it now docks on the *opposite* edge of the reader pane from
 * those two (issue #68: most readers expect search alongside other
 * "about this book" tools like Book Details, not mixed in with pure
 * navigation panels like Contents/Bookmarks), mutually exclusive with
 * `BookDetailsPanel` rather than with `TocPanel`/`AnnotationsPanel` now
 * (see `ReaderApp`'s `rightPanel` state).
 *
 * No pre-built search index: results for earlier chapters appear
 * immediately while later ones are still being searched (see
 * `isSearching`), matching `ReaderController.search`/`BookSearch`'s own
 * incremental-results design.
 */
export const SearchPanel: FC<SearchPanelProps> = ({
  query,
  results,
  isSearching,
  onSearch,
  onSelect,
  open,
  pinned,
  onTogglePin,
  onRequestClose,
  scrubberVisible,
}) => {
  const [input, setInput] = useState(query);
  const chromeTheme = useChromeTheme();
  const navRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const t = useTranslation();

  useEffect(() => {
    const timeout = setTimeout(() => onSearch(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
    // `onSearch` is a stable callback (see `ReaderApp`) — only `input`
    // itself should ever re-arm this debounce timer.
  }, [input]);

  useEffect(() => {
    if (!open || pinned) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pinned, onRequestClose]);

  // See `TocPanel`'s identical effect for why this matters — without
  // it, a keyboard user pressing Tab right after opening this panel (via
  // the toolbar's toggle button) has no guarantee of landing inside it
  // next.
  useFocusOnOpen(navRef, open && !pinned);

  return (
    <>
      {!pinned && (
        <div
          aria-hidden="true"
          onClick={onRequestClose}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 7,
            background: "rgba(15, 23, 42, 0.18)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition: reduceMotion ? "none" : "opacity 260ms ease",
          }}
        />
      )}

      <nav
        ref={navRef}
        tabIndex={-1}
        aria-label={t("search.title")}
        style={{
          position: pinned ? "relative" : "absolute",
          outline: "none",
          // See `TocPanel`'s identical positioning comment: in flyout
          // mode this panel spans the full app row height, which would
          // otherwise put its own header directly underneath the
          // toolbar's identical top:0 row.
          top: pinned ? 0 : 44,
          // Docks/flies out from the *right* edge now (issue #68),
          // mirroring `BookDetailsPanel` rather than `TocPanel`/
          // `AnnotationsPanel` on the left.
          right: 0,
          bottom: scrubberVisible ? SCRUBBER_HEIGHT : pinned ? 0 : 8,
          zIndex: 8,
          width: 300,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: chromeTheme.backgroundSolid,
          backdropFilter: pinned ? undefined : "blur(16px)",
          borderLeft: `1px solid ${CHROME_BORDER}`,
          borderRadius: pinned ? 0 : "12px 0 0 12px",
          boxShadow: pinned ? "none" : CHROME_SHADOW,
          transform: pinned ? "none" : `translateX(${open ? "0" : "100%"})`,
          opacity: pinned || open ? 1 : 0,
          pointerEvents: pinned || open ? "auto" : "none",
          visibility: pinned || open ? "visible" : "hidden",
          transition: reduceMotion
            ? "none"
            : "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease, visibility 280ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "10px 8px 10px 14px",
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Body1 as="span" style={{ flex: 1, fontWeight: 600 }}>
            {t("search.title")}
          </Body1>
          <Tooltip content={pinned ? t("search.unpinSearchPanel") : t("search.pinSearchPanel")} relationship="label">
            <Button
              appearance="subtle"
              size="small"
              icon={pinned ? <PinOffRegular /> : <PinRegular />}
              onClick={onTogglePin}
            />
          </Tooltip>
          {!pinned && (
            <Tooltip content={t("search.closeSearchPanel")} relationship="label">
              <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onRequestClose} />
            </Tooltip>
          )}
        </div>

        <div style={{ padding: "8px 10px 0" }}>
          <SearchBox
            value={input}
            onChange={(_event, data) => setInput(data.value)}
            placeholder={t("search.placeholder")}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {input.trim().length > 0 && input.trim().length < 3 && (
            <Caption1 as="p" style={{ padding: "6px 10px", opacity: 0.6, margin: 0 }}>
              {t("search.minCharacters")}
            </Caption1>
          )}
          {results.map((result, index) => (
            <button
              key={`${result.spineIndex}-${index}`}
              type="button"
              onClick={() => onSelect(result.cfi)}
              style={{
                display: "block",
                width: "100%",
                background: "none",
                border: "none",
                borderRadius: 6,
                color: "var(--colorNeutralForeground2, #333)",
                cursor: "pointer",
                padding: "7px 10px",
                textAlign: "left",
                font: "inherit",
                lineHeight: 1.35,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
              }}
            >
              <Caption1 as="p" block style={{ margin: "0 0 2px", opacity: 0.6 }}>
                {result.chapterLabel}
              </Caption1>
              {/* Trims `before` down to a short prefix right at render
                  time (see `TocPanel`'s former identical comment) so the
                  highlighted match always stays within the visible,
                  single-line-truncated width. */}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                …{result.before.slice(-18)}
                <strong style={{ color: chromeTheme.accentForeground }}>{result.match}</strong>
                {result.after}…
              </span>
            </button>
          ))}
          {isSearching && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px" }}>
              <Spinner size="tiny" />
              <Caption1 as="span" style={{ opacity: 0.6 }}>
                {t("search.searching")}
              </Caption1>
            </div>
          )}
          {!isSearching && input.trim().length >= 3 && results.length === 0 && (
            <Caption1 as="p" style={{ padding: "6px 10px", opacity: 0.6, margin: 0 }}>
              {t("search.noMatchesFound")}
            </Caption1>
          )}
        </div>
      </nav>
    </>
  );
};
