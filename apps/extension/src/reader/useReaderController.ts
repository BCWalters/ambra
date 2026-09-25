import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { FontFamilyChoice, PageTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark } from "../library/LibraryDatabase.js";
import type { AnnotationImportResult } from "../library/AnnotationInterop.js";
import { ReaderController } from "./ReaderController.js";
import type { DiagnosticEvent, DiagnosticSurfaces } from "./DiagnosticsLog.js";
import type { ShortcutPlatform, ShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import { parseShortcutPreferences } from "../shortcuts/ReaderCommands.js";
import { prepareBookOpeningTransition } from "./BookOpeningTransition.js";
import type { InspectorReference } from "./InspectorReferences.js";
import type {
  BookDetails,
  EpubInspectionData,
  InspectorReaderBridge,
  NarrationAction,
  PreviewPosition,
  ReaderSnapshot,
  ReaderShortcutActions,
  ReadOnlyAnnotationView,
} from "./ReaderTypes.js";
import type { ViewMode } from "./ViewMode.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { Translate } from "../i18n/LocaleContext.js";

export interface UseReaderControllerResult {
  recordDiagnosticEvent: (event: DiagnosticEvent) => void;
  recordDiagnosticSurfaces: (surfaces: DiagnosticSurfaces) => void;
  setContentUiDismissal: (dismiss: (() => boolean) | undefined) => void;
  setShortcutActions: (actions: ReaderShortcutActions) => void;
  setShortcutPreferences: (preferences: ShortcutPreferences, platform: ShortcutPlatform) => void;
  setShortcutModalOpen: (open: boolean) => void;
  snapshot: ReaderSnapshot | undefined;
  contentHostRef: RefObject<HTMLDivElement | null>;
  openBook: (buffer: ArrayBuffer, bookId: string, library: LibraryDatabase) => Promise<void>;
  turnPage: (direction: 1 | -1) => void;
  narrationAction: (action: NarrationAction) => void;
  setNarrationRate: (rate: number) => void;
  dismissNarrationNotice: () => void;
  goToChapter: (direction: 1 | -1) => void;
  goToNavPoint: (navPoint: Parameters<ReaderController["goToNavPoint"]>[0]) => void;
  setViewMode: (mode: ViewMode) => void;
  setFontScale: (scale: number) => void;
  setLineSpacing: (spacing: number) => void;
  setLetterSpacing: (spacing: number) => void;
  setContentWidth: (widthEm: number) => void;
  setFontFamily: (family: FontFamilyChoice) => void;
  setPageTheme: (theme: PageTheme) => void;
  setBrightness: (brightness: number) => void;
  setChromeTheme: (theme: ChromeThemeChoice) => void;
  setPageTurnAnimationStyle: (style: PageTurnAnimationStyle) => void;
  previewSeek: (fraction: number) => { position: PreviewPosition; chapterLabel: string };
  seekToFraction: (fraction: number, options?: { preserveFocus?: boolean }) => Promise<void>;
  getBookDetails: () => Promise<BookDetails | undefined>;
  getEpubInspectionData: () => EpubInspectionData | undefined;
  getInspectorReaderBridge: () => InspectorReaderBridge | undefined;
  findInspectionReferences: (path: string) => Promise<readonly InspectorReference[]>;
  readInspectionFileText: (path: string) => Promise<string>;
  getInspectionFilePreviewUrl: (path: string, mediaType: string) => Promise<string>;
  closeImageViewer: () => void;
  restoreContentFocus: () => void;
  getDiagnosticsText: () => string | undefined;
  addBookmark: () => Promise<Bookmark | undefined>;
  toggleBookmark: () => Promise<void>;
  refreshBookmarks: () => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
  goToBookmark: (cfi: string) => Promise<void>;
  addHighlight: (style: HighlightStyle, openNoteEditor?: boolean) => Promise<void>;
  removeHighlight: (id: string) => Promise<void>;
  setHighlightNote: (id: string, note: string | undefined) => Promise<boolean>;
  setHighlightStyle: (id: string, style: HighlightStyle) => Promise<void>;
  search: (query: string) => void;
  goToSearchResult: (cfi: string) => Promise<void>;
  setSearchPanelState: (open: boolean, pinned: boolean) => void;
  goToHighlight: (cfi: string) => Promise<void>;
  listEmbeddedAnnotations: () => ReadOnlyAnnotationView[];
  goToReadOnlyAnnotation: (cfi: string) => Promise<void>;
  exportAnnotations: () => Promise<{ filename: string; text: string } | undefined>;
  importAnnotationsFile: (file: File) => Promise<AnnotationImportResult | undefined>;
  dismissSelectionToolbar: () => void;
  dismissActiveHighlight: () => void;
  openHighlightPopup: (id: string) => void;
  dismissFootnotePopup: () => void;
  dismissError: () => void;
}

/** Bridges `ReaderController` (a plain, framework-agnostic class) into
 * React: owns the controller instance for the current book, subscribes
 * to it via `useSyncExternalStore` so components re-render on every state
 * change, wires a `ResizeObserver` on the content host's container
 * element so the reading surface relayouts (preserving position) as the
 * reader pane's size changes, and flushes reading progress when the tab
 * is hidden/closed (the reliable checkpoint for continuous-scroll mode,
 * whose position otherwise only gets persisted on discrete navigation
 * actions — see `ReaderController.saveProgress`). */
export function useReaderController(translate: Translate): UseReaderControllerResult {
  const [controller, setController] = useState<ReaderController | null>(null);
  const contentHostRef = useRef<HTMLDivElement | null>(null);
  const openGeneration = useRef(0);
  const mounted = useRef(true);
  const ownedController = useRef<ReaderController | null>(null);
  const shortcutActions = useRef<ReaderShortcutActions | undefined>(undefined);
  const shortcutPreferences = useRef<{ preferences: ShortcutPreferences; platform: ShortcutPlatform } | undefined>(undefined);
  const shortcutModalOpen = useRef(false);
  const contentUiDismissal = useRef<(() => boolean) | undefined>(undefined);
  const recordDiagnosticEvent = useCallback((event: DiagnosticEvent) => {
    ownedController.current?.recordDiagnosticEvent(event);
  }, []);
  const recordDiagnosticSurfaces = useCallback((surfaces: DiagnosticSurfaces) => {
    ownedController.current?.recordDiagnosticSurfaces(surfaces);
  }, []);
  const setContentUiDismissal = useCallback((dismiss: (() => boolean) | undefined) => {
    contentUiDismissal.current = dismiss;
    ownedController.current?.setContentUiDismissal(dismiss);
  }, []);
  const setShortcutActions = useCallback((actions: ReaderShortcutActions) => {
    shortcutActions.current = actions;
    ownedController.current?.setShortcutActions(actions);
  }, []);
  const setShortcutPreferences = useCallback((preferences: ShortcutPreferences, platform: ShortcutPlatform) => {
    shortcutPreferences.current = { preferences: parseShortcutPreferences(preferences), platform };
    ownedController.current?.setShortcutPreferences(preferences, platform);
  }, []);
  const setShortcutModalOpen = useCallback((open: boolean) => {
    shortcutModalOpen.current = open;
    ownedController.current?.setShortcutModalOpen(open);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      openGeneration.current++;
      void ownedController.current?.flushProgress();
      ownedController.current?.dispose();
      ownedController.current = null;
    };
  }, []);

  // Keeps the controller's screen-reader announcements (see
  // `ReaderController.announce`) in whatever locale the reader has
  // currently chosen — re-runs on every render where `translate` itself
  // changed (i.e. right after a locale switch), not just once at mount,
  // since `translate` is otherwise never read again after the very first
  // announcement.
  useEffect(() => {
    controller?.setTranslate(translate);
  }, [controller, translate]);

  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (controller ? controller.subscribe(listener) : () => undefined),
      [controller],
    ),
    useCallback(() => controller?.snapshot(), [controller]),
  );

  useEffect(() => {
    if (!controller || !contentHostRef.current) {
      return;
    }

    const containerEl = contentHostRef.current;
    const rect = containerEl.getBoundingClientRect();
    const opening = prepareBookOpeningTransition(containerEl);
    void controller.mount(containerEl, rect.width, rect.height)
      .then(() => opening.reveal())
      .catch(error => {
        opening.cancel();
        controller.reportActionFailure(error);
      });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        controller.resize(width, height);
      }
    });
    observer.observe(containerEl);

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        void controller.flushProgress();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleVisibilityChange);

    // See `ReaderController.handleWindowRefocus`'s doc comment: recovers
    // page-turn keyboard/pointer interactivity that can otherwise go
    // silently dead after the window loses and regains OS focus (e.g.
    // alt-tabbing away and back), which previously required navigating
    // via the TOC (an incidental full host rebuild) to fix.
    const handleWindowFocus = (): void => {
      controller.handleWindowRefocus();
    };
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      opening.cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      void controller.flushProgress();
      controller.dispose();
    };
  }, [controller]);

  const openBook = useCallback(
    async (buffer: ArrayBuffer, bookId: string, library: LibraryDatabase): Promise<void> => {
      if (!mounted.current) {
        library.close();
        return;
      }
      const generation = ++openGeneration.current;
      let opened: ReaderController;
      try {
        opened = await ReaderController.open(buffer, bookId, library);
      } catch (error) {
        library.close();
        if (mounted.current && generation === openGeneration.current) throw error;
        return;
      }
      if (!mounted.current || generation !== openGeneration.current) {
        opened.dispose();
        return;
      }
      void ownedController.current?.flushProgress();
      ownedController.current?.dispose();
      ownedController.current = opened;
      opened.setContentUiDismissal(contentUiDismissal.current);
      if (shortcutActions.current) opened.setShortcutActions(shortcutActions.current);
      if (shortcutPreferences.current) {
        opened.setShortcutPreferences(shortcutPreferences.current.preferences, shortcutPreferences.current.platform);
      }
      opened.setShortcutModalOpen(shortcutModalOpen.current);
      setController(opened);
    },
    [],
  );

  const narrationAction = useCallback((action: NarrationAction) => {
    void controller?.performNarrationAction(action);
  }, [controller]);
  const setNarrationRate = useCallback((rate: number) => controller?.setNarrationRate(rate), [controller]);
  const dismissNarrationNotice = useCallback(() => controller?.dismissNarrationNotice(), [controller]);

  const turnPage = useCallback(
    (direction: 1 | -1) => {
      void controller?.turnPage(direction);
    },
    [controller],
  );

  const goToChapter = useCallback(
    (direction: 1 | -1) => {
      void controller?.goToChapter(direction);
    },
    [controller],
  );

  const goToNavPoint = useCallback(
    (navPoint: Parameters<ReaderController["goToNavPoint"]>[0]) => {
      void controller?.goToNavPoint(navPoint);
    },
    [controller],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      void controller?.setViewMode(mode).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setFontScale = useCallback(
    (scale: number) => {
      void controller?.setFontScale(scale).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setLineSpacing = useCallback(
    (spacing: number) => {
      void controller?.setLineSpacing(spacing).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setLetterSpacing = useCallback(
    (spacing: number) => {
      void controller?.setLetterSpacing(spacing).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setContentWidth = useCallback(
    (widthEm: number) => {
      void controller?.setContentWidth(widthEm).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setFontFamily = useCallback(
    (family: FontFamilyChoice) => {
      void controller?.setFontFamily(family).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setPageTheme = useCallback(
    (theme: PageTheme) => {
      void controller?.setPageTheme(theme).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setBrightness = useCallback(
    (brightness: number) => {
      void controller?.setBrightness(brightness).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setChromeTheme = useCallback(
    (theme: ChromeThemeChoice) => {
      void controller?.setChromeTheme(theme).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const setPageTurnAnimationStyle = useCallback(
    (style: PageTurnAnimationStyle) => {
      void controller?.setPageTurnAnimationStyle(style).catch(error => controller.reportActionFailure(error));
    },
    [controller],
  );

  const previewSeek = useCallback(
    (fraction: number) => {
      return controller?.previewSeek(fraction) ?? { position: { kind: "chapter" as const, current: 0, total: 0 }, chapterLabel: "" };
    },
    [controller],
  );

  const seekToFraction = useCallback(
    async (fraction: number, options?: { preserveFocus?: boolean }): Promise<void> => {
      await controller?.seekToFraction(fraction, options);
    },
    [controller],
  );

  const getBookDetails = useCallback(async () => {
    return controller?.getBookDetails();
  }, [controller]);

  const getEpubInspectionData = useCallback(() => {
    return controller?.getEpubInspectionData();
  }, [controller]);

  const getInspectorReaderBridge = useCallback(
    () => controller?.getInspectorReaderBridge(),
    [controller],
  );

  const findInspectionReferences = useCallback((path: string) => {
    if (!controller) return Promise.reject(new Error("The reader is not ready yet."));
    return controller.findInspectionReferences(path);
  }, [controller]);

  const readInspectionFileText = useCallback(
    async (path: string) => {
      if (!controller) {
        throw new Error("No book is open.");
      }
      return controller.readInspectionFileText(path);
    },
    [controller],
  );

  const getInspectionFilePreviewUrl = useCallback(
    async (path: string, mediaType: string) => {
      if (!controller) {
        throw new Error("No book is open.");
      }
      return controller.getInspectionFilePreviewUrl(path, mediaType);
    },
    [controller],
  );

  const closeImageViewer = useCallback(() => {
    controller?.closeImageViewer();
  }, [controller]);

  const restoreContentFocus = useCallback(() => {
    controller?.restoreContentFocus();
  }, [controller]);

  const getDiagnosticsText = useCallback(() => {
    return controller?.getDiagnosticsText();
  }, [controller]);

  const addBookmark = useCallback(async () => {
    return controller?.addBookmark();
  }, [controller]);

  const toggleBookmark = useCallback(async () => {
    await controller?.toggleBookmark();
  }, [controller]);

  const refreshBookmarks = useCallback(async () => {
    await controller?.refreshBookmarks();
  }, [controller]);

  const removeBookmark = useCallback(
    async (id: string) => {
      await controller?.removeBookmark(id);
    },
    [controller],
  );

  const goToBookmark = useCallback(
    async (cfi: string) => {
      await controller?.goToBookmark(cfi);
    },
    [controller],
  );

  const addHighlight = useCallback(
    async (style: HighlightStyle, openNoteEditor?: boolean) => {
      await controller?.addHighlight(style, openNoteEditor);
    },
    [controller],
  );

  const removeHighlight = useCallback(
    async (id: string) => {
      await controller?.removeHighlight(id);
    },
    [controller],
  );

  const setHighlightNote = useCallback(
    async (id: string, note: string | undefined) => {
      return (await controller?.setHighlightNote(id, note)) ?? false;
    },
    [controller],
  );

  const setHighlightStyle = useCallback(
    async (id: string, style: HighlightStyle) => {
      await controller?.setHighlightStyle(id, style);
    },
    [controller],
  );

  const search = useCallback(
    (query: string) => {
      controller?.search(query);
    },
    [controller],
  );

  const goToSearchResult = useCallback(
    async (cfi: string) => {
      await controller?.goToSearchResult(cfi);
    },
    [controller],
  );

  const setSearchPanelState = useCallback(
    (open: boolean, pinned: boolean) => {
      controller?.setSearchPanelState(open, pinned);
    },
    [controller],
  );

  const goToHighlight = useCallback(
    async (cfi: string) => {
      await controller?.goToHighlight(cfi);
    },
    [controller],
  );

  const listEmbeddedAnnotations = useCallback(() => {
    return controller?.listEmbeddedAnnotations() ?? [];
  }, [controller]);

  const goToReadOnlyAnnotation = useCallback(
    async (cfi: string) => {
      await controller?.goToReadOnlyAnnotation(cfi);
    },
    [controller],
  );

  const exportAnnotations = useCallback(async () => {
    return controller?.exportAnnotations();
  }, [controller]);

  const importAnnotationsFile = useCallback(
    async (file: File) => {
      return controller?.importAnnotationsFile(file);
    },
    [controller],
  );

  const dismissSelectionToolbar = useCallback(() => {
    controller?.dismissSelectionToolbar();
  }, [controller]);

  const dismissActiveHighlight = useCallback(() => {
    controller?.dismissActiveHighlight();
  }, [controller]);

  const openHighlightPopup = useCallback(
    (id: string) => {
      controller?.openHighlightPopup(id);
    },
    [controller],
  );

  const dismissFootnotePopup = useCallback(() => {
    controller?.dismissFootnotePopup();
  }, [controller]);

  const dismissError = useCallback(() => {
    controller?.dismissError();
  }, [controller]);

  return {
    recordDiagnosticEvent,
    recordDiagnosticSurfaces,
    setContentUiDismissal,
    setShortcutActions,
    setShortcutPreferences,
    setShortcutModalOpen,
    narrationAction,
    setNarrationRate,
    dismissNarrationNotice,
    snapshot,
    contentHostRef,
    openBook,
    turnPage,
    goToChapter,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setLineSpacing,
    setLetterSpacing,
    setContentWidth,
    setFontFamily,
    setPageTheme,
    setBrightness,
    setChromeTheme,
    setPageTurnAnimationStyle,
    previewSeek,
    seekToFraction,
    getBookDetails,
    getEpubInspectionData,
    getInspectorReaderBridge,
    findInspectionReferences,
    readInspectionFileText,
    getInspectionFilePreviewUrl,
    closeImageViewer,
    restoreContentFocus,
    getDiagnosticsText,
    addBookmark,
    toggleBookmark,
    refreshBookmarks,
    removeBookmark,
    goToBookmark,
    addHighlight,
    removeHighlight,
    setHighlightNote,
    setHighlightStyle,
    search,
    goToSearchResult,
    setSearchPanelState,
    goToHighlight,
    listEmbeddedAnnotations,
    goToReadOnlyAnnotation,
    exportAnnotations,
    importAnnotationsFile,
    dismissSelectionToolbar,
    dismissActiveHighlight,
    openHighlightPopup,
    dismissFootnotePopup,
    dismissError,
  };
}
