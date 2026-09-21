import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1 } from "@fluentui/react-components";
import { DismissRegular, HomeRegular, PinOffRegular, PinRegular } from "@fluentui/react-icons";
import { NavPoint } from "@ambra/engine";
import { CHROME_BORDER, CHROME_HOVER_BACKGROUND, CHROME_SELECTED_BACKGROUND, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useTranslation } from "../../i18n/LocaleContext.js";

/** Depth-first search for the first *linked* entry in a TOC tree (in
 * document order) — used to detect whether the TOC's own first entry
 * already points at the very start of the book, or skips ahead of some
 * front matter (a cover, title page, copyright page, etc.) that the
 * navigation document simply never lists — see `TocPanel`'s "Start of
 * Book" synthetic entry. */
function findFirstLinkedPath(items: readonly NavPoint[]): string | undefined {
  for (const item of items) {
    if (item.isLinked) {
      return item.path;
    }
    const found = findFirstLinkedPath(item.children);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

interface NavTreeProps {
  items: readonly NavPoint[];
  currentPath: string | undefined;
  onSelect: (navPoint: NavPoint) => void;
  depth: number;
  /** Book-wide page number of each entry's target spine item, keyed by
   * path — see `ReaderSnapshot.tocPageNumbers`. */
  pageNumbers: ReadonlyMap<string, number>;
  /** The active chrome theme's own accent color (issue #86's follow-up
   * — see this prop's use below) — always rendered as a left border,
   * transparent when an entry isn't the current chapter, so selecting
   * an entry never shifts its own text by however wide the border is. */
  accent: string;
}

const NavTree: FC<NavTreeProps> = ({ items, currentPath, onSelect, depth, pageNumbers, accent }) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((item, index) => {
        const isCurrent = item.isLinked && item.path === currentPath;
        const pageNumber = item.path !== undefined ? pageNumbers.get(item.path) : undefined;
        return (
          <li key={index}>
            {item.isLinked ? (
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-current={isCurrent ? "location" : undefined}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 8,
                  width: "100%",
                  background: isCurrent ? CHROME_SELECTED_BACKGROUND : "none",
                  border: "none",
                  borderLeft: `3px solid ${isCurrent ? accent : "transparent"}`,
                  borderRadius: 6,
                  color: isCurrent ? "var(--colorNeutralForeground1, #1a1a1a)" : "var(--colorNeutralForeground2, #333)",
                  fontWeight: isCurrent ? 600 : 400,
                  cursor: "pointer",
                  padding: "7px 10px",
                  paddingLeft: 10 + depth * 16,
                  textAlign: "left",
                  font: "inherit",
                  lineHeight: 1.35,
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = "none";
                  }
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.label}
                </span>
                {pageNumber !== undefined && (
                  <Caption1 as="span" style={{ flexShrink: 0, opacity: 0.6, fontWeight: 400 }}>
                    {pageNumber}
                  </Caption1>
                )}
              </button>
            ) : (
              <Caption1
                as="span"
                style={{
                  display: "block",
                  padding: "7px 10px",
                  paddingLeft: 10 + depth * 16,
                  color: "var(--colorNeutralForeground3, #666)",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                }}
              >
                {item.label}
              </Caption1>
            )}
            <NavTree
              items={item.children}
              currentPath={currentPath}
              onSelect={onSelect}
              depth={depth + 1}
              pageNumbers={pageNumbers}
              accent={accent}
            />
          </li>
        );
      })}
    </ul>
  );
};

