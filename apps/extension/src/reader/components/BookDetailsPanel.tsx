import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Body1Strong, Button, Spinner, Tooltip, useRestoreFocusTarget } from "@fluentui/react-components";
import { CodeCircleRegular, DismissRegular, QuestionCircleRegular } from "@fluentui/react-icons";
import type { BookDetails } from "../ReaderTypes.js";
import { CHROME_BORDER, CHROME_SHADOW, SCRUBBER_HEIGHT } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";
import { useLocale, useTranslation } from "../../i18n/LocaleContext.js";
import { formatLibraryBytes } from "../../library/LibraryFormatting.js";
import { BookDescription, BookDetailRow as DetailRow, BookMetadataText, BookRightsRow } from "../../components/BookMetadataRows.js";
import { PaneDisclosure } from "../../components/PaneSections.js";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";

export interface BookDetailsPanelProps {
  /** Whether the panel should currently be shown at all. Always
   * rendered (never conditionally unmounted) so it can animate closed
   * instead of simply vanishing — see `TocPanel`'s identical pattern on
   * the opposite side of the reader pane. */
  open: boolean;
  onRequestClose: () => void;
  onOutsideClick?: () => void;
  /** `undefined` while `ReaderApp` is still fetching it (the cover image
   * and file name need an async `LibraryDatabase` read the first time —
   * see `ReaderController.getBookDetails`) — shows a spinner instead of
   * an empty panel for that brief gap. */
  details: BookDetails | undefined;
  /** Opens the EPUB Inspector (issue #46) — a separate, author-facing
   * tool (file structure + parsed metadata) reachable only from here,
   * so an ordinary reader never stumbles into it. */
  onOpenInspector: () => void;
  onOpenHelp: (returnFocusTo: HTMLElement) => void;
  /** Whether the progress scrubber is currently shown (paginated
   * reflowable content only — see `ProgressScrubber`'s own identical
   * condition) — this panel needs to stop *above* it rather than
   * running the full pane height, or the scrubber bar ends up covering
   * its last few rows. Mirrors the identical fix `TocPanel`/`SearchPanel`/
   * `AnnotationsPanel` already got for issue #59 — `BookDetailsPanel`
   * predated that fix and was missed, which is what issue #72 caught. */
  scrubberVisible: boolean;
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
  onOutsideClick,
  details,
  onOpenInspector,
  onOpenHelp,
  scrubberVisible,
}) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const chromeTheme = useChromeTheme();
  const asideRef = useRef<HTMLElement | null>(null);
  const restoreInspectorFocus = useRestoreFocusTarget();
  const reduceMotion = usePrefersReducedMotion();

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
        onClick={onOutsideClick ?? onRequestClose}
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
                  <BookMetadataText value={details.title} name={t("inspector.titleLabel")} kind="identity" heading style={{ margin: "0 0 4px" }} />
                  {details.creator && (
                    <BookMetadataText value={details.creator} name={t("inspector.creator")} kind="identity" style={{ opacity: 0.75 }} />
                  )}
                  <DetailRow label={t("bookDetails.publisher")} value={details.publisher} compact />
                </div>
              </div>

              {details.description && (
                <BookDescription value={details.description} sourceName={details.descriptionSourceName} sourceUrl={details.descriptionSourceUrl} />
              )}

              {(knownIdentifiers.length > 0 || details.fileSizeBytes !== undefined || details.rights ||
                details.accessibility.accessibilitySummary || details.accessibility.accessibilityFeatures.length > 0) && (
                <PaneDisclosure title={t("bookDetails.publicationDetails")}>
                  <BookRightsRow label={t("bookDetails.rights")} value={details.rights} />
                  <DetailRow small label={t("bookDetails.accessibilitySummary")} value={details.accessibility.accessibilitySummary} />
                  <DetailRow small label={t("bookDetails.accessibilityFeatures")} value={details.accessibility.accessibilityFeatures.join(", ")} />
                  <DetailRow
                    small
                    label={t("bookDetails.fileSize")}
                    value={details.fileSizeBytes === undefined ? undefined : formatLibraryBytes(details.fileSizeBytes, locale)}
                  />
                  <DetailRow small label={t("bookDetails.isbn")} value={isbn?.value} />
                  {otherIdentifiers.map((id, index) => (
                    <DetailRow small key={index} label={id.scheme ?? t("bookDetails.identifier")} value={id.value} />
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
        <div style={{ flexShrink: 0, padding: "4px 8px", borderTop: `1px solid ${CHROME_BORDER}` }}>
          <Button
            appearance="subtle"
            size="small"
            icon={<QuestionCircleRegular />}
            onClick={(event) => onOpenHelp(event.currentTarget)}
            style={{ width: "100%", minHeight: 32 }}
          >
            {t("about.title")}
          </Button>
        </div>
      </aside>

    </>
  );
};
