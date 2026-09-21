import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { FontFamilyChoice, PageTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark } from "../library/LibraryDatabase.js";
import { ReaderController } from "./ReaderController.js";
import type { BookDetails, EpubInspectionData, PreviewPosition, ReaderSnapshot } from "./ReaderTypes.js";
import type { ViewMode } from "./ViewMode.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";
import type { Translate } from "../i18n/LocaleContext.js";

export interface UseReaderControllerResult {
  snapshot: ReaderSnapshot | undefined;
  contentHostRef: RefObject<HTMLDivElement | null>;
  openBook: (buffer: ArrayBuffer, bookId: string, library: LibraryDatabase) => Promise<void>;
  turnPage: (direction: 1 | -1) => void;
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
  seekToFraction: (fraction: number) => Promise<void>;
  getBookDetails: () => Promise<BookDetails | undefined>;
  getEpubInspectionData: () => EpubInspectionData | undefined;
  readInspectionFileText: (path: string) => Promise<string>;
  getInspectionFilePreviewUrl: (path: string, mediaType: string) => Promise<string>;
  closeImageViewer: () => void;
  restoreContentFocus: () => void;
  getDiagnosticsText: () => string | undefined;
  addBookmark: () => Promise<Bookmark | undefined>;
  toggleBookmark: () => Promise<void>;
  listBookmarks: () => Promise<Bookmark[]>;
  removeBookmark: (id: string) => Promise<void>;
  goToBookmark: (cfi: string) => Promise<void>;
  addHighlight: (style: HighlightStyle, openNoteEditor?: boolean) => Promise<void>;
  removeHighlight: (id: string) => Promise<void>;
  setHighlightNote: (id: string, note: string | undefined) => Promise<void>;
  setHighlightStyle: (id: string, style: HighlightStyle) => Promise<void>;
  search: (query: string) => void;
  goToSearchResult: (cfi: string) => Promise<void>;
  setSearchPanelState: (open: boolean, pinned: boolean) => void;
  goToHighlight: (cfi: string) => Promise<void>;
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
    void controller.mount(containerEl, rect.width, rect.height);

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
      const opened = await ReaderController.open(buffer, bookId, library);
      setController(opened);
    },
    [],
  );

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
      void controller?.setViewMode(mode);
    },
    [controller],
  );

  const setFontScale = useCallback(
    (scale: number) => {
      void controller?.setFontScale(scale);
    },
    [controller],
  );

  const setLineSpacing = useCallback(
    (spacing: number) => {
      void controller?.setLineSpacing(spacing);
    },
    [controller],
  );

  const setLetterSpacing = useCallback(
    (spacing: number) => {
      void controller?.setLetterSpacing(spacing);
    },
    [controller],
  );

  const setContentWidth = useCallback(
    (widthEm: number) => {
      void controller?.setContentWidth(widthEm);
    },
    [controller],
  );

  const setFontFamily = useCallback(
    (family: FontFamilyChoice) => {
      void controller?.setFontFamily(family);
    },
    [controller],
  );

  const setPageTheme = useCallback(
    (theme: PageTheme) => {
      void controller?.setPageTheme(theme);
    },
    [controller],
  );

  const setBrightness = useCallback(
    (brightness: number) => {
      void controller?.setBrightness(brightness);
    },
    [controller],
  );

  const setChromeTheme = useCallback(
    (theme: ChromeThemeChoice) => {
      void controller?.setChromeTheme(theme);
    },
    [controller],
  );

  const setPageTurnAnimationStyle = useCallback(
    (style: PageTurnAnimationStyle) => {
      void controller?.setPageTurnAnimationStyle(style);
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
    async (fraction: number): Promise<void> => {
      await controller?.seekToFraction(fraction);
    },
    [controller],
  );

  const getBookDetails = useCallback(async () => {
    return controller?.getBookDetails();
  }, [controller]);

  const getEpubInspectionData = useCallback(() => {
    return controller?.getEpubInspectionData();
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

  const listBookmarks = useCallback(async () => {
    return (await controller?.listBookmarks()) ?? [];
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
      await controller?.setHighlightNote(id, note);
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
    readInspectionFileText,
    getInspectionFilePreviewUrl,
    closeImageViewer,
    restoreContentFocus,
    getDiagnosticsText,
    addBookmark,
    toggleBookmark,
    listBookmarks,
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
    dismissSelectionToolbar,
    dismissActiveHighlight,
    openHighlightPopup,
    dismissFootnotePopup,
    dismissError,
  };
}
