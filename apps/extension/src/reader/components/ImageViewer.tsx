import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Tooltip, useModalAttributes } from "@fluentui/react-components";
import { DismissRegular, ZoomInRegular, ZoomOutRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { ImageViewerState } from "../ReaderTypes.js";

export interface ImageViewerProps {
  /** `undefined` when the viewer should be closed. Unlike `TocPanel`/
   * `BookDetailsPanel`, this is *not* kept mounted-but-invisible while
   * closed — a lightbox like this has no state worth preserving between
   * opens (each open targets a specific, possibly different image), so
   * there's nothing an "always mounted" approach would buy here, unlike
   * a panel a reader might reopen to the same scroll position. */
  image: ImageViewerState | undefined;
  onRequestClose: () => void;
}

const FIT = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

// A keyed, unmounted session resets zoom, pan and dimensions on every new image.
export const ImageViewer: FC<ImageViewerProps> = ({ image, onRequestClose }) => {
  return image ? (
    <OpenImageViewer key={image.src} image={image} onRequestClose={onRequestClose} />
  ) : null;
};

const OpenImageViewer: FC<{
  image: ImageViewerState;
  onRequestClose: () => void;
}> = ({ image, onRequestClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<number>();
  const [view, setView] = useState(FIT);
  const [dragging, setDragging] = useState(false);
  const instructionsId = useId();
  const t = useTranslation();
  // Fluent contains Tab focus; the controller restores focus into the book iframe.
  const { modalAttributes } = useModalAttributes({
    trapFocus: true,
    legacyTrapFocus: true,
  });

  useEffect(() => {
    // Moves focus into the dialog on open — the element that triggered
    // it lives in a different document entirely (the sandboxed content
    // iframe), so there's no single natural "next" focus target the
    // browser would otherwise pick; the close button is the obvious,
    // always-present one.
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [image, onRequestClose]);

  const constrain = useCallback((next: typeof FIT): typeof FIT => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || next.scale === 1) return FIT;
    const maxX = Math.max(0, (img.clientWidth * next.scale - canvas.clientWidth * 0.9) / 2);
    const maxY = Math.max(0, (img.clientHeight * next.scale - canvas.clientHeight) / 2);
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const zoom = useCallback(
    (factor: number, point = { x: 0, y: 0 }) => {
      setView((previous) => {
        const scale = Math.max(1, Math.min(MAX_SCALE, previous.scale * factor));
        const ratio = scale / previous.scale;
        return constrain({
          scale,
          x: point.x - (point.x - previous.x) * ratio,
          y: point.y - (point.y - previous.y) * ratio,
        });
      });
    },
    [constrain],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    // React's wheel listener is passive: a native listener is needed to keep
    // trackpad pinch from zooming the browser and wheel from scrolling the book.
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-200, Math.min(200, event.deltaY * unit));
      zoom(Math.exp(-delta * 0.005), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => setView((previous) => constrain(previous)));
    observer.observe(canvas);
    observer.observe(imageRef.current!);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [constrain, zoom]);

  return (
    <div
      {...modalAttributes}
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || t("imageViewer.dialogAriaLabel")}
      aria-describedby={instructionsId}
      onClick={onRequestClose}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
        if (event.key === "+" || event.key === "=") zoom(ZOOM_STEP);
        else if (event.key === "-") zoom(1 / ZOOM_STEP);
        else if (event.key === "0") setView(FIT);
        else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          setView((previous) =>
            constrain({
              ...previous,
              x:
                previous.x +
                (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0),
              y: previous.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0),
            }),
          );
        } else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "grid",
        gridTemplateRows: "64px minmax(0, 1fr) auto",
        paddingBottom: 16,
        boxSizing: "border-box",
        background: "rgba(10, 8, 6, 0.82)",
        overflow: "hidden",
      }}
    >
      <div
        ref={canvasRef}
        style={{
          position: "relative",
          gridRow: 2,
          marginBottom: 16,
          // Fit to the reading pane, including any space taken by pinned panels
          // or a wrapped control row, rather than to the browser viewport.
          containerType: "size",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          touchAction: "none",
        }}
      >
        <img
          ref={imageRef}
          src={image.src}
          alt={image.alt}
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setAspectRatio(naturalWidth / naturalHeight);
            }
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            if (view.scale === 1 || event.button !== 0 || dragRef.current) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            drag.x = event.clientX;
            drag.y = event.clientY;
            setView((previous) =>
              constrain({ ...previous, x: previous.x + dx, y: previous.y + dy }),
            );
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onLostPointerCapture={() => {
            dragRef.current = undefined;
            setDragging(false);
          }}
          style={{
            width: aspectRatio ? `calc(100cqh * ${aspectRatio})` : undefined,
            height: "auto",
            maxWidth: "90%",
            maxHeight: "100%",
            objectFit: "contain",
            boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
            borderRadius: 4,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            cursor: view.scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
            userSelect: "none",
          }}
        />
      </div>
      <Tooltip content={t("highlight.close")} relationship="label">
        <Button
          ref={closeButtonRef}
          appearance="subtle"
          size="large"
          icon={<DismissRegular />}
          onClick={(event) => {
            // Without this, the click bubbles to the backdrop's own
            // onClick above, which is harmless (both close the viewer
            // anyway) but would also fire it *twice* for one click.
            event.stopPropagation();
            onRequestClose();
          }}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            color: "#f5f0e8",
            background: "rgba(255, 255, 255, 0.08)",
          }}
        />
      </Tooltip>
      <div
        role="group"
        aria-label={t("imageViewer.controls")}
        onClick={(event) => event.stopPropagation()}
        style={{
          gridRow: 3,
          justifySelf: "center",
          maxWidth: "calc(100% - 16px)",
          boxSizing: "border-box",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderRadius: 12,
          background: "rgba(20, 18, 16, 0.96)",
          color: "#f5f0e8",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
        }}
      >
        <Tooltip content={t("imageViewer.zoomOut")} relationship="label">
          <Button
            appearance="transparent"
            icon={<ZoomOutRegular />}
            aria-keyshortcuts="-"
            disabled={view.scale === 1}
            onClick={() => zoom(1 / ZOOM_STEP)}
            style={{ color: "inherit", opacity: view.scale === 1 ? 0.4 : 1 }}
          />
        </Tooltip>
        <output style={{ minWidth: 48, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(view.scale * 100)}%
        </output>
        <Tooltip content={t("imageViewer.zoomIn")} relationship="label">
          <Button
            appearance="transparent"
            icon={<ZoomInRegular />}
            aria-keyshortcuts="+ ="
            disabled={view.scale === MAX_SCALE}
            onClick={() => zoom(ZOOM_STEP)}
            style={{ color: "inherit", opacity: view.scale === MAX_SCALE ? 0.4 : 1 }}
          />
        </Tooltip>
        <Button
          appearance="transparent"
          aria-keyshortcuts="0"
          onClick={() => setView(FIT)}
          style={{ color: "inherit", minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}
        >
          {t("imageViewer.fit")}
        </Button>
      </div>
      <span
        id={instructionsId}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
        }}
      >
        {t("imageViewer.instructions")}
      </span>
    </div>
  );
};
