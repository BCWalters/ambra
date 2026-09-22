import { useEffect, useRef, useState } from "react";
import type { FC } from "react";
import { Body1, Body1Strong, Button, Caption1, Link, Tooltip } from "@fluentui/react-components";
import { CopyRegular, DismissRegular } from "@fluentui/react-icons";
import { CHROME_BORDER, CHROME_SHADOW } from "../reader/chromeTheme.js";
import { AmbraMarkIcon } from "../reader/components/AmbraMarkIcon.js";

const GITHUB_REPO_URL = "https://github.com/BCWalters/ambra";
const PRIVACY_POLICY_URL = "https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md";
const EPUB_SPEC_URL = "https://www.w3.org/TR/epub-34/";
const PUBLISHING_WG_URL = "https://www.w3.org/publishing/groups/publ-wg/";
const REPORT_EMAIL = "AmbraEPUB@outlook.com";

/** Third-party runtime dependencies actually shipped in the built
 * extension bundle (see `apps/extension/package.json`'s own
 * `dependencies`, not `devDependencies` — nothing build/test-only needs
 * crediting here) — issue #123's "any open source references we need
 * to call out." `@ambra/engine`/`@ambra/shell` aren't listed: they're
 * this project's own workspace packages, not third-party. */
const OPEN_SOURCE_CREDITS: ReadonlyArray<{ name: string; url: string }> = [
  { name: "React", url: "https://react.dev" },
  { name: "Fluent UI React Components", url: "https://react.fluentui.dev" },
  { name: "highlight.js", url: "https://highlightjs.org" },
  { name: "xml-formatter", url: "https://github.com/chrisbottin/xml-formatter" },
];

const SectionHeading: FC<{ children: string }> = ({ children }) => (
  <Caption1 as="p" block style={{ margin: "0 0 6px", opacity: 0.6, fontWeight: 600, textTransform: "uppercase" }}>
    {children}
  </Caption1>
);

/** Plain environment info worth including in a bug report — issue
 * #123's "copy diagnostics" button. Unlike the reader's own
 * `DiagnosticsLog` (a trail of recent in-session reading events), the
 * Library has no book open and no reading session to trail — just the
 * extension version and basic browser/platform info, still useful
 * context for a report filed from here. */
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
}

/**
 * The About Ambra flyout (issue #123) — a static panel packaged with
 * the extension itself (not a separate page/tab requiring its own
 * build entry point), matching `BookDetailsFlyout`'s own slide-in
 * layout/interaction so the Library's chrome stays visually
 * consistent. Covers credits, licensing/privacy links, and a way to
 * report an issue, ahead of this repository going public. Entirely
 * static: no book, no library data, and no reading session state to
 * depend on.
 */
export const AboutFlyout: FC<AboutFlyoutProps> = ({ open, onRequestClose, backgroundSolid }) => {
  const asideRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onRequestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onRequestClose]);

  useEffect(() => {
    if (open) {
      asideRef.current?.focus();
    }
  }, [open]);

  const copyDiagnostics = (): void => {
    void navigator.clipboard.writeText(collectEnvironmentInfo()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const version = chrome.runtime.getManifest().version;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onRequestClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 30,
          background: "rgba(15, 23, 42, 0.18)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 260ms ease",
        }}
      />
      <aside
        ref={asideRef}
        tabIndex={-1}
        aria-label="About Ambra"
        style={{
          position: "fixed",
          outline: "none",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 31,
          width: 360,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          background: backgroundSolid,
          backdropFilter: "blur(16px)",
          borderLeft: `1px solid ${CHROME_BORDER}`,
          boxShadow: CHROME_SHADOW,
          transform: `translateX(${open ? "0" : "100%"})`,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          visibility: open ? "visible" : "hidden",
          transition: "transform 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease, visibility 280ms",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "10px 8px 10px 14px",
            borderBottom: `1px solid ${CHROME_BORDER}`,
          }}
        >
          <Body1Strong as="span" style={{ flex: 1 }}>
            About Ambra
          </Body1Strong>
          <Tooltip content="Close" relationship="label">
            <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onRequestClose} />
          </Tooltip>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <AmbraMarkIcon size={40} />
            <div>
              <Body1Strong as="p" block style={{ margin: 0 }}>
                Ambra
              </Body1Strong>
              <Caption1 as="p" block style={{ margin: 0, opacity: 0.6 }}>
                Version {version}
              </Caption1>
            </div>
          </div>

          <Body1 as="p" block style={{ margin: "0 0 20px" }}>
            A polished, accessible EPUB3 reader for Chrome — reflowable and fixed-layout books, annotations, and
            more, built to comply closely with the EPUB 3 spec.
          </Body1>

          <div style={{ marginBottom: 20 }}>
            <SectionHeading>Created by</SectionHeading>
            <Body1 as="p" block style={{ margin: 0 }}>
              Ben Walters
            </Body1>
          </div>

          <div style={{ marginBottom: 20 }}>
            <SectionHeading>Links</SectionHeading>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Link href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                Source code on GitHub
              </Link>
              <Link href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
                Privacy policy
              </Link>
              <Link href={EPUB_SPEC_URL} target="_blank" rel="noreferrer">
                EPUB 3.4 specification
              </Link>
              <Link href={PUBLISHING_WG_URL} target="_blank" rel="noreferrer">
                W3C Publishing Working Group
              </Link>
              <Link href={`mailto:${REPORT_EMAIL}`}>Report an issue or request a feature</Link>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <SectionHeading>Open source</SectionHeading>
            <Body1 as="p" block style={{ margin: "0 0 8px" }}>
              Ambra is built with the help of these open-source projects:
            </Body1>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {OPEN_SOURCE_CREDITS.map((credit) => (
                <Link key={credit.name} href={credit.url} target="_blank" rel="noreferrer">
                  {credit.name}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <SectionHeading>Troubleshooting</SectionHeading>
            <Button appearance="secondary" size="small" icon={<CopyRegular />} onClick={copyDiagnostics}>
              {copied ? "Copied!" : "Copy diagnostics"}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};
