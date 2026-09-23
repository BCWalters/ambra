import { useId } from "react";
import type { FC } from "react";
import { Body1, Button, Subtitle2 } from "@fluentui/react-components";
import { HeadphonesRegular } from "@fluentui/react-icons";
import { CHROME_TOOLBAR_HEIGHT } from "../../components/ChromeToolbarStyles.js";
import { useTranslation } from "../../i18n/LocaleContext.js";
import { useChromeTheme } from "../ChromeThemeContext.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../chromeTheme.js";
import { LiveRegion } from "./LiveRegion.js";

export interface NarrationDiscoveryNoticeProps {
  onListen: () => void;
  onDismiss: () => void;
}

export const NarrationDiscoveryNotice: FC<NarrationDiscoveryNoticeProps> = ({
  onListen,
  onDismiss,
}) => {
  const t = useTranslation();
  const palette = useChromeTheme();
  const titleId = useId();

  return (
    <section
      data-narration-discovery
      role="region"
      aria-labelledby={titleId}
      style={{
        position: "absolute",
        top: CHROME_TOOLBAR_HEIGHT + 12,
        right: 16,
        width: "calc(100% - 32px)",
        maxWidth: 380,
        boxSizing: "border-box",
        zIndex: 7,
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${CHROME_BORDER}`,
        boxShadow: CHROME_SHADOW,
        background: palette.backgroundSolid,
        color: "var(--colorNeutralForeground1, #242424)",
        overflowWrap: "anywhere",
      }}
    >
      <Subtitle2 as="h2" id={titleId} block style={{ margin: "0 0 8px" }}>
        {t("narration.discoveryTitle")}
      </Subtitle2>
      <Body1 as="p" block style={{ margin: 0 }}>
        {t("narration.discoveryMessage")}
      </Body1>
      <LiveRegion
        text={`${t("narration.discoveryTitle")}. ${t("narration.discoveryMessage")}`}
        announcementId={0}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <Button
          appearance="primary"
          icon={<HeadphonesRegular />}
          onClick={onListen}
          style={{
            background: palette.accentForeground,
            color: "#fff",
            maxWidth: "100%",
            whiteSpace: "normal",
          }}
        >
          {t("narration.noticeListen")}
        </Button>
        <Button
          appearance="subtle"
          onClick={onDismiss}
          style={{ maxWidth: "100%", whiteSpace: "normal" }}
        >
          {t("narration.notNow")}
        </Button>
      </div>
    </section>
  );
};
