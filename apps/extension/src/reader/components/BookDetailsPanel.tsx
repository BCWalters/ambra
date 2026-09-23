import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FC } from "react";
import { Body1, Body1Strong, Button, Caption1, Spinner, Tooltip, useRestoreFocusTarget } from "@fluentui/react-components";
import { CodeCircleRegular, DismissRegular, DocumentPageNumberRegular, TextPercentRegular } from "@fluentui/react-icons";
import type { BookDetails } from "../ReaderTypes.js";
import { CHROME_BORDER, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useLocale, useTranslation } from "../../i18n/LocaleContext.js";
import { formatLibraryBytes } from "../../library/LibraryFormatting.js";
import { GoToDialog } from "./GoToDialog.js";
import { BookDetailRow as DetailRow, BookRightsRow } from "../../components/BookMetadataRows.js";
import { PaneCard, PaneDisclosure } from "../../components/PaneSections.js";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";

export interface BookDetailsPanelProps {
  /** Whether the panel should currently be shown at all. Always
   * rendered (never conditionally unmounted) so it can animate closed
   * instead of simply vanishing — see `TocPanel`'s identical pattern on
   * the opposite side of the reader pane. */
  open: boolean;
  onRequestClose: () => void;
  /** `undefined` while `ReaderApp` is still fetching it (the cover image
   * and file name need an async `LibraryDatabase` read the first time —
   * see `ReaderController.getBookDetails`) — shows a spinner instead of
   * an empty panel for that brief gap. */
  details: BookDetails | undefined;
  /** Opens the EPUB Inspector (issue #46) — a separate, author-facing
   * tool (file structure + parsed metadata) reachable only from here,
   * so an ordinary reader never stumbles into it. */
  onOpenInspector: () => void;
  /** Whether the progress scrubber is currently shown (paginated
   * reflowable content only — see `ProgressScrubber`'s own identical
   * condition) — this panel needs to stop *above* it rather than
   * running the full pane height, or the scrubber bar ends up covering
   * its last few rows. Mirrors the identical fix `TocPanel`/`SearchPanel`/
   * `AnnotationsPanel` already got for issue #59 — `BookDetailsPanel`
   * predated that fix and was missed, which is what issue #72 caught. */
  scrubberVisible: boolean;
  /** Whether the current view is paginated (vs. continuous scroll) —
   * "Go to Page…" only makes sense in paginated mode, where a book-wide
   * page number actually exists (see `bookPageCount`). Mirrors the old
   * Navigate menu's identical condition, now relocated here (issue
   * follow-up: the toolbar's "Navigate" button was removed for being
   * redundant with the progress scrubber and the Table of Contents). */
  isPaginated: boolean;
  /** True for the current spine item's fixed-layout rendering, which has
   * no book-wide page/percentage position to jump to at all — hides
   * both "Go to" actions entirely, matching the old Navigate menu. */
  isFixedLayout: boolean;
  /** The book's total page count once known — see `GoToDialog`'s own
   * doc comment; `undefined` disables "Go to Page…" until it's ready. */
  bookPageCount: number | undefined;
  onSeekToFraction: (fraction: number) => void;
}

/** `dc:identifier` values some EPUB-generation tools/starter templates
 * leave behind unedited (e.g. a placeholder ID baked into a boilerplate
 * template no one bothered to replace) — meaningless to a reader and
 * actively confusing to show alongside a book's real identifiers (an
 * ISBN, say), so they're filtered out of the list entirely rather than
 * displayed. Matched case-insensitively as a substring, since these tend
 * to appear as one segment of a larger URN/URL rather than the entire
 * identifier value. Grow this list as more generator placeholders turn
 * up in the wild. */
const GENERIC_DEFAULT_IDENTIFIER_SUBSTRINGS = ["_simple_book"];

function isGenericDefaultIdentifier(value: string): boolean {
  const lower = value.toLowerCase();
  return GENERIC_DEFAULT_IDENTIFIER_SUBSTRINGS.some((needle) => lower.includes(needle));
}

/** The "Go to Page…"/"Go to Percentage…" buttons' shared style (issue
 * #75) — filled with the reader's current chrome theme gradient, same
 * as this panel's own background, but with its own visible border and
 * a small drop shadow so it still reads as a distinct, raised button
 * rather than dissolving into the identically-colored panel behind it. */
function goToButtonStyle(themeBackgroundSolid: string): CSSProperties {
  return {
    background: themeBackgroundSolid,
    borderColor: "rgba(15, 23, 42, 0.22)",
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.16)",
  };
}

