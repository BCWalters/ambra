import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { FontFamilyChoice, PageTheme } from "@pagina/engine";
import type { LibraryDatabase } from "../library/LibraryDatabase.js";
import { ReaderController } from "./ReaderController.js";
import type { BookDetails, ReaderSnapshot, ViewMode } from "./ReaderController.js";

export interface UseReaderControllerResult {
  snapshot: ReaderSnapshot | undefined;
  contentHostRef: RefObject<HTMLDivElement | null>;
  openBook: (buffer: ArrayBuffer, bookId: string, library: LibraryDatabase) => Promise<void>;
  turnPage: (direction: 1 | -1) => void;
  goToChapter: (direction: 1 | -1) => void;
  goToNavPoint: (navPoint: Parameters<ReaderController["goToNavPoint"]>[0]) => void;
  setViewMode: (mode: ViewMode) => void;
  setFontScale: (scale: number) => void;
  setFontFamily: (family: FontFamilyChoice) => void;
  setPageTheme: (theme: PageTheme) => void;
  previewSeek: (fraction: number) => { label: string; chapterLabel: string };
  seekToFraction: (fraction: number) => Promise<void>;
  getBookDetails: () => Promise<BookDetails | undefined>;
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
    useCallback((listener: () => void) => (controller ? controller.subscribe(listener) : () => undefined), [controller]),
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

  const openBook = useCallback(async (buffer: ArrayBuffer, bookId: string, library: LibraryDatabase): Promise<void> => {
    const opened = await ReaderController.open(buffer, bookId, library);
    setController(opened);
  }, []);

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

  return {
    snapshot,
    contentHostRef,
    openBook,
    turnPage,
    goToChapter,
    goToNavPoint,
    setViewMode,
    setFontScale,
    setFontFamily,
    setPageTheme,
    previewSeek,
    seekToFraction,
    getBookDetails,
  };
}
