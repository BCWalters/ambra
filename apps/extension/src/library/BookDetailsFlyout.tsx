import type { FC } from "react";
import { Body1, Button, useRestoreFocusTarget } from "@fluentui/react-components";
import { CodeCircleRegular } from "@fluentui/react-icons";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { LibraryFlyout } from "./LibraryFlyout.js";
import { LibraryImportError } from "./LibraryImportError.js";
import { BookDescription, BookDetailRow as DetailRow, BookMetadataText, BookRightsRow } from "../components/BookMetadataRows.js";
import { PaneCard, PaneDisclosure } from "../components/PaneSections.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import { formatLibraryProgress } from "./LibraryFormatting.js";

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
  inspectionError?: { message: string; onDismiss: () => void } | undefined;
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
  inspectionError,
}) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const open = book !== undefined;
  const restoreInspectorFocus = useRestoreFocusTarget();

  const knownIdentifiers = (book?.identifiers ?? []).filter(
    (id) => !isGenericDefaultIdentifier(id.value),
  );
  const isbn = knownIdentifiers.find((id) => id.scheme?.toUpperCase() === "ISBN");
  const otherIdentifiers = knownIdentifiers.filter((id) => id !== isbn);
  const description = book?.description ?? book?.fetchedDescription;
  const descriptionSourceName = book?.description ? undefined : book?.fetchedDescriptionSourceName;
  const descriptionSourceUrl = book?.description ? undefined : book?.fetchedDescriptionSourceUrl;
  const progressPercent =
    book?.progressFraction !== undefined ? Math.round(book.progressFraction * 100) : undefined;

  return (
    <LibraryFlyout
      open={open}
      title={t("toolbar.bookDetails")}
      onRequestClose={onRequestClose}
      backgroundSolid={backgroundSolid}
    >
      {book && (
        <div style={{ flex: 1, overflowY: "auto", padding: 20, overflowWrap: "anywhere" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
            {book.coverUrl && (
              <img
                src={book.coverUrl}
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
              <BookMetadataText value={book.title} name={t("inspector.titleLabel")} kind="identity" heading style={{ margin: "0 0 4px" }} />
              {book.creator && (
                <BookMetadataText value={book.creator} name={t("inspector.creator")} kind="identity" style={{ opacity: 0.75 }} />
              )}
              <DetailRow label={t("bookDetails.publisher")} value={book.publisher} compact />
            </div>
          </div>

          {progressPercent !== undefined && (
            <div style={{ marginBottom: 20 }}>
              <PaneCard title={t("library.progress")}>
                <div
                  role="progressbar"
                  aria-label={t("library.readingProgress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: "rgba(0, 0, 0, 0.12)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ width: `${progressPercent}%`, height: "100%", background: accent }} />
                </div>
                <Body1 as="p" block style={{ margin: "4px 0 0" }}>
                  {t("library.percentRead", { progress: formatLibraryProgress(progressPercent / 100, locale) })}
                </Body1>
              </PaneCard>
            </div>
          )}

          {description && (
            <BookDescription value={description} sourceName={descriptionSourceName} sourceUrl={descriptionSourceUrl} />
          )}

          <PaneDisclosure title={t("bookDetails.publicationDetails")}>
            <BookRightsRow label={t("bookDetails.rights")} value={book.rights} />
            <DetailRow small label={t("bookDetails.accessibilitySummary")} value={book.accessibility?.accessibilitySummary} />
            <DetailRow small label={t("bookDetails.accessibilityFeatures")} value={book.accessibility?.accessibilityFeatures.join(", ")} />
            <DetailRow small label={t("bookDetails.isbn")} value={isbn?.value} />
            {otherIdentifiers.map((id, index) => (
              <DetailRow small key={index} label={id.scheme ?? t("bookDetails.identifier")} value={id.value} />
            ))}
            <DetailRow small label={t("inspector.fileName")} value={book.fileName} />
            <DetailRow small label={t("library.added")} value={new Date(book.addedAt).toLocaleDateString(locale)} />
          </PaneDisclosure>

          {inspectionError && <LibraryImportError {...inspectionError} />}
          {onOpenInspector && (
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
          )}
        </div>
      )}
    </LibraryFlyout>
  );
};