/**
 * A right-side flyout panel showing whatever metadata is available for
 * the currently-open book — cover, title, author, description,
 * publisher, the original file name, and every `dc:identifier` the OPF
 * declares (labeling one "ISBN" if its `opf:scheme` says so, and
 * silently dropping known placeholder values — see
 * `isGenericDefaultIdentifier`). Deliberately shows only what the EPUB
 * itself provides beyond that; no internet lookup for missing fields (a
 * possible future enhancement, not this one's scope).
 *
 * Also hosts "Go to Page…"/"Go to Percentage…" (via `GoToDialog`) —
 * relocated here from the toolbar's old compass "Navigate" menu, which
 * was removed for being redundant with the progress scrubber (drag-to-
 * seek) and the Table of Contents (chapter jumps); chapter navigation
 * itself is now a standard keyboard shortcut instead (see
 * `AccessibilityController`'s `onNextChapter`/`onPreviousChapter`).
 *
 * Mirrors `TocPanel`'s flyout mechanics (always rendered so it can
 * animate closed, a click-outside backdrop, Escape to dismiss) but on
 * the opposite edge of the reader pane and without a pin-to-dock option
 * — this is reference material to glance at and close, not something a
 * reader keeps open continuously alongside the page the way the TOC's
 * pin mode supports.
 */
