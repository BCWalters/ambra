import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { ReaderController } from "./ReaderController.js";
import type { ReaderSnapshot, ViewMode } from "./ReaderController.js";

export interface UseReaderControllerResult {
  snapshot: ReaderSnapshot | undefined;
  contentHostRef: RefObject<HTMLDivElement | null>;
  openBuffer: (buffer: ArrayBuffer) => Promise<void>;
  turnPage: (direction: 1 | -1) => void;
  goToChapter: (direction: 1 | -1) => void;
  goToNavPoint: (navPoint: Parameters<ReaderController["goToNavPoint"]>[0]) => void;
  setViewMode: (mode: ViewMode) => void;
}

/** Bridges `ReaderController` (a plain, framework-agnostic class) into
 * React: owns the controller instance for the current book, subscribes
 * to it via `useSyncExternalStore` so components re-render on every state
 * change, and wires a `ResizeObserver` on the content host's container
 * element so the reading surface relayouts (preserving position) as the
 * reader pane's size changes. */
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

    return () => {
      observer.disconnect();
      controller.dispose();
    };
  }, [controller]);

  const openBuffer = useCallback(async (buffer: ArrayBuffer): Promise<void> => {
    const opened = await ReaderController.open(buffer);
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

  return { snapshot, contentHostRef, openBuffer, turnPage, goToChapter, goToNavPoint, setViewMode };
}
