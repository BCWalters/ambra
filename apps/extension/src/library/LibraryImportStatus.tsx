import type { FC } from "react";
import { Body1, Button, Caption1, Spinner } from "@fluentui/react-components";
import { CheckmarkCircleRegular } from "@fluentui/react-icons";
import type { BookImportPhase } from "./BookImporter.js";
import type { BookMetadata } from "./LibraryDatabase.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import type { StringCatalog } from "../i18n/locales/en.js";

export interface LibraryImportActivity {
  readonly id: number;
  readonly fileName: string;
  readonly phase: BookImportPhase | "queued" | "downloading" | "complete";
  readonly bookId?: string;
}

const PHASE_LABELS: Record<LibraryImportActivity["phase"], keyof StringCatalog> = {
  queued: "library.importQueued",
  downloading: "library.importDownloading",
  processing: "library.importProcessing",
  saving: "library.importSaving",
  complete: "library.importComplete",
};

export const LibraryImportStatus: FC<{
  activities: readonly LibraryImportActivity[];
  books: readonly Pick<BookMetadata, "id" | "title">[];
  onOpenBook: (id: string) => void;
  onDismissCompleted: () => void;
}> = ({ activities, books, onOpenBook, onDismissCompleted }) => {
  const t = useTranslation();
  const busy = activities.some(({ phase }) => phase !== "complete");
  return (
    <div style={activities.length ? {
      padding: "14px 18px", marginBottom: 16, borderRadius: 8,
      background: "var(--colorNeutralBackground1, #fff)",
      border: `1px solid ${CHROME_BORDER}`, boxShadow: CHROME_SHADOW,
    } : undefined}>
      {/* Keep the live region mounted before import starts. Do not mark it busy:
          assistive technology must announce the intermediate stages too. */}
      <div role="status" aria-live="polite" aria-relevant="additions text">
        {activities.map(({ id, fileName, phase, bookId }) => {
          const book = bookId ? books.find((book) => book.id === bookId) : undefined;
          const title = book?.title;
          return (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
              {phase === "complete"
                ? <CheckmarkCircleRegular aria-hidden="true" style={{ flexShrink: 0, fontSize: 20 }} />
                : <Spinner size="tiny" role="presentation" aria-hidden="true" />}
              <Body1 style={{
                overflowWrap: "anywhere", minWidth: 0, flex: 1,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {t(PHASE_LABELS[phase], { fileName: title || fileName })}
              </Body1>
              {phase === "complete" && book && (
                <Button size="small" appearance="primary" style={{ flexShrink: 0 }}
                  aria-label={t("library.readNowBook", { title: title || fileName })}
                  onClick={() => onOpenBook(book.id)}>
                  {t("library.readNow")}
                </Button>
              )}
            </div>
          );
        })}
        {busy && <Caption1 as="p" block style={{ margin: "6px 0 0" }}>{t("library.importKeepOpen")}</Caption1>}
      </div>
      {activities.some(({ phase }) => phase === "complete") && (
        <Button appearance="subtle" size="small" onClick={onDismissCompleted}>
          {t("library.dismiss")}
        </Button>
      )}
    </div>
  );
};