export const BookDetailsPanel: FC<BookDetailsPanelProps> = ({
  open,
  onRequestClose,
  details,
  onOpenInspector,
  scrubberVisible,
  isPaginated,
  isFixedLayout,
  bookPageCount,
  onSeekToFraction,
}) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const chromeTheme = useChromeTheme();
  const asideRef = useRef<HTMLElement | null>(null);
  const restoreInspectorFocus = useRestoreFocusTarget();
  const restoreGoToFocus = useRestoreFocusTarget();
  const reduceMotion = usePrefersReducedMotion();
  const [goToDialogMode, setGoToDialogMode] = useState<"page" | "percentage" | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onRequestClose]);

  // See `TocPanel`'s identical effect for why this matters: without it,
  // a keyboard user pressing Tab right after opening this panel (via the
  // toolbar's toggle button) has no guarantee of landing inside it next.
  useFocusOnOpen(asideRef, open);

  const knownIdentifiers = (details?.identifiers ?? []).filter(
    (id) => !isGenericDefaultIdentifier(id.value),
  );
  const isbn = knownIdentifiers.find((id) => id.scheme?.toUpperCase() === "ISBN");
  const otherIdentifiers = knownIdentifiers.filter((id) => id !== isbn);

  return (
    <>
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

      <aside
        ref={asideRef}
        tabIndex={-1}
        aria-label={t("toolbar.bookDetails")}
        style={{
          position: "absolute",
          outline: "none",
          top: CHROME_TOOLBAR_HEIGHT,
          right: 0,
          bottom: scrubberVisible ? SCRUBBER_HEIGHT : 8,
          zIndex: 8,
          width: 360,
          maxWidth: "90%",
          boxSizing: "border-box",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          background: chromeTheme.backgroundSolid,
          backdropFilter: "blur(16px)",
          borderLeft: `1px solid ${CHROME_BORDER}`,
          borderRadius: "12px 0 0 12px",
          boxShadow: CHROME_SHADOW,
          transform: `translateX(${open ? "0" : "100%"})`,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
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
          <Body1Strong as="span" style={{ flex: 1 }}>
            {t("toolbar.bookDetails")}
          </Body1Strong>
          <Tooltip content={t("bookDetails.closePanel")} relationship="label">
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onRequestClose} />
          </Tooltip>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, overflowWrap: "anywhere" }}>
          {!details ? (
            <Spinner label={t("reader.loading")} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
                {details.coverUrl && (
                  <img
                    src={details.coverUrl}
                    alt=""
                    style={{
                      display: "block",
                      width: 84,
                      height: 126,
                      flexShrink: 0,
                      objectFit: "contain",
                      borderRadius: 4,
                      boxShadow: "0 2px 10px rgba(15, 23, 42, 0.18)",
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Sized to match the panel's own "Book details" header
                      above (`Body1Strong`) rather than the larger
                      `Subtitle1` this used to be — a book's title can run
                      long, and at that size it was competing with (rather
                      than deferring to) the cover art for attention.
                      `Body1Strong` (not `Body1` plus an inline
                      `fontWeight`) avoids fighting the CSS `font`
                      shorthand Fluent's own typography presets already
                      set — mixing the two triggers a React dev-mode
                      warning about conflicting style updates. */}
                  <Body1Strong as="h2" block style={{ margin: "0 0 4px" }}>
                    {details.title}
                  </Body1Strong>
                  {details.creator && (
                    <Body1 as="p" block style={{ margin: 0, opacity: 0.75 }}>
                      {details.creator}
                    </Body1>
                  )}
                  {/* Publisher/Copyright moved up here, directly under
                      the author, rather than below the description —
                      both are short, byline-like facts about the book
                      itself, so they read more naturally as part of this
                      identity block than mixed in with the longer-form
                      description/identifiers further down. */}
                  <DetailRow label={t("bookDetails.publisher")} value={details.publisher} compact />
                  <BookRightsRow label={t("bookDetails.copyright")} value={details.rights} />
                </div>
              </div>

              {details.description && (
                <>
                  <Caption1
                    as="p"
                    block
                    style={{ margin: details.descriptionSourceName ? "0 0 4px" : "0 0 16px", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {details.description}
                  </Caption1>
                  {/* Attribution for a fetched fallback description
                      (issue follow-up: books with no dc:description of
                      their own) — required by both free sources' terms,
                      and a useful "read more" link either way. */}
                  {details.descriptionSourceName && (
                    <Caption1 as="p" block style={{ margin: "0 0 16px", opacity: 0.75 }}>
                      {t("bookDetails.descriptionSourcePrefix")}{" "}
                      <a href={details.descriptionSourceUrl} target="_blank" rel="noreferrer">
                        {details.descriptionSourceName}
                      </a>
                    </Caption1>
                  )}
                </>
              )}

              <DetailRow
                label={t("bookDetails.accessibilitySummary")}
                value={details.accessibility.accessibilitySummary}
              />
              <DetailRow
                label={t("bookDetails.accessibilityFeatures")}
                value={
                  details.accessibility.accessibilityFeatures.length > 0
                    ? details.accessibility.accessibilityFeatures.join(", ")
                    : undefined
                }
              />

              {/* "Go to Page…"/"Go to Percentage…" — relocated from the
                  toolbar's old Navigate menu (see this component's doc
                  comment). Hidden entirely for fixed-layout content,
                  which has no book-wide page/percentage position; "Go to
                  Page" is further limited to paginated mode, where a
                  page number actually means something (continuous
                  scroll has no discrete pages to land on).
                  
                  Styled with the reader's own *current* chrome theme
                  (issue #75) — the same gradient the toolbar/scrubber/
                  this very panel already wear — rather than a plain,
                  theme-agnostic gray "secondary" button, so these two
                  actions read as native to whichever accent color the
                  reader has picked instead of looking pasted-in from a
                  generic component library. A visible border/shadow on
                  top of that gradient (rather than the gradient alone)
                  keeps the button legible as a *button* even when the
                  surrounding panel happens to share the exact same
                  background — which it always does, since both draw
                  from the same `chromeTheme.backgroundSolid`. */}
              {!isFixedLayout && (
                <div style={{ marginTop: 20 }}>
                  <PaneCard title={t("bookDetails.readingTools")}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {isPaginated && (
                        <Button
                          appearance="secondary"
                          size="small"
                          icon={<DocumentPageNumberRegular style={{ color: chromeTheme.accent }} />}
                          {...restoreGoToFocus}
                          onClick={() => setGoToDialogMode("page")}
                          style={goToButtonStyle(chromeTheme.backgroundSolid)}
                        >
                          {t("bookDetails.goToPage")}
                        </Button>
                      )}
                      <Button
                        appearance="secondary"
                        size="small"
                        icon={<TextPercentRegular style={{ color: chromeTheme.accent }} />}
                        {...restoreGoToFocus}
                        onClick={() => setGoToDialogMode("percentage")}
                        style={goToButtonStyle(chromeTheme.backgroundSolid)}
                      >
                        {t("bookDetails.goToPercentage")}
                      </Button>
                    </div>
                  </PaneCard>
                </div>
              )}

              {(knownIdentifiers.length > 0 || details.fileSizeBytes !== undefined) && (
                <PaneDisclosure title={t("bookDetails.publicationDetails")}>
                  <DetailRow
                    label={t("bookDetails.fileSize")}
                    value={details.fileSizeBytes === undefined ? undefined : formatLibraryBytes(details.fileSizeBytes, locale)}
                  />
                  <DetailRow label={t("bookDetails.isbn")} value={isbn?.value} />
                  {otherIdentifiers.map((id, index) => (
                    <DetailRow key={index} label={id.scheme ?? t("bookDetails.identifier")} value={id.value} />
                  ))}
                </PaneDisclosure>
              )}

              {/* An EPUB-author-facing tool, deliberately tucked away
                  down here rather than given its own toolbar button —
                  see `EpubInspectorPanel`'s doc comment. The file name
                  (issue follow-up) now lives there too, alongside the
                  rest of the book's raw metadata, rather than cluttering
                  this reader-facing summary.

                  Given a deliberately distinct, "developer tool" look
                  (issue #76) — a dark, code-editor-like background and
                  monospaced label, a genuinely different visual register
                  from every other (light, Fluent-neutral) control in
                  this panel — so it reads as the power-user/debugging
                  escape hatch it actually is, not just one more ordinary
                  button in the list. */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
                <Button
                  appearance="secondary"
                  icon={<CodeCircleRegular />}
                  {...restoreInspectorFocus}
                  onClick={onOpenInspector}
                  style={{
                    background: "linear-gradient(135deg, #1e1e2e, #2a2a42)",
                    borderColor: "rgba(126, 232, 250, 0.35)",
                    color: "#7ee8fa",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                  }}
                >
                  {t("bookDetails.epubInspector")}
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>

      {goToDialogMode && (
        <GoToDialog
          mode={goToDialogMode}
          open={goToDialogMode !== undefined}
          onOpenChange={(dialogOpen) => {
            if (!dialogOpen) {
              setGoToDialogMode(undefined);
            }
          }}
          bookPageCount={bookPageCount}
          onGo={onSeekToFraction}
        />
      )}
    </>
  );
};
