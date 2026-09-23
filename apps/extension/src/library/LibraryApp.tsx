import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FC } from "react";
import {
  Body1,
  Button,
  Menu,
  MenuGroup,
  MenuGroupHeader,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Title2,
  Tooltip,
  makeStyles,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  ArrowSortRegular,
  DocumentAddRegular,
  DeleteRegular,
  InfoRegular,
  StorageRegular,
  WindowNewRegular,
} from "@fluentui/react-icons";
import { useLibrary } from "./useLibrary.js";
import type { LibraryBookViewModel } from "./useLibrary.js";
import { useLibraryInspector } from "./useLibraryInspector.js";
import type { LibrarySortOption } from "./LibrarySortOption.js";
import { BookDetailsFlyout } from "./BookDetailsFlyout.js";
import { LibraryImportError } from "./LibraryImportError.js";
import { LibraryImportStatus } from "./LibraryImportStatus.js";
import { LibraryEmptyState } from "./LibraryEmptyState.js";
import { LibraryDiscovery } from "./LibraryDiscovery.js";
import { CHROME_BORDER, CHROME_SHADOW, CHROME_THEMES } from "../reader/chromeTheme.js";
import { ChromeThemeProvider } from "../reader/ChromeThemeContext.js";
import { EpubInspectorPanel } from "../reader/components/EpubInspectorPanel.js";
import { AboutFlyout } from "./AboutFlyout.js";
import { AmbraMarkIcon } from "../reader/components/AmbraMarkIcon.js";
import { CHROME_TOOLBAR_HEIGHT, useChromeToolbarStyles } from "../components/ChromeToolbarStyles.js";
import { ReaderSettingsMenu } from "../reader/components/ReaderPreferencesMenus.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import type { StringCatalog } from "../i18n/locales/en.js";
import { formatLibraryBytes, formatLibraryProgress } from "./LibraryFormatting.js";

const SORT_GROUP_NAME = "librarySort";

const useBookCardStyles = makeStyles({
  cover: {
    transition: "border-color 120ms ease, box-shadow 120ms ease, filter 80ms ease",
    ":active": {
      filter: "brightness(0.88)",
    },
    "@media (prefers-reduced-motion: reduce)": {
      transition: "none",
    },
  },
});

const SORT_LABELS: Readonly<Record<LibrarySortOption, keyof StringCatalog>> = {
  dateAddedDesc: "library.sortNewest",
  dateAddedAsc: "library.sortOldest",
  titleAsc: "library.sortTitle",
  authorAsc: "library.sortAuthor",
};

