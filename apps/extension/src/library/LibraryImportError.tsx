import type { FC } from "react";
import { Body1, Button, Caption1 } from "@fluentui/react-components";
import { BookTroubleIllustration } from "../reader/components/BookTroubleIllustration.js";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";

export interface LibraryImportErrorProps {
  message: string;
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
export const LibraryImportError: FC<LibraryImportErrorProps> = ({ message, onDismiss }) => (
  <div
    role="alert"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 18px",
      marginBottom: 16,
      borderRadius: 8,
      background: "var(--colorNeutralBackground1, #fff)",
      border: `1px solid ${CHROME_BORDER}`,
      boxShadow: CHROME_SHADOW,
    }}
  >
    <BookTroubleIllustration size={48} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <Body1 as="p" style={{ margin: 0, fontWeight: 600 }}>
        Oh snickerdoodles, something went wrong.
      </Body1>
      <Caption1 as="p" style={{ margin: "2px 0 0", opacity: 0.75 }}>
        {message}
      </Caption1>
    </div>
    <Button appearance="subtle" size="small" onClick={onDismiss}>
      Dismiss
    </Button>
  </div>
);
