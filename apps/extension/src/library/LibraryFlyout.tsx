import { useId } from "react";
import type { FC, ReactNode } from "react";
import { Body1Strong, Button, OverlayDrawer, Tooltip, useRestoreFocusSource } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";
import { useTranslation } from "../i18n/LocaleContext.js";

interface LibraryFlyoutProps {
  open: boolean;
  title: string;
  onRequestClose: () => void;
  backgroundSolid: string;
  children: ReactNode;
}

/** Keep modal focus, Escape, and focus restoration in Fluent's dialog implementation. */
export const LibraryFlyout: FC<LibraryFlyoutProps> = ({
  open,
  title,
  onRequestClose,
  backgroundSolid,
  children,
}) => {
  const t = useTranslation();
  const titleId = useId();
  const restoreFocusSource = useRestoreFocusSource();
  return (
    <OverlayDrawer
      {...restoreFocusSource}
      open={open}
      position="end"
      aria-labelledby={titleId}
      onOpenChange={(_event, data) => {
        if (!data.open) onRequestClose();
      }}
      backdrop={{ style: { background: "rgba(15, 23, 42, 0.18)" } }}
      style={{
        width: 360,
        maxWidth: "90vw",
        padding: 0,
        background: backgroundSolid,
        backdropFilter: "blur(16px)",
        borderLeft: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          boxSizing: "border-box",
          gap: 4,
          padding: "10px 8px 10px 14px",
          borderBottom: `1px solid ${CHROME_BORDER}`,
        }}
      >
        <Body1Strong as="h2" id={titleId} style={{ flex: 1, margin: 0 }}>
          {title}
        </Body1Strong>
        <Tooltip content={t("highlight.close")} relationship="label">
          <Button
            appearance="subtle"
            size="small"
            icon={<DismissRegular />}
            onClick={onRequestClose}
          />
        </Tooltip>
      </div>
      {children}
    </OverlayDrawer>
  );
};
