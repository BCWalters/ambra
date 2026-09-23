import { useEffect, useState } from "react";
import type { FC } from "react";
import { Body1, Button, Caption1, Link, Subtitle1 } from "@fluentui/react-components";
import { CopyRegular, MailRegular } from "@fluentui/react-icons";
import { AmbraMarkIcon } from "../reader/components/AmbraMarkIcon.js";
import { LibraryFlyout } from "./LibraryFlyout.js";
import { PaneCard, PaneDisclosure } from "../components/PaneSections.js";
import { useTranslation } from "../i18n/LocaleContext.js";

const GITHUB_REPO_URL = "https://github.com/BCWalters/ambra";
const PRIVACY_POLICY_URL =
  "https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md";
const EPUB_SPEC_URL = "https://www.w3.org/TR/epub-34/";
const PUBLISHING_WG_URL = "https://www.w3.org/publishing/groups/publ-wg/";
const REPORT_EMAIL = "AmbraEPUB@outlook.com";

/** Third-party runtime dependencies shipped in the extension. */
const OPEN_SOURCE_CREDITS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "React", url: "https://react.dev" },
  { name: "Fluent UI React Components", url: "https://react.fluentui.dev" },
  { name: "highlight.js", url: "https://highlightjs.org" },
  { name: "xml-formatter", url: "https://github.com/chrisbottin/xml-formatter" },
];

/** Environment information only: no book content or reading history. */
function collectEnvironmentInfo(): string {
  const manifest = chrome.runtime.getManifest();
  return [
    "Ambra environment info",
    `Generated: ${new Date().toISOString()}`,
    `Extension version: ${manifest.version}`,
    `User agent: ${navigator.userAgent}`,
    `Platform: ${navigator.platform || "(unknown)"}`,
    `Language: ${navigator.language}`,
  ].join("\n");
}

export interface AboutFlyoutProps {
  open: boolean;
  onRequestClose: () => void;
  backgroundSolid: string;
  accentForeground: string;
}

/** An in-place About pane packaged with the extension, not a separate website. */
export const AboutFlyout: FC<AboutFlyoutProps> = ({ open, onRequestClose, backgroundSolid, accentForeground }) => {
  const t = useTranslation();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const [copyError, setCopyError] = useState<string>();

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeout = setTimeout(() => setCopyState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [copyState]);

  const copyDiagnostics = async (): Promise<void> => {
    setCopyState("copying");
    setCopyError(undefined);
    try {
      await navigator.clipboard.writeText(collectEnvironmentInfo());
      setCopyState("copied");
    } catch (error) {
      setCopyState("idle");
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };

  const version = chrome.runtime.getManifest().version;

  return (
    <LibraryFlyout
      open={open}
      title={t("about.title")}
      onRequestClose={onRequestClose}
      backgroundSolid={backgroundSolid}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: 20, overflowWrap: "anywhere" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <AmbraMarkIcon size={48} />
          <div>
            <Subtitle1 as="p" block style={{ margin: 0 }}>
              Ambra
            </Subtitle1>
            <Caption1 as="p" block style={{ margin: "2px 0 0", opacity: 0.75 }}>
              {t("about.version", { version })}
            </Caption1>
          </div>
        </div>

        <Body1 as="p" block style={{ margin: "0 0 8px" }}>
          {t("about.description")}
        </Body1>
        <Caption1 as="p" block style={{ margin: "0 0 24px", opacity: 0.75 }}>
          {t("about.createdBy")} <span>Ben Walters</span>
        </Caption1>

        <PaneCard title={t("about.helpShape")}>
          <Button
            as="a"
            href={`mailto:${REPORT_EMAIL}`}
            target="_blank"
            rel="noreferrer"
            appearance="primary"
            icon={<MailRegular />}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "10px 12px",
              textAlign: "left",
              background: accentForeground,
              borderColor: accentForeground,
              color: "#fff",
            }}
          >
            {t("about.feedback")}
          </Button>
          <Caption1 as="p" block style={{ margin: "8px 0 16px", opacity: 0.75 }}>
            {REPORT_EMAIL}
          </Caption1>
          <Button
            appearance="secondary"
            size="small"
            icon={<CopyRegular />}
            disabled={copyState === "copying"}
            onClick={() => void copyDiagnostics()}
            style={{
              background: backgroundSolid,
              borderColor: "rgba(15, 23, 42, 0.22)",
              boxShadow: "0 1px 3px rgba(15, 23, 42, 0.16)",
              color: "inherit",
            }}
          >
            {copyState === "copied" ? t("about.copied") : copyState === "copying" ? t("about.copying") : t("about.copyDiagnostics")}
          </Button>
          <Caption1 as="p" block style={{ margin: "8px 0 0", opacity: 0.75 }}>
            {t("about.diagnosticsHint")}
          </Caption1>
          {copyError && <Body1 as="p" block role="alert" style={{ margin: "12px 0 0" }}>{t("about.copyError")} {copyError}</Body1>}
        </PaneCard>

        <div style={{ margin: "20px 0" }}>
          <Body1 as="p" block style={{ margin: "0 0 8px" }}>{t("about.localLibrary")}</Body1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            <Link href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">{t("about.privacy")}</Link>
            <Link href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">{t("about.sourceCode")}</Link>
          </div>
        </div>

        <PaneDisclosure title={t("about.standards")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href={EPUB_SPEC_URL} target="_blank" rel="noreferrer">{t("about.epubSpec")}</Link>
            <Link href={PUBLISHING_WG_URL} target="_blank" rel="noreferrer">{t("about.publishingGroup")}</Link>
            <Caption1 as="p" block style={{ margin: "8px 0 0" }}>{t("about.openSourceCredits")}</Caption1>
            {OPEN_SOURCE_CREDITS.map((credit) => (
              <Link key={credit.name} href={credit.url} target="_blank" rel="noreferrer">{credit.name}</Link>
            ))}
          </div>
        </PaneDisclosure>
      </div>
    </LibraryFlyout>
  );
};
