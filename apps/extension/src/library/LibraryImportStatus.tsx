import type { FC, RefObject } from "react";
import { Body1, Button, Caption1, Tooltip } from "@fluentui/react-components";
import { ArrowDownloadRegular, CheckmarkCircleRegular, DismissRegular } from "@fluentui/react-icons";
import type { BookImportPhase } from "./BookImporter.js";
import type { BookMetadata } from "./LibraryDatabase.js";
import { CHROME_BORDER, CHROME_SHADOW, CHROME_THEMES } from "../reader/chromeTheme.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import { LibraryImportIllustration } from "./LibraryImportIllustration.js";
import type { LibraryDownloadProgress } from "./LibraryDownload.js";
import { formatLibraryBytes, formatLibraryProgress } from "./LibraryFormatting.js";

export interface LibraryImportActivity {
  readonly id: number;
  readonly fileName: string;
  readonly phase: BookImportPhase | "queued" | "downloading" | "complete";
  readonly bookId?: string;
  readonly download?: LibraryDownloadProgress;
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
  onCancelDownload: (id: number) => boolean;
  focusFallbackRef?: RefObject<HTMLButtonElement | null>;
}> = ({ activities, books, onOpenBook, onDismissCompleted, onCancelDownload, focusFallbackRef }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const busy = activities.some(({ phase }) => phase !== "complete");
  return (
    <div data-testid="library-import-status" style={activities.length ? {
      padding: "14px 18px", margin: "0 auto 16px", borderRadius: 8,
      width: "100%", maxWidth: 600, boxSizing: "border-box",
      background: "var(--colorNeutralBackground1, #fff)",
      border: `1px solid ${CHROME_BORDER}`, boxShadow: CHROME_SHADOW,
    } : undefined}>
      {activities.length > 0 && (
        <div style={{ position: "relative", display: "flex", justifyContent: "center", padding: "0 32px" }}>
          <LibraryImportIllustration busy={busy} />
          {activities.some(({ phase }) => phase === "complete") && (
            <Tooltip content={t("library.dismiss")} relationship="label">
              <Button appearance="subtle" size="small" icon={<DismissRegular />}
                style={{ position: "absolute", insetBlockStart: 0, insetInlineEnd: 0 }}
                aria-label={t("library.dismiss")} onClick={onDismissCompleted} />
            </Tooltip>
          )}
        </div>
      )}
      {/* Keep the live region mounted before import starts. Do not mark it busy:
          assistive technology must announce the intermediate stages too. */}
      <div role="status" aria-live="polite" aria-relevant="additions text">
        {activities.map(({ id, fileName, phase, bookId, download }) => {
          const book = bookId ? books.find((book) => book.id === bookId) : undefined;
          const title = book?.title;
          const fraction = download?.totalBytes ? download.receivedBytes / download.totalBytes : undefined;
          const progressText = download && (download.totalBytes
            ? t("library.downloadProgress", {
              received: formatLibraryBytes(download.receivedBytes, locale),
              total: formatLibraryBytes(download.totalBytes, locale),
              percent: formatLibraryProgress(download.receivedBytes / download.totalBytes, locale),
            })
            : t("library.downloadReceived", { received: formatLibraryBytes(download.receivedBytes, locale) }));
          return (
            <div key={id} style={{
              display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) auto",
              alignItems: "center", columnGap: 12, rowGap: 6, padding: "6px 0",
            }}>
              {phase === "complete"
                ? <CheckmarkCircleRegular aria-hidden="true" style={{ fontSize: 20 }} />
                : <ArrowDownloadRegular aria-hidden="true" style={{ fontSize: 20 }} />}
              <Body1 style={{
                overflowWrap: "anywhere", minWidth: 0, gridColumn: (phase === "complete" && book) || phase === "downloading" ? "2" : "2 / -1",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {t(PHASE_LABELS[phase], { fileName: title || fileName })}
              </Body1>
              {phase === "downloading" && (
                <Button size="small" appearance="secondary" style={{ gridColumn: 3, justifySelf: "end" }}
                  aria-label={t("library.cancelDownloadFile", { fileName })}
                  onClick={(event) => {
                    const hadFocus = event.currentTarget === event.currentTarget.ownerDocument.activeElement;
                    if (onCancelDownload(id) && hadFocus) {
                      // The empty-library import button is revealed by the cancellation render.
                      queueMicrotask(() => focusFallbackRef?.current?.focus());
                    }
                  }}>
                  {t("library.cancelDownload")}
                </Button>
              )}
              {phase === "complete" && book && (
                <Button size="small" appearance="primary" style={{ gridColumn: 3, justifySelf: "end" }}
                  aria-label={t("library.readNowBook", { title: title || fileName })}
                  onClick={() => onOpenBook(book.id)}>
                  {t("library.readNow")}
                </Button>
              )}
              {phase === "downloading" && download && (
                <div aria-live="off" style={{ gridColumn: "2 / -1", minWidth: 0 }}>
                  <div role="progressbar" aria-label={t("library.importDownloading", { fileName })}
                    aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
                    aria-valuetext={progressText}
                    style={{ height: 4, borderRadius: 2, background: "var(--colorNeutralBackground3, #eee)", overflow: "hidden" }}>
                    {fraction !== undefined && (
                      <div style={{ height: "100%", width: `${fraction * 100}%`, background: CHROME_THEMES.ambra.accent }} />
                    )}
                  </div>
                  <Caption1 block style={{ marginTop: 4, overflowWrap: "anywhere" }}>{progressText}</Caption1>
                </div>
              )}
            </div>
          );
        })}
        {busy && <Caption1 as="p" block style={{ margin: "6px 0 0" }}>{t("library.importKeepOpen")}</Caption1>}
      </div>
    </div>
  );
};
