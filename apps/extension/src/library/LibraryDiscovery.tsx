import { useId } from "react";
import type { FC } from "react";
import { Link } from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
import { CHROME_BORDER } from "../reader/chromeTheme.js";
import { useTranslation } from "../i18n/LocaleContext.js";

const SOURCES = [
  {
    name: "Standard Ebooks",
    href: "https://standardebooks.org/ebooks",
    description: "library.standardEbooksDescription" as const,
    download: "library.standardEbooksDownload" as const,
  },
  {
    name: "Project Gutenberg",
    href: "https://www.gutenberg.org/ebooks/",
    description: "library.gutenbergDescription" as const,
    download: "library.gutenbergDownload" as const,
  },
  {
    name: "ReadBeyond",
    href: "https://www.readbeyond.it/ebooks.html",
    description: "library.readBeyondDescription" as const,
    download: "library.readBeyondDownload" as const,
  },
  {
    name: "eBooks.com",
    href: "https://www.ebooks.com/drm-free-epub",
    description: "library.ebooksComDescription" as const,
    download: "library.ebooksComDownload" as const,
  },
];

/** The first-run choice card and the quieter populated-library entry share one panel. */
export const LibraryDiscovery: FC<{
  expanded?: boolean;
  panelId?: string;
  importLabel?: string;
}> = ({ expanded = true, panelId, importLabel }) => {
  const t = useTranslation();
  const id = useId();
  const sectionId = panelId ?? `${id}-panel`;

  return (
    <div style={{ width: "100%", textAlign: "left" }}>
      <section
        id={sectionId}
        aria-labelledby={`${id}-heading`}
        hidden={!expanded}
        style={{
          maxWidth: 720,
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
                {source.name} <OpenRegular aria-hidden="true" style={{ verticalAlign: "middle" }} />
              </Link>
              <p style={{ margin: "4px 0 0", color: "var(--colorNeutralForeground2, #555)" }}>
                {t(source.description)}
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: "18px", color: "var(--colorNeutralForeground2, #555)" }}>
                {t(source.download)}
              </p>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 14, margin: "20px 0 8px" }}>{t("library.discoverySteps")}</h3>
        <ol style={{ paddingLeft: 22, margin: 0, display: "grid", gap: 6 }}>
          <li>{t("library.discoveryDownload")}</li>
          <li>
            {t("library.discoveryImport", { importLabel: importLabel ?? t("library.importEpub"), extension: ".epub" })}
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
