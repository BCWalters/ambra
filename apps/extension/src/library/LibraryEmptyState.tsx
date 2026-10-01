import type { FC } from "react";
import { Body1, Title2 } from "@fluentui/react-components";
import { LibraryEmptyIllustration } from "./LibraryEmptyIllustration.js";
import { useTranslation } from "../i18n/LocaleContext.js";

export const LibraryEmptyState: FC<{ accent: string; compact?: boolean }> = ({ accent, compact = false }) => {
  const t = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
      maxWidth: 520, margin: compact ? "8px auto" : "48px auto", gap: 8 }}>
      <LibraryEmptyIllustration size={compact ? 56 : 104} />
      <Title2 as="h2" style={{ color: accent, margin: 0, fontSize: compact ? 20 : undefined }}>
        {t("library.emptyTitle")}
      </Title2>
      <Body1 as="p" style={{ margin: 0, color: "var(--colorNeutralForeground2)" }}>
        {t("library.emptyDescription")}
      </Body1>
    </div>
  );
};
