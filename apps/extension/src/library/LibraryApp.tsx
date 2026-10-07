import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FC, type ReactNode } from "react";
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  SearchBox, Spinner, Title2, Tooltip, useRestoreFocusSource, useRestoreFocusTarget,
} from "@fluentui/react-components";
import { ChevronDownRegular, ChevronUpRegular, DocumentAddRegular, GlobeRegular, QuestionCircleRegular, WindowNewRegular } from "@fluentui/react-icons";
import { useLibrary, type UseLibraryResult } from "./useLibrary.js";
import { useLibraryInspector } from "./useLibraryInspector.js";
import { BookDetailsFlyout } from "./BookDetailsFlyout.js";
import { LibraryImportError } from "./LibraryImportError.js";
import { LibraryImportStatus } from "./LibraryImportStatus.js";
import { LibraryEmptyState } from "./LibraryEmptyState.js";
import { LibraryDiscovery } from "./LibraryDiscovery.js";
import { LibraryBookCard } from "./LibraryBookCard.js";
import { LibrarySortMenu } from "./LibrarySortMenu.js";
import { filterLibraryBooks } from "./LibrarySearch.js";
import { CHROME_BORDER } from "../reader/chromeTheme.js";
import { ChromeThemeProvider, useChromeTheme } from "../reader/ChromeThemeContext.js";
import { EpubInspectorPanel, INSPECTOR_DOCK_WIDTH, type InspectorViewMode } from "../reader/components/EpubInspectorPanel.js";
import { HelpAboutFlyout } from "../components/HelpAboutFlyout.js";
import { KeyboardShortcutsDialog } from "../components/KeyboardShortcutsDialog.js";
import { CenteredDialog } from "../components/CenteredDialog.js";
import { AmbraSettingsPopover } from "../components/AmbraSettingsPopover.js";
import { useHelpDialogs } from "../components/useHelpDialogs.js";
import { useShortcutPreferences } from "../shortcuts/ShortcutPreferencesContext.js";
import { matchReaderCommand } from "../shortcuts/ReaderCommands.js";
import { AmbraMarkIcon } from "../reader/components/AmbraMarkIcon.js";
import { useChromeToolbarStyles } from "../components/ChromeToolbarStyles.js";
import { useLocale, useTranslation } from "../i18n/LocaleContext.js";
import { formatLibraryBookCount, formatLibraryBytes } from "./LibraryFormatting.js";
import { ReviewInvitationCard } from "./ReviewInvitationCard.js";
import { useLibraryFileDrop } from "./useLibraryFileDrop.js";
import { LibraryFileDropOverlay } from "./LibraryFileDropOverlay.js";
import { LIBRARY_FULL_TAB_PARAM, LIBRARY_IMPORT_VIEW_VALUE } from "../navigation.js";
import { LibraryImportWindow } from "./LibraryImportWindow.js";

export interface EmbeddedLibraryOptions {
  open: boolean;
  onActivateBook: (bookId: string) => void;
  currentBookId?: string | undefined;
  renderHeader?: ((fullLibraryAction: ReactNode) => ReactNode) | undefined;
}

export interface LibraryAppProps {
  embedded?: EmbeddedLibraryOptions | undefined;
}

