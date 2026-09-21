import { useEffect, useRef } from "react";
import type { FC } from "react";
import { Body1, Button, Tooltip } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { FootnotePopupState } from "../ReaderTypes.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useClampedPopupOffset } from "../useClampedPopupOffset.js";

export interface FootnotePopupProps {
  /** `undefined` when nothing's currently open — see
   * `ReaderController`'s `epub:type="noteref"` click handling. */
  state: FootnotePopupState | undefined;
  onDismiss: () => void;
}

/**
 * A small floating popup showing an `epub:type="noteref"` link's target
 * content (its footnote/endnote) inline, instead of navigating there and
 * leaving the reader to find their way back. Deliberately read-only and
 * dismiss-only — unlike `HighlightActionPopup`, there's nothing here to
 * edit. Positioned at the click point, clamped fully on-screen the same
 * way every other content-anchored popup here is.
 */
export const FootnotePopup: FC<FootnotePopupProps> = ({ state, onDismiss }) => {
  const chromeTheme = useChromeTheme();
  const t = useTranslation();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const clampOffset = useClampedPopupOffset(
    popupRef,
    state ? { left: state.left, top: state.top } : undefined,
    10,
    [],
  );

  useEffect(() => {
    if (!state) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state, onDismiss]);

  // Moves focus into the popup (the parent document, not the content
  // iframe) so an immediate Escape actually reaches this dialog's own
  // listener above — the click that opened this popup happened inside
  // the content iframe, a separate browsing context whose own keydown
  // events never bubble up to the parent document at all.
  useEffect(() => {
    if (state) {
      popupRef.current?.focus();
    }
  }, [state?.left, state?.top]);

  if (!state) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={t("footnote.dialogAriaLabel")}
      tabIndex={-1}
      style={{
        position: "fixed",
        left: state.left,
        top: state.top,
        transform: `translate(calc(-50% + ${clampOffset.x}px), calc(-100% - 10px + ${clampOffset.y}px))`,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 10,
        minWidth: 220,
        maxWidth: 360,
        background: chromeTheme.backgroundSolid,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Body1 as="p" block style={{ margin: 0, flex: 1, whiteSpace: "pre-wrap" }}>
          {state.content}
        </Body1>
        <Tooltip content={t("footnote.close")} relationship="label">
          <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onDismiss} />
        </Tooltip>
      </div>
    </div>
  );
};
