import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  const anchorRef = useRef<
    { x: number; y: number; fractionX: number; fractionY: number } | undefined
  >(undefined);
  const dragRef = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<number>();
  const [scale, setScale] = useState(1);
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

  const zoom = useCallback((factor: number, point?: { x: number; y: number }) => {
    const canvas = canvasRef.current!;
    const viewport = canvas.getBoundingClientRect();
    const image = imageRef.current!.getBoundingClientRect();
    const x = point?.x ?? viewport.left + canvas.clientWidth / 2;
    const y = point?.y ?? viewport.top + canvas.clientHeight / 2;
    anchorRef.current =
      image.width && image.height
        ? {
            x,
            y,
            fractionX: (x - image.left) / image.width,
            fractionY: (y - image.top) / image.height,
          }
        : undefined;
    setScale((previous) => Math.max(1, Math.min(MAX_SCALE, previous * factor)));
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const anchor = anchorRef.current;
    if (scale === 1) {
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    } else if (anchor) {
      const image = imageRef.current!.getBoundingClientRect();
      // Scroll offsets are the only pan state, including after native scrollbar
      // interaction. Keep the same image point under the zoom anchor.
      canvas.scrollLeft += image.left + anchor.fractionX * image.width - anchor.x;
      canvas.scrollTop += image.top + anchor.fractionY * image.height - anchor.y;
    }
    anchorRef.current = undefined;
  }, [scale]);

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
        x: event.clientX,
        y: event.clientY,
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [zoom]);

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
        else if (event.key === "0") setScale(1);
        else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          const canvas = canvasRef.current!;
          canvas.scrollLeft +=
            event.key === "ArrowLeft" ? -40 : event.key === "ArrowRight" ? 40 : 0;
          canvas.scrollTop += event.key === "ArrowUp" ? -40 : event.key === "ArrowDown" ? 40 : 0;
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
        style={{
          position: "relative",
          gridRow: 2,
          marginBottom: 16,
          // Fit to the reading pane, including any space taken by pinned panels
          // or a wrapped control row, rather than to the browser viewport.
          containerType: "size",
        }}
      >
        <div
          ref={canvasRef}
          onClick={(event) => {
            // A scrollbar click must not dismiss the viewer.
            if (event.target === event.currentTarget) event.stopPropagation();
          }}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "auto",
            colorScheme: "dark",
            overscrollBehavior: "contain",
            touchAction: "none",
          }}
        >
          <div
            style={{
              width: "max-content",
              minWidth: "100%",
              minHeight: "100%",
              display: "grid",
              placeItems: "center",
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
                if (scale === 1 || event.button !== 0 || dragRef.current) return;
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
                canvasRef.current!.scrollLeft -= dx;
                canvasRef.current!.scrollTop -= dy;
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
                width: aspectRatio
                  ? `calc(min(90cqw, 100cqh * ${aspectRatio}) * ${scale})`
                  : undefined,
                height: "auto",
                maxWidth: aspectRatio ? undefined : "90cqw",
                maxHeight: aspectRatio ? undefined : "100cqh",
                objectFit: "contain",
                boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
                borderRadius: 4,
                cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
                userSelect: "none",
              }}
            />
          </div>
        </div>
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
            disabled={scale === 1}
            onClick={() => zoom(1 / ZOOM_STEP)}
            style={{ color: "inherit", opacity: scale === 1 ? 0.4 : 1 }}
          />
        </Tooltip>
        <output style={{ minWidth: 48, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(scale * 100)}%
        </output>
        <Tooltip content={t("imageViewer.zoomIn")} relationship="label">
          <Button
            appearance="transparent"
            icon={<ZoomInRegular />}
            aria-keyshortcuts="+ ="
            disabled={scale === MAX_SCALE}
            onClick={() => zoom(ZOOM_STEP)}
            style={{ color: "inherit", opacity: scale === MAX_SCALE ? 0.4 : 1 }}
          />
        </Tooltip>
        <Button
          appearance="transparent"
          aria-keyshortcuts="0"
          onClick={() => setScale(1)}
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
