import { useEffect, useRef, useState } from "react";

export interface LibraryFileDropOptions {
  enabled: boolean;
  canImport: boolean;
  busy: boolean;
  importFiles: (files: readonly File[]) => Promise<void>;
}

function containsFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && (
    Array.from(transfer.types).includes("Files") ||
    Array.from(transfer.items ?? []).some((item) => item.kind === "file") ||
    transfer.files.length > 0
  );
}

/** File drops share the picker import pipeline; this hook never parses or filters books. */
export function useLibraryFileDrop({ enabled, canImport, busy, importFiles }: LibraryFileDropOptions) {
  const dropTargetRef = useRef<HTMLDivElement>(null);
  const pendingImport = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const target = dropTargetRef.current;
    if (!enabled || !target) return;
    const owner = target.ownerDocument;
    const view = owner.defaultView;
    let depth = 0;
    const available = canImport && !busy;
    const inside = (event: DragEvent): boolean =>
      event.target instanceof Node && target.contains(event.target);
    const reset = (): void => { depth = 0; setDragging(false); };
    const indicate = (event: DragEvent): void => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = available && !pendingImport.current && inside(event) ? "copy" : "none";
    };
    const onEnter = (event: DragEvent): void => {
      if (!containsFiles(event.dataTransfer)) return;
      indicate(event);
      if (!inside(event)) return;
      depth++;
      setDragging(available && !pendingImport.current);
    };
    const onOver = (event: DragEvent): void => {
      if (!containsFiles(event.dataTransfer)) return;
      indicate(event);
      if (inside(event)) depth = Math.max(1, depth);
      setDragging(available && !pendingImport.current && inside(event));
    };
    const onLeave = (event: DragEvent): void => {
      if (!depth) return;
      const leftDocument = !event.relatedTarget && (
        event.target === owner || event.target === owner.documentElement ||
        event.clientX <= 0 || event.clientY <= 0 ||
        event.clientX >= (view?.innerWidth ?? Infinity) || event.clientY >= (view?.innerHeight ?? Infinity)
      );
      if (leftDocument) { reset(); return; }
      if (!inside(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) reset();
    };
    const onDrop = (event: DragEvent): void => {
      reset();
      if (!containsFiles(event.dataTransfer)) return;
      // Capture on the document also prevents navigation when a child stops propagation,
      // or when a file is dropped outside the surface while import is unavailable.
      event.preventDefault();
      if (!inside(event) || !available || pendingImport.current) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      pendingImport.current = true;
      void importFiles(files).finally(() => { pendingImport.current = false; });
    };
    const onVisibilityChange = (): void => { if (owner.hidden) reset(); };
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === "Escape") reset(); };
    owner.addEventListener("dragenter", onEnter, true);
    owner.addEventListener("dragover", onOver, true);
    owner.addEventListener("dragleave", onLeave, true);
    owner.addEventListener("drop", onDrop, true);
    owner.addEventListener("dragend", reset, true);
    owner.addEventListener("keydown", onKeyDown, true);
    owner.addEventListener("visibilitychange", onVisibilityChange);
    view?.addEventListener("blur", reset);
    view?.addEventListener("pagehide", reset);
    return () => {
      owner.removeEventListener("dragenter", onEnter, true);
      owner.removeEventListener("dragover", onOver, true);
      owner.removeEventListener("dragleave", onLeave, true);
      owner.removeEventListener("drop", onDrop, true);
      owner.removeEventListener("dragend", reset, true);
      owner.removeEventListener("keydown", onKeyDown, true);
      owner.removeEventListener("visibilitychange", onVisibilityChange);
      view?.removeEventListener("blur", reset);
      view?.removeEventListener("pagehide", reset);
      reset();
    };
  }, [enabled, canImport, busy, importFiles]);

  return { dropTargetRef, isDraggingFiles: enabled && canImport && !busy && dragging };
}
