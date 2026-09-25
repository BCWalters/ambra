import type { FC } from "react";
import { Body1, Button } from "@fluentui/react-components";
import { BookTroubleIllustration } from "../reader/components/BookTroubleIllustration.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import { ErrorDetails } from "../components/ErrorDetails.js";

export interface LibraryImportErrorProps {
  message: string;
  headline?: string;
  onDismiss: () => void;
}

/**
 * A themed import-failure surface for the Library page (issue #106) —
 * previously a bare "Error: {message}" line in plain red text, which
 * read like the extension itself was broken rather than matching the
 * reader's own friendly, "we know things sometimes go wrong" tone (see
 * `FriendlyError`). Deliberately a smaller, inline card rather than a
 * full-bleed blocking screen: an import failure never removes anything
 * already in the library, so there's no reason to hide the rest of the
 * page behind it the way the reader's own "blocking" severity does.
 */
export const LibraryImportError: FC<LibraryImportErrorProps> = ({ message, headline, onDismiss }) => {
  const t = useTranslation();
  return (
  <div
    role="alert"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 18px",
      margin: "0 auto 16px",
      width: "100%",
      maxWidth: 600,
      boxSizing: "border-box",
      borderRadius: 8,
      background: "var(--colorNeutralBackground1, #fff)",
      border: `1px solid ${CHROME_BORDER}`,
      boxShadow: CHROME_SHADOW,
    }}
  >
    <BookTroubleIllustration size={48} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <Body1 as="p" block style={{ margin: 0, fontWeight: 600 }}>
        {headline ?? t("error.somethingWentWrongHeadline")}
      </Body1>
      <ErrorDetails style={{ marginTop: 4 }}>
        {message}
      </ErrorDetails>
    </div>
    <Button appearance="subtle" size="small" onClick={onDismiss}>
      {t("library.dismiss")}
    </Button>
  </div>
  );
};
