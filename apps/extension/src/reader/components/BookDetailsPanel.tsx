import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1, Spinner, Subtitle1 } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { BookDetails } from "../ReaderController.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useFocusOnOpen } from "../useFocusOnOpen.js";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion.js";

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
}

/** A single label/value row in the details list — skipped entirely
 * (renders nothing) when `value` is `undefined`, so a book missing some
 * piece of metadata (most books have no `dc:publisher`, for instance)
 * doesn't leave a blank, awkward-looking row. */
const DetailRow: FC<{ label: string; value: string | undefined }> = ({ label, value }) => {
  if (!value) {
    return null;
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <Caption1 as="p" block style={{ margin: 0, opacity: 0.6 }}>
        {label}
      </Caption1>
      <Body1 as="p" block style={{ margin: 0 }}>
        {value}
      </Body1>
    </div>
  );
};

/**
 * A right-side flyout panel showing whatever metadata is available for
 * the currently-open book — cover, title, author, description,
 * publisher, language, the original file name, and every `dc:identifier`
 * the OPF declares (labeling one "ISBN" if its `opf:scheme` says so).
 * Deliberately shows only what the EPUB itself provides; no internet
 * lookup for missing fields (a possible future enhancement, not this
 * one's scope).
 *
 * Mirrors `TocPanel`'s flyout mechanics (always rendered so it can
 * animate closed, a click-outside backdrop, Escape to dismiss) but on
 * the opposite edge of the reader pane and without a pin-to-dock option
 * — this is reference material to glance at and close, not something a
 * reader keeps open continuously alongside the page the way the TOC's
 * pin mode supports.
 */
export const BookDetailsPanel: FC<BookDetailsPanelProps> = ({ open, onRequestClose, details, onOpenInspector }) => {
  const chromeTheme = useChromeTheme();
  const asideRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
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

  const isbn = details?.identifiers.find((id) => id.scheme?.toUpperCase() === "ISBN");
  const otherIdentifiers = details?.identifiers.filter((id) => id !== isbn) ?? [];

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
        aria-label="Book details"
        style={{
          position: "absolute",
          outline: "none",
          top: 44,
          right: 0,
          bottom: 8,
          zIndex: 8,
          width: 340,
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
          <Body1 as="span" style={{ flex: 1, fontWeight: 600 }}>
            Book Details
          </Body1>
          <Button
            appearance="subtle"
            size="small"
            icon={<DismissRegular />}
            aria-label="Close book details panel"
            onClick={onRequestClose}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          {!details ? (
            <Spinner label="Loading…" />
          ) : (
            <>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
                {details.coverUrl && (
                  <img
                    src={details.coverUrl}
                    alt=""
                    style={{
                      display: "block",
                      width: 84,
                      height: 126,
                      flexShrink: 0,
                      objectFit: "cover",
                      borderRadius: 4,
                      boxShadow: "0 2px 10px rgba(15, 23, 42, 0.18)",
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Subtitle1 as="h2" block style={{ margin: "0 0 4px" }}>
                    {details.title}
                  </Subtitle1>
                  {details.creator && (
                    <Body1 as="p" block style={{ margin: 0, opacity: 0.75 }}>
                      {details.creator}
                    </Body1>
                  )}
                </div>
              </div>

              {details.description && (
                <>
                  <Body1
                    as="p"
                    block
                    style={{ margin: details.descriptionSourceName ? "0 0 4px" : "0 0 16px", whiteSpace: "pre-wrap" }}
                  >
                    {details.description}
                  </Body1>
                  {/* Attribution for a fetched fallback description
                      (issue follow-up: books with no dc:description of
                      their own) — required by both free sources' terms,
                      and a useful "read more" link either way. */}
                  {details.descriptionSourceName && (
                    <Caption1 as="p" block style={{ margin: "0 0 16px", opacity: 0.6 }}>
                      via{" "}
                      <a href={details.descriptionSourceUrl} target="_blank" rel="noreferrer">
                        {details.descriptionSourceName}
                      </a>
                    </Caption1>
                  )}
                </>
              )}

              <DetailRow label="Publisher" value={details.publisher} />
              <DetailRow label="Language" value={details.language} />
              <DetailRow label="Copyright" value={details.rights} />
              <DetailRow label="ISBN" value={isbn?.value} />
              {otherIdentifiers.map((id, index) => (
                <DetailRow key={index} label={id.scheme ?? "Identifier"} value={id.value} />
              ))}

              {/* An EPUB-author-facing tool, deliberately tucked away
                  down here rather than given its own toolbar button —
                  see `EpubInspectorPanel`'s doc comment. The file name
                  (issue follow-up) now lives there too, alongside the
                  rest of the book's raw metadata, rather than cluttering
                  this reader-facing summary. */}
              <Button appearance="secondary" style={{ marginTop: 8 }} onClick={onOpenInspector}>
                EPUB Inspector
              </Button>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