const LibrarySurface: FC<{ library: UseLibraryResult; embedded?: EmbeddedLibraryOptions | undefined }> = ({ library, embedded }) => {
  const t = useTranslation();
  const { locale } = useLocale();
  const isEmbedded = embedded !== undefined;
  const active = embedded?.open ?? true;
  useEffect(() => { if (!isEmbedded) document.title = t("library.pageTitle"); }, [t, isEmbedded]);
  const {
    books, isLoading, canImport, importActivities, dismissCompletedImports, cancelDownload,
    error, errorHeadline, dismissError, importFiles, removeBook, saveBookAs, getBookFileSize, enrichDescription, refreshBookAccessibility,
    settings, setSettings, sort, setSort, openInFullTab, storageUsage, openInspectionSession,
  } = library;
  const isFullTab = !isEmbedded && library.isFullTab;
  const isActionPopup = !isEmbedded && !isFullTab;
  const isCompact = !isFullTab;
  const openBook = embedded?.onActivateBook ?? library.openBook;
  const CollectionContainer = isEmbedded ? "div" : "main";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarImportRef = useRef<HTMLButtonElement>(null);
  const libraryHeadingRef = useRef<HTMLDivElement>(null);
  const collectionRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const compactToolsRef = useRef<HTMLButtonElement>(null);
  const removeCancelRef = useRef<HTMLButtonElement>(null);
  const restoreAboutFocus = useRestoreFocusTarget();
  const restoreDiscoveryFocus = useRestoreFocusTarget();
  const restoreRemoveFocus = useRestoreFocusSource();
  const [query, setQuery] = useState("");
  const [compactToolsOpen, setCompactToolsOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(() =>
    new URLSearchParams(window.location.search).get("discover") === "1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [helpTooltip, setHelpTooltip] = useState(false);
  const [detailsBookId, setDetailsBookId] = useState<string>();
  const [removeBookId, setRemoveBookId] = useState<string>();
  const [currentBookRemovalOpen, setCurrentBookRemovalOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const pendingRemovalFocus = useRef<{ removed: string; next?: string } | undefined>(undefined);
  const resultsId = useId();
  const importStatusId = useId();
  const compactToolsId = useId();
  const hasQuery = query.trim().length > 0;
  const visibleBooks = useMemo(() => filterLibraryBooks(books, query, locale), [books, query, locale]);
  const continueBook = useMemo(() => books.filter((book) => book.lastReadAt !== undefined &&
    (!isActionPopup || book.progressFraction === undefined || book.progressFraction < 1))
    .reduce<(typeof books)[number] | undefined>((latest, book) =>
      !latest || (book.lastReadAt ?? 0) > (latest.lastReadAt ?? 0) ? book : latest, undefined), [books, isActionPopup]);
  const popupContinueBook = isActionPopup && !hasQuery ? continueBook : undefined;
  const collectionBooks = popupContinueBook
    ? [popupContinueBook, ...visibleBooks.filter((book) => book.id !== popupContinueBook.id)]
    : visibleBooks;
  const detailsBook = books.find((book) => book.id === detailsBookId);
  const removalBook = books.find((book) => book.id === removeBookId);
  const inspector = useLibraryInspector(detailsBook?.id, openInspectionSession);
  const [inspectorView, setInspectorView] = useState<InspectorViewMode>("popover");
  const help = useHelpDialogs();
  const shortcuts = useShortcutPreferences();
  const palette = useChromeTheme();
  const toolbarStyles = useChromeToolbarStyles();
  const importInProgress = importActivities.some(({ phase }) => phase !== "complete");
  const { dropTargetRef, isDraggingFiles } = useLibraryFileDrop({
    enabled: active, canImport, busy: importInProgress, importFiles,
  });
  const isBookOpenDisabled = (bookId: string): boolean =>
    isEmbedded && importInProgress && bookId !== embedded.currentBookId;

  useEffect(() => {
    if (!isLoading && books.length === 0) setQuery("");
  }, [isLoading, books.length]);
  useEffect(() => {
    if (compactToolsOpen) searchInputRef.current?.focus();
  }, [compactToolsOpen]);
  useEffect(() => {
    if (active) return;
    setDetailsBookId(undefined);
    setRemoveBookId(undefined);
    setCurrentBookRemovalOpen(false);
  }, [active]);
  useEffect(() => { if (removeBookId) removeCancelRef.current?.focus(); }, [removeBookId]);
  useEffect(() => {
    const pending = pendingRemovalFocus.current;
    if (!pending || books.some((book) => book.id === pending.removed) || removing) return;
    pendingRemovalFocus.current = undefined;
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const next = [...(collectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-book-open]") ?? [])]
        .find((button) => button.dataset.bookOpen === pending.next);
      const nextControl = next?.disabled
        ? next.closest("[data-library-book]")?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        : next;
      (nextControl ?? toolbarImportRef.current ?? libraryHeadingRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [books, removing, active]);
  useEffect(() => {
    if (isEmbedded) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!shortcuts.ready || help.view || detailsBookId || inspector.isOpen || discoveryOpen || settingsOpen || reviewOpen || removeBookId) return;
      const command = matchReaderCommand(event, document, {
        preferences: shortcuts.preferences, platform: shortcuts.platform, commands: ["showKeyboardShortcuts"], scope: "shell",
      });
      if (command === "showKeyboardShortcuts") {
        event.preventDefault();
        help.openShortcuts();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcuts.ready, shortcuts.preferences, shortcuts.platform, help.view, help.openShortcuts,
    detailsBookId, inspector.isOpen, discoveryOpen, settingsOpen, reviewOpen, removeBookId, isEmbedded]);

  const requestRemove = (id: string): void => {
    if (id === embedded?.currentBookId) {
      setCurrentBookRemovalOpen(true);
      return;
    }
    setRemoveBookId(id);
  };
  const cancelRemove = (): void => {
    if (removing) return;
    setRemoveBookId(undefined);
  };
  const confirmRemove = async (): Promise<void> => {
    if (!removalBook || removing) return;
    if (removalBook.id === embedded?.currentBookId) {
      setRemoveBookId(undefined);
      setCurrentBookRemovalOpen(true);
      return;
    }
    const index = visibleBooks.findIndex((book) => book.id === removalBook.id);
    const next = visibleBooks[index + 1] ?? visibleBooks[index - 1];
    pendingRemovalFocus.current = { removed: removalBook.id, ...(next ? { next: next.id } : {}) };
    setRemoving(true);
    const removed = await removeBook(removalBook.id);
    if (removed) setDetailsBookId(undefined);
    else pendingRemovalFocus.current = undefined;
    setRemoveBookId(undefined);
    setRemoving(false);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files;
    if (!files?.length) return;
    void importFiles(Array.from(files));
    event.target.value = "";
  };
  const discoveryAction = (
    <Button {...restoreDiscoveryFocus} appearance={isCompact ? "primary" : "secondary"} icon={<GlobeRegular />} aria-haspopup="dialog"
      onClick={() => isFullTab ? setDiscoveryOpen(true) : openInFullTab(true)}
      style={{ minWidth: 0, whiteSpace: "normal" }}>
      {t("library.findBooks")}
    </Button>
  );
  const importAction = (
    <Button ref={toolbarImportRef} appearance={isCompact ? "secondary" : "primary"} icon={<DocumentAddRegular />}
      title={isActionPopup ? t("library.importWindowAction") : undefined}
      disabled={!canImport} onClick={() => {
        // A native chooser can destroy the action popup before files are returned.
        if (isActionPopup) openInFullTab("import");
        else fileInputRef.current?.click();
      }} style={{ minWidth: 0, whiteSpace: "normal" }}>
      {t("library.importEpub")}
    </Button>
  );
  const searchAndSort = (
    <div data-library-filters="" style={{ display: "flex", alignItems: "center", gap: 4,
      marginBottom: isFullTab ? 12 : 0,
      background: palette.backgroundSolid }}>
      <SearchBox value={query} input={{ ref: searchInputRef }} onChange={(_event, data) => setQuery(data.value)}
        aria-label={t("library.search")} aria-controls={resultsId} placeholder={t("library.searchPlaceholder")}
        dismiss={{ "aria-label": t("library.clearSearch") }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing &&
            !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
            event.target instanceof HTMLInputElement && query) {
            event.preventDefault(); event.stopPropagation(); setQuery("");
          }
        }} style={{ flex: 1, minWidth: 0, maxWidth: 440 }} />
      <LibrarySortMenu sort={sort} onChange={setSort} active={active && (!isCompact || compactToolsOpen)} />
    </div>
  );
  const fullLibraryAction = (
    <Button appearance="subtle" size="small" icon={<WindowNewRegular />} iconPosition="after"
      aria-label={t("library.fullLibrary")} title={t("library.fullLibrary")} onClick={() => openInFullTab()}
      style={{ minWidth: 0, whiteSpace: "normal" }}>{t("library.fullLibraryLabel")}</Button>
  );

  return (
    <div ref={dropTargetRef} style={{
      position: isEmbedded ? "relative" : undefined,
      minWidth: 0, minHeight: isFullTab ? "100vh" : 0, height: isEmbedded ? "100%" : isFullTab ? undefined : "100dvh",
      overflow: isCompact ? "hidden" : undefined,
      background: palette.backgroundSolid, color: "var(--colorNeutralForeground1)", display: "flex", flexDirection: "column",
      marginLeft: inspector.isOpen && inspectorView === "dock-left" ? INSPECTOR_DOCK_WIDTH : 0,
      marginRight: inspector.isOpen && inspectorView === "dock-right" ? INSPECTOR_DOCK_WIDTH : 0,
    }}>
      <LibraryFileDropOverlay active={isDraggingFiles} contained={isEmbedded} />
      {isEmbedded && (embedded.renderHeader ? embedded.renderHeader(fullLibraryAction) :
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", flexShrink: 0 }}>{fullLibraryAction}</div>)}
      {!isEmbedded && <header className={toolbarStyles.root} role="toolbar" aria-label={t("library.toolbar")}
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px",
          flexShrink: 0, borderBottom: `1px solid ${CHROME_BORDER}` }}>
        <div ref={libraryHeadingRef} tabIndex={-1}>
          <Title2 as="h1" style={{ margin: 0, color: palette.accentForeground, display: "flex", alignItems: "center", gap: 8,
            fontSize: isFullTab ? 24 : 20, lineHeight: "28px" }}>
            <AmbraMarkIcon size={24} /> Ambra
          </Title2>
        </div>
        <div style={{ flex: 1 }} />
        {isActionPopup && fullLibraryAction}
        <AmbraSettingsPopover settings={settings} onChange={setSettings} disabled={isLoading}
          showFullscreen={!isActionPopup}
          onOpenChange={(open) => { setSettingsOpen(open); if (open) setHelpTooltip(false); }} />
        <Tooltip content={t("about.title")} relationship="label" visible={helpTooltip && !help.view && !settingsOpen}
          onVisibleChange={(_event, data) => setHelpTooltip(data.visible && !help.view && !settingsOpen)}>
          <Button {...restoreAboutFocus} appearance="subtle" icon={<QuestionCircleRegular />}
            onClick={(event) => { setHelpTooltip(false); help.openHelp(event.currentTarget); }} aria-label={t("about.title")}>
            {isFullTab && t("about.title")}
          </Button>
        </Tooltip>
      </header>}

      <div style={{ padding: isCompact ? 0 : "20px 24px 0", flexShrink: 0 }}>
        {isFullTab &&
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
          {discoveryAction}{importAction}
        </div>}
        <input ref={fileInputRef} type="file" accept=".epub" multiple disabled={!canImport} style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      {isCompact && <div data-library-popup-heading="" style={{ padding: "4px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 8px" }}>
            {!isEmbedded && <h2 style={{ margin: 0, fontSize: 18, lineHeight: "28px", overflowWrap: "anywhere" }}>{t("library.yourLibrary")}</h2>}
            {!isLoading && <span data-library-book-count="" style={{ fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
              {formatLibraryBookCount(books.length, locale, t)}
            </span>}
          </div>
          {books.length > 0 && <Button ref={compactToolsRef} appearance="subtle" size="small"
            data-library-tools-toggle=""
            icon={compactToolsOpen ? <ChevronUpRegular /> : <ChevronDownRegular />} iconPosition="after"
            aria-expanded={compactToolsOpen} aria-controls={compactToolsId}
            onClick={() => setCompactToolsOpen((open) => !open)}
            style={{ minWidth: 0, maxWidth: "45%", whiteSpace: "normal" }}>
            {t("library.findAndSort")}
          </Button>}
        </div>
        {books.length > 0 && <div id={compactToolsId} hidden={!compactToolsOpen} style={{ marginTop: 8 }}
          onKeyDown={(event) => {
            if (!compactToolsOpen || event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing ||
              event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
              document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]')) return;
            event.preventDefault(); event.stopPropagation();
            setCompactToolsOpen(false);
            compactToolsRef.current?.focus();
          }}>
          {searchAndSort}
        </div>}
      </div>}

      <CollectionContainer aria-label={t("library.pageTitle")} style={{ padding: isFullTab ? "0 24px 24px" : "0 12px 12px",
        // Compact surfaces scroll books between fixed navigation and import/discovery actions.
        flex: 1, minHeight: 0, overflowY: isFullTab ? undefined : "auto" }}>
        <LibraryImportStatus activities={importActivities} books={books} onOpenBook={openBook}
          onDismissCompleted={dismissCompletedImports} onCancelDownload={cancelDownload}
          isBookOpenDisabled={isBookOpenDisabled} busyMessageId={importStatusId}
          focusFallbackRef={toolbarImportRef} focusBackupRef={libraryHeadingRef} />
        {error && <LibraryImportError message={error} headline={errorHeadline} onDismiss={dismissError} />}
        {isLoading ? <Spinner label={t("library.loading")} style={{ marginTop: 16 }} /> : books.length === 0 ? (
          !importInProgress && <LibraryEmptyState accent={palette.accentForeground} compact={!isFullTab} />
        ) : (
          <>
            {isFullTab && continueBook && !hasQuery && (
              <section aria-label={t("library.continueReading")} style={{ marginBottom: 24 }}>
                <LibraryBookCard book={continueBook} compact variant="continue" onOpen={() => openBook(continueBook.id)}
                  onRequestRemove={() => requestRemove(continueBook.id)} onShowDetails={() => setDetailsBookId(continueBook.id)} />
              </section>
            )}
            {isFullTab && searchAndSort}
            <div role="status" aria-label={t("library.search")} aria-atomic="true" style={{ fontSize: 12,
              color: "var(--colorNeutralForeground2)", marginBottom: hasQuery ? 12 : 0 }}>
              {hasQuery && t("library.searchResults", { shown: new Intl.NumberFormat(locale).format(visibleBooks.length),
                total: new Intl.NumberFormat(locale).format(books.length) })}
              {isCompact && hasQuery && !compactToolsOpen && <Button appearance="subtle" size="small"
                aria-label={t("library.clearSearch")} onClick={() => { setQuery(""); compactToolsRef.current?.focus(); }}>
                {t("library.clearSearch")}
              </Button>}
            </div>
            <div ref={collectionRef} id={resultsId} data-library-collection style={{ display: "flex", flexDirection: isFullTab ? "row" : "column",
              flexWrap: isFullTab ? "wrap" : undefined, gap: isFullTab ? 24 : 0, alignItems: "start" }}>
              {visibleBooks.length === 0 && <p style={{ margin: 0 }}>{t("library.searchNoResults")}</p>}
              {collectionBooks.map((book) => (
                <LibraryBookCard key={book.id} book={book} compact={!isFullTab} compactLayout={isCompact}
                  variant={book.id === popupContinueBook?.id ? "continue" : "collection"}
                  current={book.id === embedded?.currentBookId} active={active}
                  openDisabled={isBookOpenDisabled(book.id)}
                  openDescriptionId={isBookOpenDisabled(book.id) ? importStatusId : undefined}
                  onOpen={() => openBook(book.id)}
                  onRequestRemove={() => requestRemove(book.id)} onShowDetails={() => setDetailsBookId(book.id)} />
              ))}
            </div>
          </>
        )}
        {isFullTab && <ReviewInvitationCard
          onOpenChange={setReviewOpen}
          onDismiss={() => toolbarImportRef.current?.focus()}
          blocked={isLoading || importInProgress || !!error || !!help.view || !!detailsBookId ||
            inspector.isOpen || discoveryOpen || settingsOpen || !!removeBookId || hasQuery} />}
      </CollectionContainer>

      <CenteredDialog open={isFullTab && discoveryOpen} title={t("library.findBooks")} onRequestClose={() => setDiscoveryOpen(false)}>
        <LibraryDiscovery />
      </CenteredDialog>
      <BookDetailsFlyout book={active ? detailsBook : undefined} inspectorOpen={inspector.isOpen}
        onRequestClose={() => setDetailsBookId(undefined)} onSaveAs={saveBookAs} onGetFileSize={getBookFileSize}
        onEnrichDescription={enrichDescription}
        onRefreshAccessibility={refreshBookAccessibility}
        onRemove={detailsBook ? () => requestRemove(detailsBook.id) : undefined}
        accent={palette.actionBackground} accentForeground={palette.accentForeground} backgroundSolid={palette.backgroundSolid}
        onOpenInspector={isFullTab ? inspector.open : undefined}
        inspectionError={inspector.error ? { message: inspector.error, onDismiss: inspector.close } : undefined} />

      <CenteredDialog open={active && currentBookRemovalOpen} title={t("library.removeTitle")}
        onRequestClose={() => setCurrentBookRemovalOpen(false)}>
        <p>{t("library.currentBookRemoval")}</p>
        <Button appearance="secondary" icon={<WindowNewRegular />} onClick={() => openInFullTab()}>{t("library.fullLibrary")}</Button>
      </CenteredDialog>
      <Dialog open={active && !!removalBook} modalType="alert" onOpenChange={(_event, data) => { if (!data.open) cancelRemove(); }}>
        <DialogSurface {...restoreRemoveFocus} style={{ maxWidth: "calc(100vw - 24px)", boxSizing: "border-box" }}>
          <DialogBody>
            <DialogTitle>{t("library.removeTitle")}</DialogTitle>
            <DialogContent style={{ overflowWrap: "anywhere" }}>
              <p>{t("library.removeConfirm", { title: removalBook?.title ?? "" })}</p>
              <p>{t("library.removeConsequences")}</p>
            </DialogContent>
            <DialogActions fluid>
              <Button ref={removeCancelRef} disabled={removing} onClick={cancelRemove}>{t("annotations.cancelNote")}</Button>
              <Button appearance="primary" disabled={removing} onClick={() => void confirmRemove()}
                style={{ background: "var(--colorPaletteRedBackground3)", color: "var(--colorNeutralForegroundOnBrand)" }}>
                {t("library.removeAction")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {!isEmbedded && <>
        <HelpAboutFlyout open={help.view === "about"} focusShortcutsOnOpen={help.focusShortcutsOnOpen}
          onRequestClose={help.close} onAfterClose={help.afterClose} backgroundSolid={palette.backgroundSolid}
          accentForeground={palette.accentForeground} onOpenKeyboardShortcuts={help.openShortcutsFromHelp} />
        <KeyboardShortcutsDialog open={help.view === "shortcuts"} onRequestClose={help.close} onAfterClose={help.afterClose} />
        <EpubInspectorPanel open={inspector.isOpen} viewMode={inspectorView} onViewModeChange={setInspectorView}
          onOpenChange={(open) => { if (!open) inspector.close(); }} data={inspector.data} fileName={detailsBook?.fileName}
          onFindReferences={(path) => inspector.session ? inspector.session.findReferences(path) : Promise.reject(new Error(t("library.inspectorNotReady")))}
          onReadFile={(path) => inspector.session ? inspector.session.readInspectionFileText(path) : Promise.reject(new Error(t("library.inspectorNotReady")))}
          onGetPreviewUrl={(path, mediaType) => inspector.session ? inspector.session.getInspectionFilePreviewUrl(path, mediaType) : Promise.reject(new Error(t("library.inspectorNotReady")))} />
      </>}

      <footer style={{ flexShrink: 0, background: palette.backgroundSolid, borderTop: `1px solid ${CHROME_BORDER}`, padding: "8px 12px" }}>
        {isFullTab && books.length > 0 && <div style={{ fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
          {t("library.bookCount", { count: new Intl.NumberFormat(locale).format(books.length) })}
          {storageUsage && <> · {storageUsage.quotaBytes !== undefined
            ? t("library.storageUsedOf", { used: formatLibraryBytes(storageUsage.usageBytes, locale), available: formatLibraryBytes(storageUsage.quotaBytes, locale) })
            : t("library.storageUsed", { used: formatLibraryBytes(storageUsage.usageBytes, locale) })}</>}
        </div>}
        {isCompact && <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
          {discoveryAction}{importAction}
        </div>}
      </footer>
    </div>
  );
};

export const LibraryApp: FC<LibraryAppProps> = ({ embedded }) => {
  const library = useLibrary();
  if (embedded) return <LibrarySurface library={library} embedded={embedded} />;
  const importWindow = new URLSearchParams(window.location.search).get(LIBRARY_FULL_TAB_PARAM) === LIBRARY_IMPORT_VIEW_VALUE;
  return <ChromeThemeProvider theme={library.chromeTheme}>
    {importWindow ? <LibraryImportWindow library={library} /> : <LibrarySurface library={library} />}
  </ChromeThemeProvider>;
};
