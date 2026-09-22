import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
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

/**
 * A full-viewport lightbox for a single in-book image — opened by
 * `ReaderController.setUpContentInteraction`'s click/keyboard handlers on
 * any image at least 100×100 rendered px (see `MIN_ZOOMABLE_IMAGE_SIZE`),
 * so a reader can see a real illustration at a larger, unconstrained size
 * than the page layout (and the new page-height cap — see issue #16)
 * otherwise allows, without that same cap ever applying to small
 * decorative icons/separators, which never qualify to open this at all.
 *
 * Images scale to fit 90vw/90vh, including enlargement beyond their
 * intrinsic size. The image element itself keeps the image's aspect
 * ratio, so the surrounding backdrop remains clickable even for very
 * wide or tall images. Viewport units also keep the fit responsive to
 * window resizing without a resize listener.
 */
export const ImageViewer: FC<ImageViewerProps> = ({ image, onRequestClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [loadedImage, setLoadedImage] = useState<{ src: string; aspectRatio: number }>();
  const t = useTranslation();

  useEffect(() => {
    if (!image) {
      return;
    }
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

  if (!image) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || t("imageViewer.dialogAriaLabel")}
      onClick={onRequestClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10, 8, 6, 0.82)",
      }}
    >
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
      <img
        key={image.src}
        src={image.src}
        alt={image.alt}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) {
            setLoadedImage({ src: image.src, aspectRatio: naturalWidth / naturalHeight });
          }
        }}
        onClick={(event) => {
          // A click *on the image itself* shouldn't close the viewer —
          // only the surrounding backdrop should, matching how a real
          // lightbox distinguishes "dismiss" from "look closer."
          event.stopPropagation();
        }}
        style={{
          width: loadedImage?.src === image.src ? `${90 * loadedImage.aspectRatio}vh` : undefined,
          height: "auto",
          maxWidth: "90vw",
          maxHeight: "90vh",
          objectFit: "contain",
          boxShadow: "0 8px 40px rgba(0, 0, 0, 0.5)",
          borderRadius: 4,
        }}
      />
    </div>
  );
};