export interface TocPanelProps {
  items: readonly NavPoint[];
  /** Archive-relative path of the currently-open spine item (see
   * `ReaderSnapshot.currentSpinePath`) — highlights whichever entry
   * points at it. */
  currentPath: string | undefined;
  /** Archive-relative path of the book's very first spine item (see
   * `ReaderSnapshot.firstSpinePath`) — compared against the TOC's own
   * first linked entry to decide whether to show a synthetic "Start of
   * Book" entry above it (see the component doc comment). */
  firstSpinePath: string | undefined;
  /** Book-wide page number of each entry's target spine item, keyed by
   * path (see `ReaderSnapshot.tocPageNumbers`) — shown right-justified
   * alongside each entry's label, whenever it's known. */
  pageNumbers: ReadonlyMap<string, number>;
  onSelect: (navPoint: NavPoint) => void;
  /** Whether the panel should currently be shown at all. Always rendered
   * (never conditionally unmounted) so it can animate closed instead of
   * simply vanishing — see the `transform`/`opacity` transition below. */
  open: boolean;
  /** `true` docks the panel in the normal layout flow, pushing the
   * content pane over (like the very first version of this panel);
   * `false` (the default) makes it fly out as a translucent overlay on
   * top of the content pane instead, auto-dismissing on selection, an
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

/** The reader's Table of Contents: by default a flyout that slides in
 * over the content pane and dismisses itself once its job is done
 * (selecting a chapter, clicking outside it, or pressing Escape) — the
 * "reference material," not a permanent part of the reading layout. A
 * reader who wants it to stay put can pin it via the header's pin
 * button, which switches it to a normal, in-flow docked panel (resizing
 * the content pane instead of overlaying it) and disables the
 * auto-dismiss behaviors.
 *
 * The entry matching `currentPath` is highlighted, so the reader always
 * has a sense of "where am I" when they open it.
 *
 * Shows a synthetic "Start of Book" entry above the book's own TOC
 * whenever the TOC's first linked entry doesn't point at the very first
 * spine item — real books commonly leave a cover, title page, or
 * copyright page out of their navigation entirely, which would
 * otherwise leave no way to get back to the literal beginning of the
 * book once you've navigated away from it.
 *
 * Scoped to the book's own authored structure (its table of contents)
 * only — full-text search now lives in its own `SearchPanel` (issue
 * #55: previously a second tab bolted onto this panel), and bookmarks/
 * highlights/annotations, which the *reader* creates while reading
 * rather than the book's author, live in their own separate
 * `AnnotationsPanel`. Each gets its own toolbar button, per explicit
 * product direction. */
export const TocPanel: FC<TocPanelProps> = ({
  items,
  currentPath,
  firstSpinePath,
  pageNumbers,
  onSelect,
  open,
  pinned,
  onTogglePin,
  onRequestClose,
  scrubberVisible,
}) => {
  const chromeTheme = useChromeTheme();
  const navRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const t = useTranslation();

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

  // Moves focus into the panel the moment it opens as a flyout (not
  // pinned — a pinned panel is a permanent docked fixture, not something
  // that "just opened"). Without this, a keyboard user pressing Tab
  // right after opening it (with the toolbar's toggle button) would tab
  // straight past the panel entirely: this panel is rendered *earlier*
  // in the DOM than the toolbar that opens it (it visually sits to the
  // left of the content pane, which is where the toolbar itself lives),
  // so the natural tab order after the toggle button skips right over
  // it — only Shift+Tab happened to land here by accident. Focusing the
  // `<nav>` itself (via `tabIndex={-1}`, see below) rather than a
  // specific descendant keeps this robust across which tab happens to be
  // active. See `useFocusOnOpen` for why this isn't just a plain
  // `.focus()` call in a `useEffect`.
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
        aria-label={t("toc.tableOfContents")}
        style={{
          position: pinned ? "relative" : "absolute",
          outline: "none",
          // In flyout (unpinned) mode the panel spans the full app row
          // width, which would otherwise put its own header (Contents/
          // pin/close) directly underneath the toolbar's identical top:0
          // row and out of view — starting it below the toolbar's height
          // instead keeps both fully visible and clickable at once. The
          // toolbar itself never needs this treatment: it lives inside
          // the content pane, which already starts to the right of a
          // *pinned* panel's reserved width, so the two never overlap
          // there in the first place.
          top: pinned ? 0 : 44,
          left: 0,
          bottom: scrubberVisible ? SCRUBBER_HEIGHT : pinned ? 0 : 8,
          zIndex: 8,
          width: 300,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: chromeTheme.backgroundSolid,
          backdropFilter: pinned ? undefined : "blur(16px)",
          borderRight: `1px solid ${CHROME_BORDER}`,
          borderRadius: pinned ? 0 : "0 12px 12px 0",
          boxShadow: pinned ? "none" : CHROME_SHADOW,
          transform: pinned ? "none" : `translateX(${open ? "0" : "-100%"})`,
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
            {t("toc.contents")}
          </Body1>
          <Button
            appearance="subtle"
            size="small"
            icon={pinned ? <PinOffRegular /> : <PinRegular />}
            aria-label={pinned ? t("toc.unpinContentsPanel") : t("toc.pinContentsPanel")}
            title={pinned ? t("toc.unpin") : t("toc.pinOpen")}
            onClick={onTogglePin}
          />
          {!pinned && (
            <Button
              appearance="subtle"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("toc.closeContentsPanel")}
              onClick={onRequestClose}
            />
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
          {firstSpinePath !== undefined && findFirstLinkedPath(items) !== firstSpinePath && (
            <button
              type="button"
              onClick={() => onSelect(new NavPoint(t("toc.startOfBook"), firstSpinePath, undefined, []))}
              aria-current={currentPath === firstSpinePath ? "location" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                width: "100%",
                background: currentPath === firstSpinePath ? CHROME_SELECTED_BACKGROUND : "none",
                border: "none",
                borderLeft: `3px solid ${currentPath === firstSpinePath ? chromeTheme.accent : "transparent"}`,
                borderRadius: 6,
                color:
                  currentPath === firstSpinePath
                    ? "var(--colorNeutralForeground1, #1a1a1a)"
                    : "var(--colorNeutralForeground2, #333)",
                fontWeight: currentPath === firstSpinePath ? 600 : 400,
                cursor: "pointer",
                padding: "7px 10px",
                marginBottom: 4,
                textAlign: "left",
                font: "inherit",
                lineHeight: 1.35,
              }}
              onMouseEnter={(e) => {
                if (currentPath !== firstSpinePath) {
                  e.currentTarget.style.background = CHROME_HOVER_BACKGROUND;
                }
              }}
              onMouseLeave={(e) => {
                if (currentPath !== firstSpinePath) {
                  e.currentTarget.style.background = "none";
                }
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <HomeRegular fontSize={16} />
                {t("toc.startOfBook")}
              </span>
              {pageNumbers.get(firstSpinePath) !== undefined && (
                <Caption1 as="span" style={{ flexShrink: 0, opacity: 0.6, fontWeight: 400 }}>
                  {pageNumbers.get(firstSpinePath)}
                </Caption1>
              )}
            </button>
          )}
          <NavTree
            items={items}
            currentPath={currentPath}
            onSelect={onSelect}
            depth={0}
            pageNumbers={pageNumbers}
            accent={chromeTheme.accent}
          />
        </div>
      </nav>
    </>
  );
};
