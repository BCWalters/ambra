import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { FontFamilyChoice, PageTheme } from "@ambra/engine";
import type { HighlightStyle } from "@ambra/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import type { Bookmark } from "../library/LibraryDatabase.js";
import { ReaderController } from "./ReaderController.js";
import type { BookDetails, EpubInspectionData, ReaderSnapshot, ViewMode } from "./ReaderController.js";
import type { ChromeThemeChoice } from "./chromeTheme.js";
import type { PageTurnAnimationStyle } from "./PageTurnAnimationStyle.js";

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
  setChromeTheme: (theme: ChromeThemeChoice) => void;
  setPageTurnAnimationStyle: (style: PageTurnAnimationStyle) => void;
  previewSeek: (fraction: number) => { label: string; chapterLabel: string };
  seekToFraction: (fraction: number) => Promise<void>;
  getBookDetails: () => Promise<BookDetails | undefined>;
  getEpubInspectionData: () => EpubInspectionData | undefined;
  readInspectionFileText: (path: string) => Promise<string>;
  closeImageViewer: () => void;
  restoreContentFocus: () => void;
  getDiagnosticsText: () => string | undefined;
  addBookmark: () => Promise<Bookmark | undefined>;
  toggleBookmark: () => Promise<void>;
  listBookmarks: () => Promise<Bookmark[]>;
  removeBookmark: (id: string) => Promise<void>;
  goToBookmark: (cfi: string) => Promise<void>;
  addHighlight: (style: HighlightStyle) => Promise<void>;
  removeHighlight: (id: string) => Promise<void>;
  setHighlightNote: (id: string, note: string | undefined) => Promise<void>;
  search: (query: string) => void;
  goToSearchResult: (cfi: string) => Promise<void>;
  goToHighlight: (cfi: string) => Promise<void>;
  dismissSelectionToolbar: () => void;
  dismissActiveHighlight: () => void;
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
export function useReaderController(): UseReaderControllerResult {
  const [controller, setController] = useState<ReaderController | null>(null);
  const contentHostRef = useRef<HTMLDivElement | null>(null);

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
      return controller?.previewSeek(fraction) ?? { label: "", chapterLabel: "" };
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
    async (style: HighlightStyle) => {
      await controller?.addHighlight(style);
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
    setChromeTheme,
    setPageTurnAnimationStyle,
    previewSeek,
    seekToFraction,
    getBookDetails,
    getEpubInspectionData,
    readInspectionFileText,
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
    search,
    goToSearchResult,
    goToHighlight,
    dismissSelectionToolbar,
    dismissActiveHighlight,
    dismissError,
  };
}
