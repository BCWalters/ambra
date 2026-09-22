import type { FC } from "react";
import { Body1, Button, Title2 } from "@fluentui/react-components";
import { DocumentAddRegular } from "@fluentui/react-icons";
import { LibraryEmptyIllustration } from "./LibraryEmptyIllustration.js";
import { LibraryDiscovery } from "./LibraryDiscovery.js";

export interface LibraryEmptyStateProps {
  accent: string;
  onImport: () => void;
}

/**
 * The Library's empty state (issue #124) — shown in place of the book
 * grid when there are no books yet. Replaces the previous single line
 * of plain body text with an illustration, a friendlier heading, and
 * its own prominent import button so a first-time user has an obvious,
 * inviting way to get started right where they're looking, rather than
 * only in the toolbar above.
 */
export const LibraryEmptyState: FC<LibraryEmptyStateProps> = ({ accent, onImport }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      maxWidth: 600,
      margin: "20px auto 0",
      gap: 4,
    }}
  >
    <LibraryEmptyIllustration size={140} />
    <Title2 as="h1" style={{ color: accent, margin: "8px 0 0" }}>
      Your library is empty
    </Title2>
    <Body1 as="p" style={{ margin: "4px 0 20px", color: "var(--colorNeutralForeground3, #666)" }}>
      Import your first EPUB to start reading.
    </Body1>
    <Button appearance="primary" icon={<DocumentAddRegular />} onClick={onImport}>
      Import your first book
    </Button>
    <div style={{ width: "100%", marginTop: 28 }}>
      <LibraryDiscovery />
    </div>
  </div>
);
