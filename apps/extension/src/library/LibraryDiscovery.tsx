import { useId, useState } from "react";
import type { FC } from "react";
import { Button, Link } from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { CHROME_BORDER } from "../reader/chromeTheme.js";
import { useTranslation } from "../i18n/LocaleContext.js";

const SOURCES = [
  {
    name: "Project Gutenberg",
    href: "https://www.gutenberg.org/ebooks/",
    description: "library.gutenbergDescription" as const,
  },
  {
    name: "Standard Ebooks",
    href: "https://standardebooks.org/ebooks",
    description: "library.standardEbooksDescription" as const,
  },
  {
    name: "ReadBeyond",
    href: "https://www.readbeyond.it/ebooks.html",
    description: "library.readBeyondDescription" as const,
  },
];

/** Discovery is always visible before the first import, then available on demand at any library size. */
export const LibraryDiscovery: FC<{ expandable?: boolean }> = ({ expandable = false }) => {
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const id = useId();

  return (
    <div style={{ width: "100%", textAlign: "left" }}>
      {expandable && (
        <Button
          appearance="subtle"
          size="small"
          icon={<SearchRegular />}
          aria-expanded={expanded}
          aria-controls={`${id}-panel`}
          onClick={() => setExpanded(!expanded)}
        >
          {t("library.findBooks")}
        </Button>
      )}
      <section
        id={`${id}-panel`}
        aria-labelledby={`${id}-heading`}
        hidden={expandable && !expanded}
        style={{
          maxWidth: 600,
          marginTop: expandable ? 12 : 0,
          padding: 16,
          border: `1px solid ${CHROME_BORDER}`,
          borderRadius: 8,
          background: "var(--colorNeutralBackground2, #fafafa)",
        }}
      >
        <h2 id={`${id}-heading`} style={{ fontSize: 18, lineHeight: "24px", margin: "0 0 4px" }}>
          {t("library.discoveryTitle")}
        </h2>
        <p style={{ margin: "0 0 16px", color: "var(--colorNeutralForeground2, #555)" }}>
          {t("library.discoveryDescription")}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
            gap: 16,
          }}
        >
          {SOURCES.map((source) => (
            <div key={source.href}>
              <Link
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 600 }}
              >
                {source.name}
              </Link>
              <p style={{ margin: "4px 0 0", color: "var(--colorNeutralForeground2, #555)" }}>
                {t(source.description)}
              </p>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>{t("library.discoverySteps")}</h3>
        <ol style={{ paddingLeft: 22, margin: 0, display: "grid", gap: 6 }}>
          <li>{t("library.discoveryDownload")}</li>
          <li>
            {t("library.discoveryImport", { importLabel: t("library.importEpub"), extension: ".epub" })}
          </li>
        </ol>
        <p
          style={{
            fontSize: 12,
            lineHeight: "18px",
            margin: "16px 0 0",
            color: "var(--colorNeutralForeground3, #666)",
          }}
        >
          {t("library.discoveryNotice")}
        </p>
      </section>
    </div>
  );
};
