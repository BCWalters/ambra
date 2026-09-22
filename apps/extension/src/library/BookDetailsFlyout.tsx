import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Body1, Body1Strong, Button, Caption1, Tooltip } from "@fluentui/react-components";
import { CodeCircleRegular, DismissRegular } from "@fluentui/react-icons";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";

/** `dc:identifier` values some EPUB-generation tools/starter templates
 * leave behind unedited — meaningless to a reader, so filtered out of
 * the identifiers list. Mirrors `BookDetailsPanel`'s identical filter
 * in the reader (issue #105 asked for the "same informational layout"
 * as that panel). */
const GENERIC_DEFAULT_IDENTIFIER_SUBSTRINGS = ["_simple_book"];

function isGenericDefaultIdentifier(value: string): boolean {
  const lower = value.toLowerCase();
  return GENERIC_DEFAULT_IDENTIFIER_SUBSTRINGS.some((needle) => lower.includes(needle));
}

const DetailRow: FC<{ label: string; value: string | undefined; compact?: boolean }> = ({
  label,
  value,
  compact,
}) => {
  if (!value) {
    return null;
  }
  return (
    <div style={{ marginBottom: compact ? 4 : 10, marginTop: compact ? 6 : 0 }}>
      <Caption1 as="p" block style={{ margin: 0, opacity: 0.6 }}>
        {label}
      </Caption1>
      <Body1 as="p" block style={{ margin: 0 }}>
        {value}
      </Body1>
    </div>
  );
};

export interface BookDetailsFlyoutProps {
  /** `undefined` closes the flyout — a single optional prop rather than
   * a separate `open` boolean plus `book`, since there's never a
   * meaningful "closed, but still showing some particular book" state
   * to keep the two in sync for. */
  book: LibraryBookViewModel | undefined;
  onRequestClose: () => void;
  accent: string;
  backgroundSolid: string;
  /** Opens the EPUB Inspector (issue #111) directly from this book's
   * stored bytes, no live reading session required. `undefined` hides
   * the button entirely — only offered when the Library is open in its
   * own full browser tab (`isFullTab`), matching how the reader itself
   * tucks this author-facing tool away from ordinary use. */
  onOpenInspector: (() => void) | undefined;
}

/**
 * A read-only "Book details" flyout for the Library page (issue #105) —
 * shares its informational layout (cover, title, author, publisher,
 * description, identifiers, accessibility metadata) with the reader's
 * `BookDetailsPanel`, but omits that panel's "Go to Page…"/"Go to
 * Percentage…" actions, which only make sense once a book is actually
 * open. The EPUB Inspector button (issue #111) is included, gated behind
 * `onOpenInspector` being defined — the Library only opens a standalone
 * inspection session when running in its own full browser tab.
 */
export const BookDetailsFlyout: FC<BookDetailsFlyoutProps> = ({
  book,
  onRequestClose,
  accent,
  backgroundSolid,
  onOpenInspector,
}) => {
  const open = book !== undefined;
  const asideRef = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (open) {
      asideRef.current?.focus();
    }
  }, [open]);

  const knownIdentifiers = (book?.identifiers ?? []).filter((id) => !isGenericDefaultIdentifier(id.value));
  const isbn = knownIdentifiers.find((id) => id.scheme?.toUpperCase() === "ISBN");
  const otherIdentifiers = knownIdentifiers.filter((id) => id !== isbn);
  const description = book?.description ?? book?.fetchedDescription;
  const descriptionSourceName = book?.description ? undefined : book?.fetchedDescriptionSourceName;
  const descriptionSourceUrl = book?.description ? undefined : book?.fetchedDescriptionSourceUrl;
  const progressPercent =
    book?.progressFraction !== undefined ? Math.round(book.progressFraction * 100) : undefined;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onRequestClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 30,
          background: "rgba(15, 23, 42, 0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 260ms ease",
        }}
      />
      <aside
        ref={asideRef}
        tabIndex={-1}
        aria-label="Book details"
        style={{
          position: "fixed",
          outline: "none",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 31,
          width: 360,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          background: backgroundSolid,
          backdropFilter: "blur(16px)",
          borderLeft: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
          transform: `translateX(${open ? "0" : "100%"})`,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition: "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease, visibility 280ms",
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
            Book details
          </Body1Strong>
          <Tooltip content="Close" relationship="label">
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onRequestClose} />
          </Tooltip>
        </div>

        {book && (
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
              {book.coverUrl && (
                <img
                  src={book.coverUrl}
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
                <Body1Strong as="h2" block style={{ margin: "0 0 4px" }}>
                  {book.title}
                </Body1Strong>
                {book.creator && (
                  <Body1 as="p" block style={{ margin: 0, opacity: 0.75 }}>
                    {book.creator}
                  </Body1>
                )}
                <DetailRow label="Publisher" value={book.publisher} compact />
                <DetailRow label="Copyright" value={book.rights} compact />
              </div>
            </div>

            {progressPercent !== undefined && (
              <div style={{ marginBottom: 10 }}>
                <Caption1 as="p" block style={{ margin: 0, opacity: 0.6 }}>
                  Progress
                </Caption1>
                <div
                  style={{
                    marginTop: 4,
                    height: 4,
                    borderRadius: 2,
                    background: "rgba(0, 0, 0, 0.12)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ width: `${progressPercent}%`, height: "100%", background: accent }} />
                </div>
                <Body1 as="p" block style={{ margin: "4px 0 0" }}>
                  {progressPercent}% read
                </Body1>
              </div>
            )}

            {description && (
              <>
                <Caption1
                  as="p"
                  block
                  style={{ margin: descriptionSourceName ? "0 0 4px" : "0 0 16px", whiteSpace: "pre-wrap" }}
                >
                  {description}
                </Caption1>
                {descriptionSourceName && (
                  <Caption1 as="p" block style={{ margin: "0 0 16px", opacity: 0.6 }}>
                    via{" "}
                    <a href={descriptionSourceUrl} target="_blank" rel="noreferrer">
                      {descriptionSourceName}
                    </a>
                  </Caption1>
                )}
              </>
            )}

            <DetailRow label="ISBN" value={isbn?.value} />
            {otherIdentifiers.map((id, index) => (
              <DetailRow key={index} label={id.scheme ?? "Identifier"} value={id.value} />
            ))}

            <DetailRow
              label="Accessibility summary"
              value={book.accessibility?.accessibilitySummary}
            />
            <DetailRow
              label="Accessibility features"
              value={
                book.accessibility && book.accessibility.accessibilityFeatures.length > 0
                  ? book.accessibility.accessibilityFeatures.join(", ")
                  : undefined
              }
            />
            <DetailRow label="File name" value={book.fileName} />
            <DetailRow label="Added" value={new Date(book.addedAt).toLocaleDateString()} />

            {onOpenInspector && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
                <Button
                  appearance="secondary"
                  icon={<CodeCircleRegular />}
                  onClick={onOpenInspector}
                  style={{
                    background: "linear-gradient(135deg, #1e1e2e, #2a2a42)",
                    borderColor: "rgba(126, 232, 250, 0.35)",
                    color: "#7ee8fa",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                  }}
                >
                  EPUB Inspector
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
};