const BookCard: FC<{
  book: LibraryBookViewModel;
  accent: string;
  onOpen: () => void;
  onDelete: () => void;
  onShowDetails: () => void;
}> = ({ book, accent, onOpen, onDelete, onShowDetails }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const styles = useBookCardStyles();
  const restoreFocusTarget = useRestoreFocusTarget();
  // Hovering/focusing a cover picks up the reader's own accent color
  // (issue #86 follow-up — the same idea as the TOC's current-chapter
  // border and the scrubber fill, extended here) instead of a plain
  // generic neutral highlight, so the library page reads as the same
  // themed app as the reader rather than a totally separate, undecorated
  // one, and the same state also reveals the remove button (kept hidden
  // the rest of the time, matching a reader's usual "hover to reveal a
  // destructive action" expectation rather than a permanently-visible
  // icon competing for attention on every single card).
  //
  // Hover and focus are tracked as two *separate* booleans (rather than
  // one shared flag both write to directly) and combined via `||` — a
  // real, confirmed bug with a single shared flag: clicking the remove
  // button shifts keyboard focus away from the cover (to the remove
  // button itself), firing the cover's own `onBlur` and flipping the
  // shared flag straight back to `false` mid-click — which, since the
  // remove button's visibility/`pointer-events` depend on that same
  // flag, could make it disappear (and stop accepting the pointer
  // event) between mousedown and mouseup, silently swallowing the very
  // click that was supposed to remove the book. Tracking the remove
  // button's own focus too (so focus moving *between* the cover and the
  // remove button never dips through "neither" for the combined value)
  // closes that gap.
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const isActive = isHovered || isFocused;

  // Rounds to whole percent and only ever shows up once a book has
  // *some* recorded progress — an untouched book (or one whose progress
  // predates `fractionComplete`, or was last saved in scroll mode) has
  // nothing meaningful to show, so the bar/label are omitted entirely
  // rather than rendering a misleading "0%".
  const progressPercent =
    book.progressFraction !== undefined ? Math.round(book.progressFraction * 100) : undefined;

  return (
    <div
      style={{
        width: 140,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={{ position: "relative", width: 140, height: 200 }}>
        <button
          className={styles.cover}
          type="button"
          onClick={onOpen}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          aria-label={progressPercent !== undefined
            ? t("library.openBookProgress", { title: book.title, progress: formatLibraryProgress(progressPercent / 100, locale) })
            : t("library.openBook", { title: book.title })}
          style={{
            width: 140,
            height: 200,
            padding: 0,
            border: `2px solid ${isActive ? accent : CHROME_BORDER}`,
            borderRadius: 4,
            background: book.coverUrl
              ? `center / cover no-repeat url(${book.coverUrl})`
              : "var(--colorNeutralBackground3, #eee)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            font: "inherit",
            boxShadow: isActive ? `0 2px 10px ${accent}66` : "none",
          }}
        >
          {!book.coverUrl && <Body1 style={{ padding: 8 }}>{book.title}</Body1>}
        </button>
        {/* A thin reading-progress bar along the cover's bottom edge,
            Apple-Books-style — deliberately not a text overlay on the
            cover art itself (would fight with the artwork/title
            fallback text above). Purely decorative (`aria-hidden`): the
            percentage is already in the cover button's own
            `aria-label` above for anyone who can't see the bar. */}
        {progressPercent !== undefined && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              bottom: 2,
              height: 3,
              borderRadius: 2,
              background: "rgba(0, 0, 0, 0.25)",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                background: accent,
              }}
            />
          </div>
        )}
        {/* A themed icon-only "i" button (issue #105) — same hover-reveal
            idiom as the trash can, mirrored to the opposite (top-left)
            corner so the two never compete for the same spot. Opens the
            read-only Book Details flyout (`BookDetailsFlyout`). */}
        <Tooltip content={t("library.bookDetails", { title: book.title })} relationship="label">
          <Button
            {...restoreFocusTarget}
            appearance="secondary"
            size="small"
            icon={<InfoRegular />}
            onClick={onShowDetails}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            aria-label={t("library.bookDetails", { title: book.title })}
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              minWidth: 0,
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: "50%",
              border: `1px solid ${CHROME_BORDER}`,
              boxShadow: CHROME_SHADOW,
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? "auto" : "none",
              transition: "opacity 120ms ease",
            }}
          />
        </Tooltip>
        {/* A themed icon-only trash can (issue: library styling should
            align with the reader's own chrome instead of a plain generic
            text button) — only ever revealed on hover/focus of this card
            (see `isActive`), a click target big enough for touch/mouse
            but unobtrusive the rest of the time. This button is a
            sibling of the cover button in the DOM, not nested inside it
            (buttons can't nest), so a click here never reaches `onOpen`
            at all. */}
        <Tooltip content={t("library.removeBook", { title: book.title })} relationship="label">
          <Button
            appearance="secondary"
            size="small"
            icon={<DeleteRegular />}
            onClick={onDelete}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            aria-label={t("library.removeBook", { title: book.title })}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              minWidth: 0,
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: "50%",
              border: `1px solid ${CHROME_BORDER}`,
              boxShadow: CHROME_SHADOW,
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? "auto" : "none",
              transition: "opacity 120ms ease",
            }}
          />
        </Tooltip>
      </div>
      <Body1
        as="p"
        style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {book.title}
      </Body1>
      {book.creator && (
        <Body1 as="p" style={{ margin: 0, color: "var(--colorNeutralForeground3, #666)" }}>
          {book.creator}
        </Body1>
      )}
    </div>
  );
};

