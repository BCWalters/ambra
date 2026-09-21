import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Button } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { useTranslation } from "../../i18n/LocaleContext.js";
import type { ImageViewerState } from "../ReaderController.js";

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
 * `object-fit: contain` inside a `max-width/max-height: 90vw/90vh` box is
 * the whole "zoom" model for now: a bigger, unconstrained view of the
 * same image, not a true pan/pinch-zoom-beyond-100% viewer — real
 * illustrations in reflowable EPUBs are typically raster images with no
 * more actual detail to reveal past "as large as comfortably fits the
 * screen," so a pan/zoom-beyond-fit interaction wasn't judged worth the
 * added complexity for this pass.
 */
export const ImageViewer: FC<ImageViewerProps> = ({ image, onRequestClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
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
      <Button
        ref={closeButtonRef}
        appearance="subtle"
        size="large"
        icon={<DismissRegular />}
        aria-label={t("highlight.close")}
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
      <img
        src={image.src}
        alt={image.alt}
        onClick={(event) => {
          // A click *on the image itself* shouldn't close the viewer —
          // only the surrounding backdrop should, matching how a real
          // lightbox distinguishes "dismiss" from "look closer."
          event.stopPropagation();
        }}
        style={{
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