/** Library page: a grid of imported books (cover, title, author), import
 * via file picker, delete, sort, and "open" (launches the full-tab
 * reader for that book — see `navigation.ts`). Backed by
 * `LibraryDatabase` (IndexedDB), all local-only in v1.
 *
 * Also the extension's own toolbar popup (`manifest.json`'s
 * `default_popup`) — small and fixed-size there, which is fine for a
 * handful of books but cramped for a real library, so this same page
 * can also open as its own full browser tab (`openInFullTab`/
 * `isFullTab`, see `navigation.ts`'s `openLibraryTab`).
 *
 * Themed with the same "Reader Theme" chosen in the reader's own
 * Settings menu (issue #86 follow-up — `useLibrary`'s `chromeTheme`,
 * read from the same shared `LibraryDatabase` preference the reader
 * itself reads on open) — this page previously had no theme awareness
 * at all, so picking any reader theme besides the default still left
 * the library reading as a second, totally undecorated app the instant
 * a reader left the book itself. The page background, cover hover/focus
 * accent, and every action button now share the reader chrome's own
 * visual language (`CHROME_BORDER`/`CHROME_SHADOW`, the same subtle-
 * icon-button-with-tooltip idiom the toolbar uses) rather than a full
 * re-skin of every Fluent control — enough for the choice to feel like
 * a whole-app identity without needing to fight Fluent's own default
 * component styling. */
export const LibraryApp: FC = () => {
  const t = useTranslation();
  const { locale } = useLocale();
  useEffect(() => { document.title = t("library.pageTitle"); }, [t]);
  const restoreAboutFocus = useRestoreFocusTarget();
  const {
    books,
    isLoading,
    canImport,
    importActivities,
    dismissCompletedImports,
    error,
    dismissError,
    importFiles,
    removeBook,
    openBook,
    chromeTheme,
    settings,
    setSettings,
    sort,
    setSort,
    isFullTab,
    openInFullTab,
    storageUsage,
    openInspectionSession,
  } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const palette = CHROME_THEMES[chromeTheme];
  const toolbarStyles = useChromeToolbarStyles();
  const [detailsBookId, setDetailsBookId] = useState<string | undefined>(undefined);
  const detailsBook = books.find((book) => book.id === detailsBookId);
  const inspector = useLibraryInspector(detailsBook?.id, openInspectionSession);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    void importFiles(Array.from(files));
    event.target.value = "";
  };

  return (
    <div style={{ minHeight: "100vh", background: palette.backgroundSolid, display: "flex", flexDirection: "column" }}>
      <div
        className={toolbarStyles.root}
        role="toolbar"
        aria-label={t("library.toolbar")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
          height: "auto",
          minHeight: CHROME_TOOLBAR_HEIGHT,
          padding: "8px 10px",
          borderBottom: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
        }}
      >
        <Title2 style={{ color: palette.accent, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <AmbraMarkIcon size={24} />
          Ambra
        </Title2>
        <div style={{ flex: 1 }} />
        <Button
          appearance="primary"
          size="small"
          icon={<DocumentAddRegular />}
          disabled={!canImport}
          onClick={() => fileInputRef.current?.click()}
        >
          {t("library.importEpub")}
        </Button>
        <Menu
          checkedValues={{ [SORT_GROUP_NAME]: [sort] }}
          onCheckedValueChange={(_event, data) => {
            if (data.name === SORT_GROUP_NAME) {
              setSort(data.checkedItems[0] as LibrarySortOption);
            }
          }}
        >
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={t("library.sort")} relationship="label">
              <Button appearance="subtle" size="small" icon={<ArrowSortRegular />} aria-label={t("library.sort")} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuGroup>
                <MenuGroupHeader>{t("library.sortBy")}</MenuGroupHeader>
                {(Object.keys(SORT_LABELS) as LibrarySortOption[]).map((option) => (
                  <MenuItemRadio key={option} name={SORT_GROUP_NAME} value={option}>
                    {t(SORT_LABELS[option])}
                  </MenuItemRadio>
                ))}
              </MenuGroup>
            </MenuList>
          </MenuPopover>
        </Menu>

        <span role="separator" aria-orientation="vertical" style={{ height: 20, borderLeft: `1px solid ${CHROME_BORDER}`, margin: "0 4px" }} />
        <ReaderSettingsMenu
          {...settings}
          disabled={isLoading || !canImport}
          isFixedLayout={false}
          onSetViewMode={(viewMode) => setSettings({ viewMode })}
          onSetBrightness={(brightness) => setSettings({ brightness })}
          onSetChromeTheme={(chromeTheme) => setSettings({ chromeTheme })}
          onSetPageTurnAnimationStyle={(pageTurnAnimationStyle) => setSettings({ pageTurnAnimationStyle })}
        />
        <Tooltip content={t("about.title")} relationship="label">
          <Button
            {...restoreAboutFocus}
            appearance="subtle"
            size="small"
            icon={<InfoRegular />}
            onClick={() => setIsAboutOpen(true)}
            aria-label={t("about.title")}
          />
        </Tooltip>

        {!isFullTab && (
          <Tooltip content={t("library.expand")} relationship="label">
            <Button appearance="subtle" size="small" icon={<WindowNewRegular />} onClick={openInFullTab}
              aria-label={t("library.expand")} />
          </Tooltip>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          multiple
          disabled={!canImport}
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      <div style={{ padding: 16, flex: 1 }}>
        <LibraryImportStatus activities={importActivities} onDismissCompleted={dismissCompletedImports} />
        {error && <LibraryImportError message={error} onDismiss={dismissError} />}

        {isLoading ? (
          <Spinner label={t("library.loading")} style={{ marginTop: 16 }} />
        ) : books.length === 0 ? (
          importActivities.some(({ phase }) => phase !== "complete") ? null :
            <LibraryEmptyState accent={palette.accent} canImport={canImport} onImport={() => fileInputRef.current?.click()} />
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <LibraryDiscovery expandable />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {books.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  accent={palette.accent}
                  onOpen={() => openBook(book.id)}
                  onDelete={() => void removeBook(book.id)}
                  onShowDetails={() => setDetailsBookId(book.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <BookDetailsFlyout
        book={detailsBook}
        onRequestClose={() => setDetailsBookId(undefined)}
        accent={palette.accent}
        backgroundSolid={palette.backgroundSolid}
        onOpenInspector={isFullTab ? inspector.open : undefined}
        inspectionError={inspector.error ? { message: inspector.error, onDismiss: inspector.close } : undefined}
      />

      <AboutFlyout
        open={isAboutOpen}
        onRequestClose={() => setIsAboutOpen(false)}
        backgroundSolid={palette.backgroundSolid}
        accentForeground={palette.accentForeground}
      />

      <ChromeThemeProvider theme={chromeTheme}>
        <EpubInspectorPanel
          open={inspector.isOpen}
          onOpenChange={(open) => { if (!open) inspector.close(); }}
          data={inspector.data}
          fileName={detailsBook?.fileName}
          onFindReferences={(path) => {
            if (!inspector.session) {
              return Promise.reject(new Error(t("library.inspectorNotReady")));
            }
            return inspector.session.findReferences(path);
          }}
          onReadFile={(path) => {
            if (!inspector.session) {
              return Promise.reject(new Error(t("library.inspectorNotReady")));
            }
            return inspector.session.readInspectionFileText(path);
          }}
          onGetPreviewUrl={(path, mediaType) => {
            if (!inspector.session) {
              return Promise.reject(new Error(t("library.inspectorNotReady")));
            }
            return inspector.session.getInspectionFilePreviewUrl(path, mediaType);
          }}
        />
      </ChromeThemeProvider>

      {/* Purely informational (see `LibraryDatabase.estimateStorageUsage`'s
          doc comment on why this is never an enforced limit) — lets a
          reader with a very large library at least see roughly how much
          disk their book collection is using, the same way Chrome's own
          storage settings page would show it. */}
      {storageUsage && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 16px",
            borderTop: `1px solid ${CHROME_BORDER}`,
            color: "var(--colorNeutralForeground3, #666)",
            fontSize: 12,
          }}
        >
          <StorageRegular fontSize={14} />
          <span>
            {t("library.bookCount", { count: new Intl.NumberFormat(locale).format(books.length) })} ·{" "}
            {storageUsage.quotaBytes !== undefined
              ? t("library.storageUsedOf", { used: formatLibraryBytes(storageUsage.usageBytes, locale),
                available: formatLibraryBytes(storageUsage.quotaBytes, locale) })
              : t("library.storageUsed", { used: formatLibraryBytes(storageUsage.usageBytes, locale) })}
          </span>
        </div>
      )}
    </div>
  );
};
